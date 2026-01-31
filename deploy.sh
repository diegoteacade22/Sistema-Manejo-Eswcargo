#!/bin/bash
# Script de despliegue simple para servidor con Docker

set -e

echo "🚀 Desplegando Sistema de Gestión de Importaciones..."

# Verificar que estamos en el directorio correcto
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ Error: docker-compose.yml no encontrado"
    echo "Ejecuta este script desde el directorio raíz del proyecto"
    exit 1
fi

# Verificar que existe el archivo .env
if [ ! -f ".env" ]; then
    echo "⚠️  Archivo .env no encontrado"
    if [ -f ".env.example" ]; then
        echo "📋 Copia .env.example a .env y configura tus variables"
        cp .env.example .env
        echo "✅ Archivo .env creado. Por favor edítalo antes de continuar."
        exit 1
    else
        echo "❌ No se encontró .env.example"
        exit 1
    fi
fi

# Detener contenedor anterior si existe
echo "🛑 Deteniendo contenedor existente..."
docker-compose down 2>/dev/null || true

# Construir y levantar
echo "🐳 Construyendo imagen..."
docker-compose build --no-cache

echo "🚀 Levantando servicio..."
docker-compose up -d

# Esperar a que el contenedor inicie
echo "⏳ Esperando a que el servicio inicie..."
sleep 5

# Verificar estado
if docker ps | grep -q eswcargo-webapp; then
    echo ""
    echo "✅ ¡Despliegue exitoso!"
    echo ""
    echo "📊 Estado del contenedor:"
    docker-compose ps
    echo ""
    echo "🌐 Aplicación disponible en: http://localhost:3002"
    echo "📝 Ver logs: docker-compose logs -f eswcargo-webapp"
    echo ""
else
    echo ""
    echo "❌ Error: El contenedor no está corriendo"
    echo "Ver logs con: docker-compose logs eswcargo-webapp"
    exit 1
fi

