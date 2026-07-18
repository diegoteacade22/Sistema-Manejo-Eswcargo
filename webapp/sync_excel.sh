#!/bin/bash
# Sync Excel data using Consolidated Extractor and Fast Seeder
# Usage: ./sync_excel.sh [7|30|0|FULL]

REQUESTED_SCOPE="${1:-FULL}"
REQUESTED_SCOPE_UPPER="$(printf '%s' "$REQUESTED_SCOPE" | tr '[:lower:]' '[:upper:]')"

if [ "$REQUESTED_SCOPE" = "0" ] || [ "$REQUESTED_SCOPE_UPPER" = "FULL" ]; then
   DAYS_FILTER="FULL"
   SYNC_MODE="FULL"
elif [[ "$REQUESTED_SCOPE" =~ ^[1-9][0-9]*$ ]]; then
   DAYS_FILTER="$REQUESTED_SCOPE"
   SYNC_MODE="DIFF"
else
   echo "Error: rango inválido '$REQUESTED_SCOPE'. Use 7, 30, 0 o FULL."
   exit 2
fi

echo "🚀 Starting Excel Sync (Consolidated)..."
echo "----------------------------------------"
echo "Sync Mode: $SYNC_MODE"
echo "Filter: $DAYS_FILTER"

SYNC_STARTED_AT="$(date +%s)"
SYNC_ALERT_THRESHOLD_SECONDS="${SYNC_ALERT_THRESHOLD_SECONDS:-120}"

run_stage() {
    local stage_name="$1"
    shift
    local stage_started_at
    stage_started_at="$(date +%s)"
    "$@"
    local stage_exit=$?
    local stage_elapsed=$(( $(date +%s) - stage_started_at ))
    echo "⏱️ $stage_name: ${stage_elapsed}s"
    return "$stage_exit"
}

finish_sync() {
    local total_elapsed=$(( $(date +%s) - SYNC_STARTED_AT ))
    echo "⏱️ Sincronización total: ${total_elapsed}s"
    if [ "$total_elapsed" -gt "$SYNC_ALERT_THRESHOLD_SECONDS" ]; then
        echo "⚠️ Sincronización por encima del umbral operativo de ${SYNC_ALERT_THRESHOLD_SECONDS}s. Revisar el detalle por etapa."
    fi
}

trap finish_sync EXIT

# Get paths
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_ROOT="$( dirname "$DIR" )"

# Prioritize venv over venv_new
if [ -f "$APP_ROOT/venv/bin/python3" ]; then
    PYTHON_EXEC="$APP_ROOT/venv/bin/python3"
elif [ -f "$APP_ROOT/venv_new/bin/python3" ]; then
    PYTHON_EXEC="$APP_ROOT/venv_new/bin/python3"
else
    echo "Using system python3 (no venv found)"
    PYTHON_EXEC="python3"
fi

# 1. Download Latest Sheet
echo "-> Downloading latest Sheet from Google Drive..."
run_stage "Descarga de planilla" "$PYTHON_EXEC" "$APP_ROOT/download_sheet.py"
if [ $? -ne 0 ]; then
   echo "Error: no se pudo descargar la planilla actual. La sincronización se detuvo para no aplicar datos anteriores."
   exit 1
fi

# 2. Extract Data
echo "-> Extracting data from Excel ($DAYS_FILTER)..."
run_stage "Extracción de datos" "$PYTHON_EXEC" "$APP_ROOT/extract_consolidated.py" "$DAYS_FILTER"
if [ $? -ne 0 ]; then
   echo "Error: Extraction failed."
   exit 1
fi

# 3. Seed Fast
echo "-> Updating Database (Differential Seed - Mode: $SYNC_MODE)..."
cd "$DIR"
npx prisma migrate deploy --schema prisma/schema.prisma
if [ $? -ne 0 ]; then
   echo "Error: no se pudieron aplicar las migraciones de base requeridas para la sincronización."
   exit 1
fi

