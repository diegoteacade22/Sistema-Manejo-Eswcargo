#!/bin/bash

SERVER="root@104.131.27.50"
REMOTE_DIR="/var/www/eswcargo"

echo "🚀 Deploy iniciado en $SERVER"

ssh $SERVER << EOF
cd $REMOTE_DIR || exit 1

echo "📥 Git pull..."
git pull origin main || exit 1

echo "🐳 Rebuild Docker..."
docker compose down
docker compose up -d --build || exit 1

echo "🔎 Verificando contenedores..."
docker ps

echo "✅ Deploy finalizado"
EOF
