#!/bin/bash

SERVER="root@104.131.27.50"
REMOTE_DIR="/var/www/eswcargo"

ssh $SERVER << EOF
cd $REMOTE_DIR || exit 1
git pull origin main
docker compose down
docker compose up -d --build
EOF
