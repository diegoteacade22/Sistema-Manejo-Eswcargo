#!/bin/bash
# Sync Excel data using Consolidated Extractor and Fast Seeder
# Usage: ./sync_excel.sh [days_filter (7/30/0)]

DAYS_FILTER=${1:-0}
FORCE_FULL_SYNC=${FORCE_FULL_SYNC:-true}

if [ "$FORCE_FULL_SYNC" == "true" ] && [ "$DAYS_FILTER" != "FULL" ] && [ "$DAYS_FILTER" != "0" ]; then
   echo "⚠️ FORCE_FULL_SYNC activo: se ignora filtro parcial ($DAYS_FILTER) para evitar corrupción durante migración."
   DAYS_FILTER="FULL"
fi

SYNC_MODE="DIFF"
if [ "$DAYS_FILTER" == "FULL" ] || [ "$DAYS_FILTER" == "0" ]; then
   SYNC_MODE="FULL"
   DAYS_FILTER="FULL"
fi

echo "🚀 Starting Excel Sync (Consolidated)..."
echo "----------------------------------------"
echo "Sync Mode: $SYNC_MODE"
echo "Filter: $DAYS_FILTER days (if applicable)"

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

echo "----------------------------------------"
echo "✅ Sync Completed! [Mode: $SYNC_MODE]"
