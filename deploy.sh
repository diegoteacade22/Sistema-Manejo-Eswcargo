#!/bin/bash
# Deployment script for DigitalOcean Droplet
# Run this after cloning the repository

set -e

echo "🚀 Iniciando despliegue de ESW Cargo..."

# Navigate to project directory
cd "$(dirname "$0")"

# 1. Copy environment variables
if [ ! -f .env ]; then
    echo "📋 Copiando variables de entorno..."
    cp .env.production .env
    echo "⚠️  IMPORTANTE: Edita el archivo .env si necesitas cambiar alguna configuración"
    read -p "Presiona Enter para continuar..."
fi

# 2. Build and start containers
echo "🐳 Construyendo contenedores Docker..."
docker-compose build --no-cache

echo "🚀 Iniciando aplicación..."
docker-compose up -d

# 3. Wait for application to be ready
echo "⏳ Esperando que la aplicación inicie..."
sleep 10

# 4. Check if container is running
if docker ps | grep -q eswcargo-app; then
    echo "✅ Aplicación desplegada exitosamente!"
    echo ""
    echo "📊 Estado de los contenedores:"
    docker-compose ps
    echo ""
    echo "🌐 La aplicación está corriendo en http://localhost:3000"
    echo "📝 Para ver los logs: docker-compose logs -f webapp"
    echo "🔄 Para reiniciar: docker-compose restart"
    echo "🛑 Para detener: docker-compose down"
else
    echo "❌ Error: El contenedor no está corriendo"
    echo "Revisa los logs con: docker-compose logs webapp"
    exit 1
fi
