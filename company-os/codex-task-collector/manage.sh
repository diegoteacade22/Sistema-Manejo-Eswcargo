#!/bin/zsh
set -euo pipefail
umask 077

ACTION="${1:-status}"
SCRIPT_PATH="${0:A}"
SOURCE_DIR="${SCRIPT_PATH:h}"
STATE_DIR="${COMPANY_OS_CODEX_COLLECTOR_STATE_DIR:-$HOME/.company-os-codex-collector}"
CURRENT="$STATE_DIR/current"
LOGS="$STATE_DIR/logs"
PLIST="$HOME/Library/LaunchAgents/com.esw.company-os-codex-collector.plist"
LABEL="com.esw.company-os-codex-collector"
KEYCHAIN_SERVICE="${COMPANY_OS_CODEX_HMAC_KEYCHAIN_SERVICE:-com.esw.company-os-codex-intake.hmac}"
KEYCHAIN_ACCOUNT="${COMPANY_OS_CODEX_KEYCHAIN_ACCOUNT:-$(id -un)}"
NODE_BIN="${COMPANY_OS_CODEX_NODE_BIN:-/opt/homebrew/bin/node}"

secret() { /usr/bin/security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null; }
validate() {
  [[ "${STATE_DIR:A}" == "$HOME"/* && "${STATE_DIR:A}" != "$HOME" ]] || { echo "STATE_DIR inseguro" >&2; exit 1; }
  [[ -x "$NODE_BIN" && -f "$HOME/.codex/session_index.jsonl" ]] || { echo "Falta Node o inventario Codex" >&2; exit 1; }
  secret >/dev/null || { echo "Falta HMAC en Keychain service=$KEYCHAIN_SERVICE" >&2; exit 1; }
}
render_plist() {
  /bin/cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>/bin/zsh</string><string>$CURRENT/manage.sh</string><string>run</string></array>
<key>RunAtLoad</key><true/><key>StartInterval</key><integer>300</integer>
<key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>$LOGS/stdout.log</string>
<key>StandardErrorPath</key><string>$LOGS/stderr.log</string>
</dict></plist>
EOF
  plutil -lint "$PLIST" >/dev/null
}

case "$ACTION" in
  install)
    validate
    mkdir -p "$CURRENT" "$LOGS" "$HOME/Library/LaunchAgents"
    chmod 700 "$STATE_DIR" "$CURRENT" "$LOGS"
    cp "$SOURCE_DIR/collector.mjs" "$CURRENT/collector.mjs"
    cp "$SCRIPT_PATH" "$CURRENT/manage.sh"
    chmod 700 "$CURRENT/manage.sh" "$CURRENT/collector.mjs"
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    render_plist
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "INSTALLED label=$LABEL interval=300"
    ;;
  run)
    validate
    COMPANY_OS_CODEX_INTAKE_SECRET="$(secret)" exec "$NODE_BIN" "$CURRENT/collector.mjs"
    ;;
  once)
    validate
    COMPANY_OS_CODEX_INTAKE_SECRET="$(secret)" "$NODE_BIN" "$SOURCE_DIR/collector.mjs"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    [[ -f "$PLIST" ]] && mv "$PLIST" "$STATE_DIR/${LABEL}.plist.disabled"
    echo "UNINSTALLED state_preserved=$STATE_DIR"
    ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then echo "ACTIVE label=$LABEL"; else echo "INACTIVE label=$LABEL"; fi
    [[ -f "$LOGS/stdout.log" ]] && tail -1 "$LOGS/stdout.log" || true
    ;;
  *) echo "Uso: manage.sh install|once|status|uninstall" >&2; exit 2 ;;
esac
