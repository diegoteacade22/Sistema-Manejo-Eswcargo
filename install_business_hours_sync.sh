#!/bin/bash

set -euo pipefail

PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RUNNER="$PROJECT_DIR/run_scheduled_sync.sh"
LOG_DIR="$PROJECT_DIR/logs/sync"
MARKER="# ESWCARGO_BUSINESS_SYNC"

# Defaults: Lunes a Viernes, cada hora de 08:00 a 18:00, últimos 7 días
CRON_SCHEDULE="${SYNC_CRON_SCHEDULE:-0 8-18 * * 1-5}"
SYNC_DAYS="${SYNC_DAYS:-7}"

mkdir -p "$LOG_DIR"

if [ ! -f "$RUNNER" ]; then
  echo "❌ No se encontró runner: $RUNNER"
  exit 1
fi

chmod +x "$RUNNER"

TMP_CRON="$(mktemp)"
crontab -l 2>/dev/null | grep -v "$MARKER" > "$TMP_CRON" || true

echo "$CRON_SCHEDULE /bin/bash $RUNNER $SYNC_DAYS >> $LOG_DIR/cron.log 2>&1 $MARKER" >> "$TMP_CRON"
crontab "$TMP_CRON"
rm -f "$TMP_CRON"

echo "✅ Cron instalado/actualizado correctamente"
echo "   Horario: $CRON_SCHEDULE"
echo "   Días sincronizados: $SYNC_DAYS"
echo "   Runner: $RUNNER"
echo "   Log cron: $LOG_DIR/cron.log"
echo ""
echo "Para verificar:"
echo "  crontab -l | grep ESWCARGO_BUSINESS_SYNC"
echo "  tail -f $LOG_DIR/cron.log"
