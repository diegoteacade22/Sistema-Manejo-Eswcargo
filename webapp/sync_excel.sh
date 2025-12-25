#!/bin/bash
# Sync Excel data to SQLite database
# Run this from webapp/ directory

echo "Starting Sync Process..."

# 1. Run Python Extractors (Generate JSONs)
echo "----------------------------------------"
echo "Extracting data from Excel (Python)..."

# Get the absolute path to the project root (parent of webapp)
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
APP_ROOT="$( dirname "$DIR" )"

PYTHON_EXEC="$APP_ROOT/venv/bin/python3"

if [ ! -f "$PYTHON_EXEC" ]; then
    echo "Using system python3 (venv not found at $PYTHON_EXEC)"
    PYTHON_EXEC="python3"
else
    echo "Using venv python: $PYTHON_EXEC"
fi

echo "-> Downloading latest Sheet from Google Drive..."
"$PYTHON_EXEC" "$APP_ROOT/download_sheet.py"
if [ $? -ne 0 ]; then
   echo "Error: Google Sheet Sync Failed. Aborting."
   exit 1
fi

"$PYTHON_EXEC" "$APP_ROOT/extract_clients.py"
"$PYTHON_EXEC" "$APP_ROOT/extract_suppliers.py"
"$PYTHON_EXEC" "$APP_ROOT/extract_products.py"
"$PYTHON_EXEC" "$APP_ROOT/extract_shipments.py"
"$PYTHON_EXEC" "$APP_ROOT/extract_orders.py"

echo "Extraction complete."
echo "----------------------------------------"

# 2. Run Prisma Seeders (Consume JSONs)
echo "Seeding Database (Prisma)..."

# Use commonjs module for ts-node execution
TS_NODE_OPTS='{"module":"commonjs"}'


echo "-> Resetting Transactions..."
npx ts-node -O "$TS_NODE_OPTS" prisma/seed_reset.ts

echo "-> Seeding Clients..."
npx ts-node -O "$TS_NODE_OPTS" prisma/seed_clients.ts

echo "-> Seeding Suppliers..."
npx ts-node -O "$TS_NODE_OPTS" prisma/seed_suppliers.ts

echo "-> Seeding Products..."
npx ts-node -O "$TS_NODE_OPTS" prisma/seed_products.ts

echo "-> Seeding Shipments..."
npx ts-node -O "$TS_NODE_OPTS" prisma/seed_shipments.ts

echo "-> Seeding Orders..."
npx ts-node -O "$TS_NODE_OPTS" prisma/seed_orders.ts

echo "----------------------------------------"
echo "Sync Completed Successfully!"
