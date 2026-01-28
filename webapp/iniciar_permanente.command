#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo -e "\033]0;Dale Gas - Iniciando...\007"
echo "===================================================="
echo "   🚀 DALE GAS - INICIANDO SISTEMA"
echo "===================================================="

# 1. Ejecutar Sincronización Automática
# Buscamos el script en el directorio padre
if [ -f "../auto_sync.sh" ]; then
    echo ">> Iniciando actualización de datos..."
    ../auto_sync.sh 7
else
    echo "⚠️ No se encontró el script de sincronización automática."
fi

echo "===================================================="
echo "   Configurando Servicio Permanente"
echo "===================================================="

# Ensure PM2 is installed locally
if [ ! -d "node_modules/pm2" ]; then
    echo "Instalando gestor de procesos..."
    npm install pm2 --save-dev
fi

# Check if process is already running
PM2_CMD="./node_modules/.bin/pm2"
IS_RUNNING=$($PM2_CMD list | grep "dale-gas-webapp")

if [ -n "$IS_RUNNING" ]; then
    echo "🔄 El sistema ya estaba corriendo. Recargando..."
    $PM2_CMD reload dale-gas-webapp
else
    echo "✅ Iniciando servidor por primera vez..."
    $PM2_CMD start npm --name "dale-gas-webapp" -- run dev
fi

# Save the list
$PM2_CMD save

echo ""
echo "✅ SISTEMA OPERATIVO Y ACTUALIZADO."
echo "Puedes cerrar esta ventana, el sistema seguirá funcionando."
echo ""
echo "Esta ventana se cerrará automáticamente..."
sleep 5
exit 0
