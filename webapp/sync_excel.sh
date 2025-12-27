#!/bin/bash
# Sync Excel data using Consolidated Extractor and Fast Seeder
# Usage: ./sync_excel.sh [days_filter (7/30/0)]

DAYS_FILTER=${1:-0}
echo "🚀 Starting Excel Sync (Consolidated)..."
echo "----------------------------------------"
echo "Speed Mode: ${DAYS_FILTER} days (0 means ALL)"

# Get paths
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_ROOT="$( dirname "$DIR" )"
PYTHON_EXEC="$APP_ROOT/venv_new/bin/python3"

if [ ! -f "$PYTHON_EXEC" ]; then
    echo "Using system python3 (venv_new not found)"
    PYTHON_EXEC="python3"
fi

# 1. Download Latest Sheet
echo "-> Downloading latest Sheet from Google Drive..."
"$PYTHON_EXEC" "$APP_ROOT/download_sheet.py"
if [ $? -ne 0 ]; then
   echo "Warning: Google Sheet Sync failed or skipped. Continuing with local file..."
fi

# 2. Extract Data
echo "-> Extracting data from Excel (Filter: $DAYS_FILTER days)..."
"$PYTHON_EXEC" "$APP_ROOT/extract_consolidated.py" "$DAYS_FILTER"
if [ $? -ne 0 ]; then
   echo "Error: Extraction failed."
   exit 1
fi

# 3. Seed Fast
echo "-> Updating Database (Fast Differential Seed)..."
cd "$DIR"
npx tsx prisma/seed_fast.ts
if [ $? -ne 0 ]; then
   echo "Error: Database update failed."
   exit 1
fi

echo "----------------------------------------"
echo "✅ Sync Completed! [Filter: $DAYS_FILTER days]"