CASHFLOW_RAW_EXPORT="$(mktemp /tmp/eswcargo-cashflow-raw.XXXXXX.json)"
if run_stage "Lectura de Cash Flow" bash -c '"$1" "$2" > "$3"' -- "$PYTHON_EXEC" "$DIR/scripts/export-cash-flow-raw-transactions.py" "$CASHFLOW_RAW_EXPORT"; then
   run_stage "Auditoría de deriva Cash Flow previa" node "$DIR/scripts/audit-cash-flow-raw-drift.mjs" --source "$CASHFLOW_RAW_EXPORT" || echo "⚠️ No se pudo contrastar Cash Flow antes de actualizar."
   run_stage "Auditoría de referencias Invoice" "$PYTHON_EXEC" "$DIR/scripts/audit-cashflow-invoice-references.py" --summary || echo "⚠️ No se pudo contrastar referencias de Invoice."
else
   echo "⚠️ No se pudo leer Cash Flow; se mantiene la escritura financiera deshabilitada."
fi
run_stage "Auditoría de cuenta corriente previa" node "$DIR/scripts/audit-ledgers.mjs" || echo "⚠️ Cuenta corriente con advertencias; se mantiene la sincronización operativa sin movimientos financieros."
run_stage "Auditoría de duplicados CC previa" node "$DIR/scripts/audit-ledger-duplicates.mjs" || echo "⚠️ Posibles duplicados o documentos repetidos en Cuenta Corriente; revisar antes de emitir cobros."
if [ -x "$DIR/node_modules/.bin/tsx" ]; then
   run_stage "Actualización de base" env SYNC_MODE=$SYNC_MODE ALLOW_FINANCIAL_LEDGER_SYNC=0 "$DIR/node_modules/.bin/tsx" prisma/seed_fast.ts
elif [ -x "$DIR/node_modules/.bin/ts-node" ]; then
   run_stage "Actualización de base" env SYNC_MODE=$SYNC_MODE ALLOW_FINANCIAL_LEDGER_SYNC=0 "$DIR/node_modules/.bin/ts-node" prisma/seed_fast.ts
else
   run_stage "Actualización de base" env SYNC_MODE=$SYNC_MODE ALLOW_FINANCIAL_LEDGER_SYNC=0 npx --yes tsx prisma/seed_fast.ts
fi
if [ $? -ne 0 ]; then
   echo "Error: Database update failed."
   exit 1
fi

echo "-> Verifying shipment assignments..."
run_stage "Auditoría de asignaciones" node "$DIR/scripts/audit-shipment-reconciliation.mjs"
if [ $? -ne 0 ]; then
   echo "Error: Shipment assignment audit failed."
   exit 1
fi

run_stage "Auditoría de packing" node "$DIR/scripts/audit-packing-readiness.mjs"
if [ $? -ne 0 ]; then
   echo "Error: Packing readiness audit failed."
   exit 1
fi

run_stage "Auditoría de invoice" node "$DIR/scripts/audit-invoice-readiness.mjs"
if [ $? -ne 0 ]; then
   echo "Error: Invoice readiness audit failed."
   exit 1
fi

if [ -f "$CASHFLOW_RAW_EXPORT" ]; then
   run_stage "Auditoría de deriva Cash Flow posterior" node "$DIR/scripts/audit-cash-flow-raw-drift.mjs" --source "$CASHFLOW_RAW_EXPORT" || echo "⚠️ No se pudo contrastar Cash Flow después de actualizar."
   rm -f "$CASHFLOW_RAW_EXPORT"
fi

run_stage "Auditoría de cuenta corriente" node "$DIR/scripts/audit-ledgers.mjs" || echo "⚠️ Cuenta corriente con advertencias; revisar antes de emitir cobros."
run_stage "Auditoría de duplicados CC" node "$DIR/scripts/audit-ledger-duplicates.mjs" || echo "⚠️ Posibles duplicados o documentos repetidos en Cuenta Corriente; revisar Mantenimiento antes de emitir cobros."
run_stage "Auditoría de cuentas de proveedores" node "$DIR/scripts/audit-supplier-ledgers.mjs" || echo "⚠️ Proveedores con movimientos a revisar; no se modificaron saldos automáticamente."

echo "----------------------------------------"
echo "✅ Sync Completed! [Mode: $SYNC_MODE]"
