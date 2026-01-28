#!/bin/bash
# Script para pasar cambios de Admin (main) a Producción (production)

echo "🚀 Iniciando despliegue a PRODUCCIÓN (clientes)..."

# 1. Asegurar que estamos en main y tenemos lo último
git checkout main
git pull origin main

# 2. Pasar a la rama production
git checkout production
git pull origin production

# 3. Fusionar cambios de main a production
echo "🔄 Mezclando cambios de Admin a Producción..."
git merge main -m "Despliegue de producción: $(date +'%Y-%m-%d %H:%M:%S')"

# 4. Subir a GitHub (esto dispara el despliegue estable en Vercel)
echo "📤 Subiendo a la web oficial..."
git push origin production

# 5. Volver a main para seguir trabajando
git checkout main
echo "✅ ¡Listo! La web de clientes se está actualizando ahora mismo."
echo "🛡️ Has vuelto a la rama de Desarrollo/Admin."
