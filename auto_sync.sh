#!/bin/bash

# Configuration: Days to sync (default 7 for speed)
DAYS=${1:-7} 

# Resolve directory
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Python Detection
PYTHON_EXEC="python3"
if [ -f "./venv/bin/python3" ]; then
    PYTHON_EXEC="./venv/bin/python3"
elif [ -f "./venv_new/bin/python3" ]; then
    PYTHON_EXEC="./venv_new/bin/python3"
fi

echo ""
echo "🔄 EJECUTANDO SINCRONIZACIÓN AUTOMÁTICA (Últimos $DAYS días)..."
echo "------------------------------------------------------------"

# 1. Download (Try up to 2 times)
$PYTHON_EXEC download_sheet.py
if [ $? -ne 0 ]; then
    echo "⚠️  Fallo primera descarga, reintentando..."
    sleep 2
    $PYTHON_EXEC download_sheet.py
fi

# 2. Extract
echo "📊 Procesando datos..."
$PYTHON_EXEC extract_consolidated.py $DAYS
if [ $? -ne 0 ]; then
    echo "❌ Error procesando el Excel."
    exit 1
fi

# 3. Seed
echo "💾 Guardando en base de datos..."
cd webapp
npx tsx prisma/seed_fast.ts
if [ $? -ne 0 ]; then
    echo "❌ Error guardando datos."
    exit 1
fi

echo "✅ Sincronización completada."
echo ""
