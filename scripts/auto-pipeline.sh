#!/bin/bash

PROJECT_DIR="/Users/diegorodriguez/02_DESARROLLO/Proyectos_Activos/sistema_gestion_importaciones"
SERVER="root@104.131.27.50"
REMOTE_DIR="/var/www/eswcargo"
BRANCH="main"

echo "📁 Moviéndonos al proyecto..."
cd "$PROJECT_DIR" || exit 1

echo "📦 Agregando cambios..."
git add .

echo "📝 Commit..."
git commit -m "auto: update $(date +'%Y-%m-%d %H:%M:%S')" || echo "No hay cambios para commitear"

echo "🚀 Push..."
git push origin $BRANCH || exit 1

echo "🌍 Deploy remoto..."
ssh $SERVER << EOF
cd $REMOTE_DIR || exit 1
git pull origin $BRANCH || exit 1
docker compose down
docker compose up -d --build || exit 1
docker ps
EOF

echo "✅ Pipeline completo finalizado"
