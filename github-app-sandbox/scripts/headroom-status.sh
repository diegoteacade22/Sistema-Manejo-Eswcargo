#!/usr/bin/env bash
set -euo pipefail
NAME="github-sandbox-headroom"
HOST_PORT="18787"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker no disponible"
  exit 1
fi

echo "=== Headroom Sandbox Status ==="
if docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker ps --filter "name=^/${NAME}$" --format 'Container: {{.Names}}\nImage: {{.Image}}\nStatus: {{.Status}}\nPorts: {{.Ports}}'
  echo
  echo "Endpoint local: http://127.0.0.1:${HOST_PORT}"
  echo
  echo "Últimos logs:"
  docker logs --tail 25 "$NAME" 2>&1 || true
else
  echo "Estado: STOPPED / NOT INSTALLED"
  docker ps -a --filter "name=^/${NAME}$" --format 'Último estado: {{.Status}}' || true
  exit 1
fi
