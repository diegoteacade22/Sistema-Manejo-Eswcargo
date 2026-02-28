#!/bin/bash

set -euo pipefail

PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LOCK_FILE="/tmp/eswcargo_google_sync.lock"
LOG_DIR="$PROJECT_DIR/logs/sync"
SYNC_DAYS="${1:-7}"

# Cron suele ejecutarse con PATH mínimo
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

mkdir -p "$LOG_DIR"

if [ -f "$LOCK_FILE" ]; then
  EXISTING_PID="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] Sync omitida: ya hay una ejecución activa (PID $EXISTING_PID)."
    exit 0
  fi
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

echo "[$(date +'%Y-%m-%d %H:%M:%S')] Iniciando sincronización programada (últimos $SYNC_DAYS días)..."
cd "$PROJECT_DIR"
bash ./auto_sync.sh "$SYNC_DAYS" >> "$LOG_DIR/auto_sync.log" 2>&1
echo "[$(date +'%Y-%m-%d %H:%M:%S')] Sincronización programada finalizada."
