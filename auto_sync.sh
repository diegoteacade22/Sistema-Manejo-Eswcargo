#!/bin/bash

set -euo pipefail

# Sincronización siempre COMPLETA desde Sheets
SYNC_FILTER="FULL"
SYNC_MODE="FULL"

# Resolve directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Cron suele tener PATH reducido; agregamos rutas comunes de Node
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# Python Detection
PYTHON_EXEC="python3"
if [ -f "./venv/bin/python3" ]; then
    PYTHON_EXEC="./venv/bin/python3"
elif [ -f "./venv_new/bin/python3" ]; then
    PYTHON_EXEC="./venv_new/bin/python3"
fi

echo ""
echo "🔄 EJECUTANDO SINCRONIZACIÓN AUTOMÁTICA (MODO COMPLETO)..."
echo "------------------------------------------------------------"

# 1. Download (Try up to 2 times)
if ! $PYTHON_EXEC download_sheet.py; then
    echo "⚠️  Fallo primera descarga, reintentando..."
    sleep 2
    if ! $PYTHON_EXEC download_sheet.py; then
        echo "❌ No se pudo descargar la planilla actual. Se cancela para no usar una copia anterior."
        exit 1
    fi
fi

# 2. Extract (siempre completo)
echo "📊 Procesando datos..."
$PYTHON_EXEC extract_consolidated.py "$SYNC_FILTER"
if [ $? -ne 0 ]; then
    echo "❌ Error procesando el Excel."
    exit 1
fi

# 3. Seed (siempre full)
echo "💾 Guardando en base de datos..."
cd webapp
if [ -x "./node_modules/.bin/tsx" ]; then
    SYNC_MODE="$SYNC_MODE" ./node_modules/.bin/tsx prisma/seed_fast.ts
elif command -v npx >/dev/null 2>&1; then
    SYNC_MODE="$SYNC_MODE" npx tsx prisma/seed_fast.ts
elif command -v npm >/dev/null 2>&1; then
    SYNC_MODE="$SYNC_MODE" npm exec --yes tsx prisma/seed_fast.ts
else
    echo "❌ Error guardando datos: no se encontró tsx (ni ./node_modules/.bin/tsx, npx o npm exec)."
    echo "   Ejecutá en webapp: npm install"
    exit 1
fi

if [ $? -ne 0 ]; then
    echo "❌ Error guardando datos."
    exit 1
fi

echo "🔎 Verificando asignaciones y packing lists..."
node scripts/audit-shipment-reconciliation.mjs
node scripts/audit-packing-readiness.mjs
node scripts/audit-invoice-readiness.mjs

echo "✅ Sincronización completada."
echo ""
