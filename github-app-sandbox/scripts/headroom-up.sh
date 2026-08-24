#!/usr/bin/env bash
set -euo pipefail

NAME="github-sandbox-headroom"
IMAGE="ghcr.io/headroomlabs-ai/headroom:nonroot"
HOST_PORT="18787"
CONTAINER_PORT="8787"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker no está instalado o no está en PATH."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker no está corriendo."
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "Eliminando contenedor sandbox anterior: $NAME"
  docker rm -f "$NAME" >/dev/null
fi

echo "Descargando $IMAGE ..."
docker pull "$IMAGE"

echo "Levantando Headroom aislado en 127.0.0.1:${HOST_PORT} ..."
docker run -d \
  --name "$NAME" \
  --restart unless-stopped \
  --memory 2g \
  --cpus 2 \
  -p "127.0.0.1:${HOST_PORT}:${CONTAINER_PORT}" \
  "$IMAGE" >/dev/null

sleep 3

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "ERROR: Headroom no quedó corriendo. Logs:"
  docker logs --tail 100 "$NAME" || true
  exit 1
fi

echo
 echo "OK: Headroom sandbox está corriendo."
echo "Local endpoint: http://127.0.0.1:${HOST_PORT}"
echo "Container: $NAME"
echo
 echo "Siguiente chequeo: ./github-app-sandbox/scripts/headroom-status.sh"
