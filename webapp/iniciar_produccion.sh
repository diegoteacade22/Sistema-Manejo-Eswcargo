#!/bin/bash

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Iniciando Sistema de Gestión de Importaciones (MODO PRODUCCIÓN)...${NC}"

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
    echo -e "${YELLOW}Instalando dependencias...${NC}"
    npm install
else
    echo -e "${GREEN}Dependencias listas.${NC}"
fi

# 3. Regenerar Cliente Prisma
echo -e "3. Sincronizando base de datos..."
npx prisma generate
if [ $? -ne 0 ]; then
    echo -e "${RED}Error al generar cliente de base de datos.${NC}"
    exit 1
fi

# 3.5 Sincronización Automática con Google Sheets (Full Sync)
echo -e "${YELLOW}3.5. Actualizando TODAS las bases de datos desde Google Sheets...${NC}"
# Ejecutamos el script desde el directorio padre
# Usamos 'bash' explícitamente y pasamos '0' para hacer una sincronización COMPLETA
bash ../auto_sync.sh 0
if [ $? -ne 0 ]; then
    echo -e "${RED}Hubo un error en la sincronización, pero intentaremos continuar...${NC}"
    # No salimos con exit 1 porque quizás solo falló la descarga pero queremos que la app levante
else
    echo -e "${GREEN}Sincronización de datos completada.${NC}"
fi

# 4. Construir Aplicación (Build)
# Preguntar si se quiere reconstruir o hacerlo siempre para asegurar "latest"
echo -e "${YELLOW}4. Construyendo aplicación para producción...${NC}"
npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}Error en el proceso de construcción (build).${NC}"
    exit 1
fi

# 5. Iniciar aplicación
echo -e "${GREEN}Todo listo. Iniciando servidor en modo PRODUCCIÓN...${NC}"
echo "---------------------------------------------------"
echo "El sistema estará disponible en: http://localhost:3000"
echo "Para detener el servidor, presiona Ctrl + C"
echo "---------------------------------------------------"

npm start
