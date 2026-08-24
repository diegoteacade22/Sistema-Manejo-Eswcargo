#!/usr/bin/env bash
set -euo pipefail
NAME="github-sandbox-headroom"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker no disponible; no hay nada que detener desde este script."
  exit 0
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null
  echo "OK: $NAME eliminado. La imagen Docker queda cacheada para una futura prueba."
else
  echo "OK: no existe el contenedor $NAME."
fi
