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
CODEX_BIN="${COMPANY_OS_CODEX_BIN:-/opt/homebrew/bin/codex}"
SOURCE_HOST="${COMPANY_OS_CODEX_SOURCE_HOST:-DiegoServer.local}"
INSTALL_ID="${COMPANY_OS_CODEX_INSTALL_ID:-$(/usr/bin/uuidgen)}"
PATH_VALUE="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
RUN_LOCK="$STATE_DIR/run.lock"
LOCK_TOKEN=""
COLLECTOR_PID=""

secret() { /usr/bin/security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null; }
validate() {
  local require_codex="${1:-${COMPANY_OS_CODEX_AUTO_RESUME:-0}}"
  [[ "${STATE_DIR:A}" == "$HOME"/* && "${STATE_DIR:A}" != "$HOME" ]] || { echo "STATE_DIR inseguro" >&2; exit 1; }
  [[ -x "$NODE_BIN" && -f "$HOME/.codex/session_index.jsonl" ]] || { echo "Falta Node o inventario Codex" >&2; exit 1; }
  [[ "$require_codex" != "1" || -x "$CODEX_BIN" ]] || { echo "Falta Codex CLI para reanudación automática" >&2; exit 1; }
  print -r -- "$SOURCE_HOST" | /usr/bin/grep -Eq '^[A-Za-z0-9._:-]{1,120}$' || { echo "SOURCE_HOST inválido" >&2; exit 1; }
  print -r -- "$INSTALL_ID" | /usr/bin/grep -Eq '^[A-Za-z0-9._:-]{1,120}$' || { echo "INSTALL_ID inválido" >&2; exit 1; }
  print -r -- "$KEYCHAIN_SERVICE" | /usr/bin/grep -Eq '^[A-Za-z0-9._@:-]{1,160}$' || { echo "KEYCHAIN_SERVICE inválido" >&2; exit 1; }
  print -r -- "$KEYCHAIN_ACCOUNT" | /usr/bin/grep -Eq '^[A-Za-z0-9._@:-]{1,160}$' || { echo "KEYCHAIN_ACCOUNT inválido" >&2; exit 1; }
  secret >/dev/null || { echo "Falta HMAC en Keychain service=$KEYCHAIN_SERVICE" >&2; exit 1; }
}
write_lock_owner() {
  LOCK_TOKEN="$(/usr/bin/uuidgen)"
  lock_start="$(/bin/ps -p "$$" -o lstart=)"
  lock_command="$(/bin/ps -ww -p "$$" -o command=)"
  [[ -n "$lock_start" && -n "$lock_command" ]] || return 1
  print -r -- "$$" > "$RUN_LOCK/pid" || return 2
  print -r -- "$lock_start" > "$RUN_LOCK/start" || return 2
  print -r -- "$lock_command" > "$RUN_LOCK/command" || return 2
  print -r -- "$LOCK_TOKEN" > "$RUN_LOCK/token" || return 2
}
acquire_lock() {
  if mkdir "$RUN_LOCK" 2>/dev/null; then
    if write_lock_owner; then return 0; fi
    mv "$RUN_LOCK" "$STATE_DIR/run.lock.failed.$(/bin/date +%Y%m%d%H%M%S).$$" 2>/dev/null || true
    return 2
  fi
  local lock_pid=""
  local lock_start=""
  local lock_command=""
  local current_start=""
  local current_command=""
  [[ -f "$RUN_LOCK/pid" ]] && lock_pid="$(<"$RUN_LOCK/pid")"
  [[ -f "$RUN_LOCK/start" ]] && lock_start="$(<"$RUN_LOCK/start")"
  [[ -f "$RUN_LOCK/command" ]] && lock_command="$(<"$RUN_LOCK/command")"
  if [[ "$lock_pid" == <-> ]]; then
    current_start="$(/bin/ps -p "$lock_pid" -o lstart= 2>/dev/null || true)"
    current_command="$(/bin/ps -ww -p "$lock_pid" -o command= 2>/dev/null || true)"
  fi
  if [[ -n "$current_start" && "$current_start" == "$lock_start" && "$current_command" == "$lock_command" ]]; then
    echo "ALREADY_RUNNING pid=$lock_pid"
    return 1
  fi
  if ! mv "$RUN_LOCK" "$STATE_DIR/run.lock.stale.$(/bin/date +%Y%m%d%H%M%S).$$" 2>/dev/null; then
    echo "LOCK_RACE_RETRY_LATER"
    return 1
  fi
  if ! mkdir "$RUN_LOCK" 2>/dev/null; then
    echo "LOCK_RACE_RETRY_LATER"
    return 1
  fi
  if write_lock_owner; then return 0; fi
  mv "$RUN_LOCK" "$STATE_DIR/run.lock.failed.$(/bin/date +%Y%m%d%H%M%S).$$" 2>/dev/null || true
  return 2
}
release_lock() {
  lock_pid=""
  lock_token=""
  [[ -f "$RUN_LOCK/pid" ]] && lock_pid="$(<"$RUN_LOCK/pid")"
  [[ -f "$RUN_LOCK/token" ]] && lock_token="$(<"$RUN_LOCK/token")"
  if [[ "$lock_pid" == "$$" && -n "$LOCK_TOKEN" && "$lock_token" == "$LOCK_TOKEN" ]]; then
    rm -f "$RUN_LOCK/pid" "$RUN_LOCK/start" "$RUN_LOCK/command" "$RUN_LOCK/token"
    rmdir "$RUN_LOCK" 2>/dev/null || true
  fi
}
forward_signal() {
  local signal_name="$1"
  local exit_code=130
  [[ "$signal_name" == "TERM" ]] && exit_code=143
  if [[ "$COLLECTOR_PID" == <-> ]]; then
    kill -s "$signal_name" "$COLLECTOR_PID" 2>/dev/null || true
    wait "$COLLECTOR_PID" 2>/dev/null || true
  fi
  COLLECTOR_PID=""
  exit "$exit_code"
}
wait_for_collector() {
  local collector_status=0
  wait "$COLLECTOR_PID" || collector_status=$?
  COLLECTOR_PID=""
  return "$collector_status"
}
wait_for_install_readback() {
  local attempt=0
  local recent=""
  while [[ "$attempt" -lt 45 ]]; do
    if [[ -f "$LOGS/stdout.log" ]]; then
      recent="$(tail -50 "$LOGS/stdout.log")"
      if [[ "$recent" == *'"ok":true'* && "$recent" == *'"installId":"'"$INSTALL_ID"'"'* && "$recent" == *'"scanId":"auto-'* ]]; then return 0; fi
    fi
    /bin/sleep 1
    attempt=$((attempt + 1))
  done
  return 1
}
render_plist() {
  local target="${1:-$PLIST}"
  /bin/cat > "$target" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>/bin/zsh</string><string>$CURRENT/manage.sh</string><string>run</string></array>
<key>RunAtLoad</key><true/><key>StartInterval</key><integer>300</integer>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>10</integer>
<key>ProcessType</key><string>Background</string>
<key>WorkingDirectory</key><string>$CURRENT</string>
<key>ExitTimeOut</key><integer>30</integer>
<key>EnvironmentVariables</key><dict>
<key>COMPANY_OS_CODEX_AUTO_RESUME</key><string>1</string>
<key>COMPANY_OS_CODEX_NODE_BIN</key><string>$NODE_BIN</string>
<key>COMPANY_OS_CODEX_BIN</key><string>$CODEX_BIN</string>
<key>COMPANY_OS_CODEX_COLLECTOR_STATE_DIR</key><string>$STATE_DIR</string>
<key>COMPANY_OS_CODEX_SOURCE_HOST</key><string>$SOURCE_HOST</string>
<key>COMPANY_OS_CODEX_INSTALL_ID</key><string>$INSTALL_ID</string>
<key>COMPANY_OS_CODEX_HMAC_KEYCHAIN_SERVICE</key><string>$KEYCHAIN_SERVICE</string>
<key>COMPANY_OS_CODEX_KEYCHAIN_ACCOUNT</key><string>$KEYCHAIN_ACCOUNT</string>
<key>PATH</key><string>$PATH_VALUE</string>
</dict>
<key>StandardOutPath</key><string>$LOGS/stdout.log</string>
<key>StandardErrorPath</key><string>$LOGS/stderr.log</string>
</dict></plist>
EOF
  plutil -lint "$target" >/dev/null
}

case "$ACTION" in
  install)
    validate 1
    "$NODE_BIN" --check "$SOURCE_DIR/collector.mjs"
    /bin/zsh -n "$SCRIPT_PATH"
    backup_dir="$STATE_DIR/backups/$(/bin/date +%Y%m%d%H%M%S).$$"
    mkdir -p "$backup_dir" "$CURRENT" "$LOGS" "$HOME/Library/LaunchAgents"
    had_collector=0
    had_manager=0
    had_plist=0
    was_loaded=0
    launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && was_loaded=1
    [[ -f "$CURRENT/collector.mjs" ]] && { had_collector=1; cp "$CURRENT/collector.mjs" "$backup_dir/collector.mjs"; }
    [[ -f "$CURRENT/manage.sh" ]] && { had_manager=1; cp "$CURRENT/manage.sh" "$backup_dir/manage.sh"; }
    [[ -f "$PLIST" ]] && { had_plist=1; cp "$PLIST" "$backup_dir/${LABEL}.plist"; }
    chmod 700 "$STATE_DIR" "$CURRENT" "$LOGS"
    collector_candidate="$STATE_DIR/collector.mjs.new.$$"
    manager_candidate="$STATE_DIR/manage.sh.new.$$"
    plist_candidate="$STATE_DIR/${LABEL}.plist.new.$$"
    cp "$SOURCE_DIR/collector.mjs" "$collector_candidate"
    cp "$SCRIPT_PATH" "$manager_candidate"
    chmod 700 "$collector_candidate" "$manager_candidate"
    render_plist "$plist_candidate"
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    install_ok=1
    if ! mv "$collector_candidate" "$CURRENT/collector.mjs"; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! mv "$manager_candidate" "$CURRENT/manage.sh"; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! mv "$plist_candidate" "$PLIST"; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! launchctl bootstrap "gui/$(id -u)" "$PLIST"; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! wait_for_install_readback; then install_ok=0; fi
    if [[ "$install_ok" != 1 ]]; then
      launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
      if [[ "$had_collector" == 1 ]]; then cp "$backup_dir/collector.mjs" "$CURRENT/collector.mjs"; fi
      if [[ "$had_manager" == 1 ]]; then cp "$backup_dir/manage.sh" "$CURRENT/manage.sh"; fi
      if [[ "$had_plist" == 1 ]]; then
        cp "$backup_dir/${LABEL}.plist" "$PLIST"
        if [[ "$was_loaded" == 1 ]]; then launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true; fi
      elif [[ -f "$PLIST" ]]; then
        mv "$PLIST" "$backup_dir/${LABEL}.plist.failed"
      fi
      echo "INSTALL_FAILED rollback=$backup_dir" >&2
      exit 1
    fi
    echo "INSTALLED label=$LABEL interval=300 install_id=$INSTALL_ID"
    ;;
  run)
    validate 1
    mkdir -p "$STATE_DIR"
    acquire_lock || exit 0
    trap release_lock EXIT
    trap 'forward_signal TERM' TERM
    trap 'forward_signal INT' INT
    COMPANY_OS_CODEX_SOURCE_HOST="$SOURCE_HOST" COMPANY_OS_CODEX_INSTALL_ID="$INSTALL_ID" COMPANY_OS_CODEX_INTAKE_SECRET="$(secret)" "$NODE_BIN" "$CURRENT/collector.mjs" &
    COLLECTOR_PID="$!"
    wait_for_collector
    ;;
  once)
    COMPANY_OS_CODEX_AUTO_RESUME=0 validate 0
    mkdir -p "$STATE_DIR"
    acquire_lock || exit 0
    trap release_lock EXIT
    trap 'forward_signal TERM' TERM
    trap 'forward_signal INT' INT
    COMPANY_OS_CODEX_AUTO_RESUME=0 COMPANY_OS_CODEX_SOURCE_HOST="$SOURCE_HOST" COMPANY_OS_CODEX_INSTALL_ID="$INSTALL_ID" COMPANY_OS_CODEX_INTAKE_SECRET="$(secret)" "$NODE_BIN" "$SOURCE_DIR/collector.mjs" &
    COLLECTOR_PID="$!"
    wait_for_collector
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    [[ -f "$PLIST" ]] && mv "$PLIST" "$STATE_DIR/${LABEL}.plist.disabled"
    echo "UNINSTALLED state_preserved=$STATE_DIR"
    ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      echo "LOADED label=$LABEL"
      launchctl print "gui/$(id -u)/$LABEL" | /usr/bin/grep -E 'state =|pid =|last exit code =' || true
    else echo "INACTIVE label=$LABEL"; fi
    [[ -f "$LOGS/stdout.log" ]] && tail -1 "$LOGS/stdout.log" || true
    [[ -s "$LOGS/stderr.log" ]] && tail -3 "$LOGS/stderr.log" || true
    ;;
  *) echo "Uso: manage.sh install|run|once|status|uninstall" >&2; exit 2 ;;
esac
