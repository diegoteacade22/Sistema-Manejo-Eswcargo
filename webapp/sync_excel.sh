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
"$PYTHON_EXEC" "$APP_ROOT/download_sheet.py"
if [ $? -ne 0 ]; then
   echo "Warning: Google Sheet Sync failed or skipped. Continuing with local file..."
fi

# 2. Extract Data
echo "-> Extracting data from Excel ($DAYS_FILTER)..."
"$PYTHON_EXEC" "$APP_ROOT/extract_consolidated.py" "$DAYS_FILTER"
if [ $? -ne 0 ]; then
   echo "Error: Extraction failed."
   exit 1
fi

# 3. Seed Fast
echo "-> Updating Database (Differential Seed - Mode: $SYNC_MODE)..."
cd "$DIR"
if [ -x "$DIR/node_modules/.bin/tsx" ]; then
   SYNC_MODE=$SYNC_MODE "$DIR/node_modules/.bin/tsx" prisma/seed_fast.ts
elif [ -x "$DIR/node_modules/.bin/ts-node" ]; then
   SYNC_MODE=$SYNC_MODE "$DIR/node_modules/.bin/ts-node" prisma/seed_fast.ts
else
   SYNC_MODE=$SYNC_MODE npx --yes tsx prisma/seed_fast.ts
fi
if [ $? -ne 0 ]; then
   echo "Error: Database update failed."
   exit 1
fi

echo "-> Verifying shipment assignments..."
node "$DIR/scripts/audit-shipment-reconciliation.mjs"
if [ $? -ne 0 ]; then
   echo "Error: Shipment assignment audit failed."
   exit 1
fi

node "$DIR/scripts/audit-packing-readiness.mjs"
if [ $? -ne 0 ]; then
   echo "Error: Packing readiness audit failed."
   exit 1
fi

echo "----------------------------------------"
echo "✅ Sync Completed! [Mode: $SYNC_MODE]"
