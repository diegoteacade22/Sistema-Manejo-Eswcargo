#!/bin/bash

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Iniciando Sistema de Gestión de Importaciones...${NC}"

# Directorio base
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# 1. Verificar archivo .env
echo -e "1. Verificando configuración..."
if [ ! -f .env ]; then
    echo -e "${RED}Error: No se encuentra el archivo .env${NC}"
    echo -e "${YELLOW}Copiá .env.example a .env y completá las variables obligatorias.${NC}"
    exit 1
else
    echo -e "${GREEN}Configuración encontrada.${NC}"
fi

# 2. Verificar node_modules
echo -e "2. Verificando dependencias..."
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Instalando dependencias (esto puede tardar unos minutos)...${NC}"
    npm install
else
    echo -e "${GREEN}Dependencias listas.${NC}"
fi

# 3. Regenerar Cliente Prisma (Crucial para evitar errores de base de datos)
echo -e "3. Sincronizando base de datos..."
npx prisma generate
if [ $? -ne 0 ]; then
    echo -e "${RED}Error al generar cliente de base de datos.${NC}"
    exit 1
fi

# 4. Limpiar puerto 3000 si está ocupado
echo -e "4. Verificando puerto 3000..."
PID=$(lsof -ti:3000)
if [ ! -z "$PID" ]; then
  echo -e "${YELLOW}Puerto 3000 ocupado por proceso $PID. Liberando...${NC}"
  kill -9 $PID
fi

# 5. Limpiar bloqueos anteriores (Fix: Unable to acquire lock)
if [ -d ".next/dev" ]; then
    echo -e "5. Limpiando archivos temporales..."
    rm -f .next/dev/lock
fi

# 6. Iniciar aplicación
echo -e "${GREEN}Todo listo. Iniciando servidor...${NC}"
echo "---------------------------------------------------"
echo "El sistema estará disponible en: http://localhost:3000"
echo "Para DETENER el sistema: Presione CONTROL + C"
echo "---------------------------------------------------"

npm run dev

# Mantener ventana abierta si falla
echo -e "${RED}El servidor se ha detenido inesperadamente.${NC}"
read -p "Presione ENTER para cerrar esta ventana..."
