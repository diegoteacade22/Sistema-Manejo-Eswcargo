#!/bin/zsh
set -euo pipefail
umask 077

ACTION="${1:-}"
ACTION_ARG="${2:-}"
SCRIPT_PATH="${0:A}"
SCRIPT_DIR="${SCRIPT_PATH:h}"
STATE_DIR="${COMPANY_OS_ENGINEERING_STATE_DIR:-$HOME/.company-os-engineering-v2}"
CURRENT="$STATE_DIR/current"
BACKUPS="$STATE_DIR/backups"
LOGS="$STATE_DIR/logs"
PLIST="$HOME/Library/LaunchAgents/com.esw.company-os-engineering-v2.plist"
LABEL="com.esw.company-os-engineering-v2"
HEALTH_PORT="${COMPANY_OS_ENGINEERING_HEALTH_PORT:-8795}"
HMAC_SERVICE="${COMPANY_OS_ENGINEERING_HMAC_KEYCHAIN_SERVICE:-com.esw.company-os-runtime.hmac}"
GITHUB_SERVICE="${COMPANY_OS_ENGINEERING_GITHUB_KEYCHAIN_SERVICE:-com.esw.company-os-engineering-v2.github-token}"
GITHUB_KEYCHAIN_PATH="${COMPANY_OS_ENGINEERING_GITHUB_KEYCHAIN_PATH:-$STATE_DIR/engineering-secrets.keychain-db}"
KEYCHAIN_ACCOUNT="${COMPANY_OS_ENGINEERING_KEYCHAIN_ACCOUNT:-$(id -un)}"
NODE_BIN="${COMPANY_OS_ENGINEERING_NODE_BIN:-$(command -v node 2>/dev/null || true)}"
GIT_BIN="${COMPANY_OS_ENGINEERING_GIT_BIN:-$(command -v git 2>/dev/null || true)}"
GH_BIN="${COMPANY_OS_ENGINEERING_GH_BIN:-$(command -v gh 2>/dev/null || true)}"
DOCKER_BIN="${COMPANY_OS_ENGINEERING_DOCKER_BIN:-$(command -v docker 2>/dev/null || true)}"
CODEX_IMAGE="${COMPANY_OS_ENGINEERING_CODEX_IMAGE:-company-os-codex:0.150.1}"
CODEX_AUTH_DIR="${COMPANY_OS_ENGINEERING_CODEX_AUTH_DIR:-$STATE_DIR/codex-auth}"

say() { print -r -- "$*"; }
die() { print -r -- "ERROR: $*" >&2; exit 1; }

validate_state() {
  local resolved="${STATE_DIR:A}"
  [[ "$resolved" == "$HOME"/* && "$resolved" != "$HOME" ]] || die "STATE_DIR inseguro"
}

source_repo() {
  local candidate="${COMPANY_OS_ENGINEERING_SOURCE_REPO:-${SCRIPT_DIR:h:h}}"
  [[ -e "$candidate/.git" && -f "$candidate/webapp/company-os-engineering-worker/src/server.mjs" ]] || die "Repositorio fuente inválido"
  print -r -- "${candidate:A}"
}

check_bins() {
  [[ -x "$NODE_BIN" ]] || die "Node no disponible"
  [[ "$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])')" -ge 22 ]] || die "Node >=22 requerido"
  [[ -x "$GIT_BIN" && -x "$DOCKER_BIN" ]] || die "Falta git o Docker"
  [[ "${COMPANY_OS_ENGINEERING_MAX_AUTONOMY:-A1}" != "A2" || -x "$GH_BIN" ]] || die "Falta gh para A2"
  "$DOCKER_BIN" image inspect "$CODEX_IMAGE" >/dev/null 2>&1 || die "Falta imagen Docker $CODEX_IMAGE"
  [[ -d "$CODEX_AUTH_DIR" && -r "$CODEX_AUTH_DIR/auth.json" ]] || die "Falta auth Codex dedicada en $CODEX_AUTH_DIR/auth.json"
}

check_target_repo() {
  local path="${COMPANY_OS_ENGINEERING_REPOSITORY_PATH:-}" slug="${COMPANY_OS_ENGINEERING_REPOSITORY_SLUG:-}"
  [[ -n "$path" && -e "$path/.git" ]] || die "COMPANY_OS_ENGINEERING_REPOSITORY_PATH inválido"
  [[ "$slug" =~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' ]] || die "COMPANY_OS_ENGINEERING_REPOSITORY_SLUG inválido"
  "$GIT_BIN" -C "$path" cat-file -e HEAD^{commit}
}

keychain_has() { /usr/bin/security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$HMAC_SERVICE" >/dev/null 2>&1; }
keychain_get() { /usr/bin/security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$HMAC_SERVICE" -w 2>/dev/null || die "Falta HMAC en Keychain service=$HMAC_SERVICE account=$KEYCHAIN_ACCOUNT"; }
github_keychain_password() { keychain_get | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}'; }
github_keychain_unlock() {
  [[ -f "$GITHUB_KEYCHAIN_PATH" ]] || return 1
  /usr/bin/security unlock-keychain -p "$(github_keychain_password)" "$GITHUB_KEYCHAIN_PATH" >/dev/null 2>&1
}
github_keychain_has() {
  github_keychain_unlock && /usr/bin/security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$GITHUB_SERVICE" "$GITHUB_KEYCHAIN_PATH" >/dev/null 2>&1
}
github_keychain_get() {
  github_keychain_unlock || die "Falta Keychain GitHub A2 en $GITHUB_KEYCHAIN_PATH"
  /usr/bin/security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$GITHUB_SERVICE" -w "$GITHUB_KEYCHAIN_PATH" 2>/dev/null || die "Falta token GitHub en Keychain service=$GITHUB_SERVICE account=$KEYCHAIN_ACCOUNT"
}

provision_a2_gui() {
  validate_state
  local fifo="$ACTION_ARG" result="$STATE_DIR/provision-a2.result" runtime_token keychain_password
  [[ "${fifo:A}" == "${STATE_DIR:A}"/* && -p "$fifo" ]] || die "FIFO de provisión inválido"
  IFS= read -r runtime_token < "$fifo"
  [[ -n "$runtime_token" ]] || die "Token GitHub vacío"
  keychain_password="$(github_keychain_password)"
  if [[ -f "$GITHUB_KEYCHAIN_PATH" ]]; then
    /usr/bin/security unlock-keychain -p "$keychain_password" "$GITHUB_KEYCHAIN_PATH" >/dev/null
  else
    /usr/bin/security create-keychain -p "$keychain_password" "$GITHUB_KEYCHAIN_PATH"
    chmod 600 "$GITHUB_KEYCHAIN_PATH"
  fi
  /usr/bin/security add-generic-password -U -a "$KEYCHAIN_ACCOUNT" -s "$GITHUB_SERVICE" -w "$runtime_token" "$GITHUB_KEYCHAIN_PATH" >/dev/null
  unset runtime_token keychain_password
  github_keychain_has || die "No se pudo verificar el token GitHub dedicado"
  print -r -- "A2_KEYCHAIN_READY" > "$result"
}

provision_a2() {
  validate_state; keychain_has || die "Falta HMAC en Keychain service=$HMAC_SERVICE"
  mkdir -p "$STATE_DIR" "$LOGS" "$HOME/Library/LaunchAgents"; chmod 700 "$STATE_DIR" "$LOGS"
  local fifo="$STATE_DIR/provision-a2.fifo" result="$STATE_DIR/provision-a2.result"
  local helper_plist="$HOME/Library/LaunchAgents/com.esw.company-os-engineering-v2-provision.plist"
  local helper_label="com.esw.company-os-engineering-v2-provision" runtime_token attempt
  rm -f "$fifo" "$result" "$helper_plist"
  /usr/bin/mkfifo -m 600 "$fifo"
  /bin/cat > "$helper_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$helper_label</string>
<key>ProgramArguments</key><array><string>/bin/zsh</string><string>$SCRIPT_PATH</string><string>__provision_a2_gui</string><string>$fifo</string></array>
<key>RunAtLoad</key><true/><key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>$LOGS/provision-a2.log</string><key>StandardErrorPath</key><string>$LOGS/provision-a2.log</string>
</dict></plist>
EOF
  plutil -lint "$helper_plist" >/dev/null
  launchctl bootout "gui/$(id -u)/$helper_label" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$helper_plist"
  IFS= read -r runtime_token
  [[ -n "$runtime_token" ]] || die "Token GitHub vacío"
  print -r -- "$runtime_token" > "$fifo"
  unset runtime_token
  for attempt in {1..20}; do
    [[ -f "$result" ]] && break
    sleep 1
  done
  launchctl bootout "gui/$(id -u)/$helper_label" >/dev/null 2>&1 || true
  rm -f "$fifo" "$helper_plist"
  [[ -f "$result" && "$(<"$result")" == "A2_KEYCHAIN_READY" ]] || die "Provisión A2 falló; revisar $LOGS/provision-a2.log"
  rm -f "$result"
  say "A2_KEYCHAIN_READY service=$GITHUB_SERVICE dedicated=true"
}

gui_dispatch() {
  local requested="$ACTION_ARG" result="$STATE_DIR/gui-action.result"
  [[ "$requested" == "doctor" || "$requested" == "install" || "$requested" == "status" ]] || die "Acción GUI inválida"
  if /bin/zsh "$SCRIPT_PATH" "$requested" >> "$LOGS/gui-action.log" 2>&1; then
    print -r -- "GUI_ACTION_OK" > "$result"
  else
    print -r -- "GUI_ACTION_FAILED" > "$result"
  fi
}

run_gui() {
  local requested="$ACTION_ARG"
  [[ "$requested" == "doctor" || "$requested" == "install" || "$requested" == "status" ]] || die "Uso: manage.sh gui doctor|install|status"
  validate_state; mkdir -p "$STATE_DIR" "$LOGS" "$HOME/Library/LaunchAgents"; chmod 700 "$STATE_DIR" "$LOGS"
  local result="$STATE_DIR/gui-action.result" helper_plist="$HOME/Library/LaunchAgents/com.esw.company-os-engineering-v2-helper.plist"
  local helper_label="com.esw.company-os-engineering-v2-helper" attempt
  rm -f "$result" "$helper_plist"
  /bin/cat > "$helper_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$helper_label</string>
<key>ProgramArguments</key><array><string>/bin/zsh</string><string>$SCRIPT_PATH</string><string>__gui_dispatch</string><string>$requested</string></array>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
<key>COMPANY_OS_ENGINEERING_SOURCE_REPO</key><string>${COMPANY_OS_ENGINEERING_SOURCE_REPO:-${SCRIPT_DIR:h:h}}</string>
<key>COMPANY_OS_ENGINEERING_NODE_BIN</key><string>$NODE_BIN</string>
<key>COMPANY_OS_ENGINEERING_GIT_BIN</key><string>$GIT_BIN</string>
<key>COMPANY_OS_ENGINEERING_GH_BIN</key><string>$GH_BIN</string>
<key>COMPANY_OS_ENGINEERING_DOCKER_BIN</key><string>$DOCKER_BIN</string>
<key>COMPANY_OS_ENGINEERING_CODEX_IMAGE</key><string>$CODEX_IMAGE</string>
<key>COMPANY_OS_ENGINEERING_CODEX_AUTH_DIR</key><string>${CODEX_AUTH_DIR:A}</string>
<key>COMPANY_OS_ENGINEERING_REPOSITORY_PATH</key><string>${COMPANY_OS_ENGINEERING_REPOSITORY_PATH:-}</string>
<key>COMPANY_OS_ENGINEERING_REPOSITORY_SLUG</key><string>${COMPANY_OS_ENGINEERING_REPOSITORY_SLUG:-}</string>
<key>COMPANY_OS_ENGINEERING_MAX_AUTONOMY</key><string>${COMPANY_OS_ENGINEERING_MAX_AUTONOMY:-A1}</string>
<key>COMPANY_OS_ENGINEERING_API_BASE_URL</key><string>${COMPANY_OS_ENGINEERING_API_BASE_URL:-https://webapp-weld-psi.vercel.app}</string>
<key>COMPANY_OS_ENGINEERING_STATE_DIR</key><string>$STATE_DIR</string>
<key>COMPANY_OS_ENGINEERING_HEALTH_PORT</key><string>$HEALTH_PORT</string>
<key>COMPANY_OS_ENGINEERING_HMAC_KEYCHAIN_SERVICE</key><string>$HMAC_SERVICE</string>
<key>COMPANY_OS_ENGINEERING_GITHUB_KEYCHAIN_SERVICE</key><string>$GITHUB_SERVICE</string>
<key>COMPANY_OS_ENGINEERING_GITHUB_KEYCHAIN_PATH</key><string>${GITHUB_KEYCHAIN_PATH:A}</string>
<key>COMPANY_OS_ENGINEERING_KEYCHAIN_ACCOUNT</key><string>$KEYCHAIN_ACCOUNT</string>
</dict>
<key>RunAtLoad</key><true/><key>ProcessType</key><string>Background</string>
<key>StandardOutPath</key><string>$LOGS/gui-action.log</string><key>StandardErrorPath</key><string>$LOGS/gui-action.log</string>
</dict></plist>
EOF
  plutil -lint "$helper_plist" >/dev/null
  launchctl bootout "gui/$(id -u)/$helper_label" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$helper_plist"
  for attempt in {1..60}; do
    [[ -f "$result" ]] && break
    sleep 1
  done
  launchctl bootout "gui/$(id -u)/$helper_label" >/dev/null 2>&1 || true
  rm -f "$helper_plist"
  [[ -f "$result" && "$(<"$result")" == "GUI_ACTION_OK" ]] || die "Acción GUI $requested falló; revisar $LOGS/gui-action.log"
  rm -f "$result"
  say "GUI_ACTION_OK action=$requested"
}

auth_ready() {
  [[ "${COMPANY_OS_ENGINEERING_MAX_AUTONOMY:-A1}" != "A2" ]] || github_keychain_has || die "Falta token GitHub A2 en Keychain service=$GITHUB_SERVICE"
}

docker_sandbox_ready() {
  local repo probe sandbox_config
  repo="$(source_repo)"; sandbox_config="$repo/webapp/company-os-engineering-worker/sandbox-config.toml"
  probe="$(mktemp -d "$STATE_DIR/.sandbox-probe.XXXXXX")"
  "$GIT_BIN" -C "$probe" init -q
  if ! "$DOCKER_BIN" run --rm --read-only --cap-drop ALL --security-opt no-new-privileges --security-opt seccomp=unconfined \
    --user "$(id -u):$(id -g)" --pids-limit 64 --memory 512m --cpus 1 \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    --tmpfs "/codex-home:rw,noexec,nosuid,size=64m,uid=$(id -u),gid=$(id -g),mode=0700" \
    --mount "type=bind,src=${probe:A},dst=/workspace" \
    --mount "type=bind,src=${CODEX_AUTH_DIR:A}/auth.json,dst=/codex-home/auth.json,readonly" \
    --mount "type=bind,src=${sandbox_config:A},dst=/codex-home/config.toml,readonly" \
    -e CODEX_HOME=/codex-home "$CODEX_IMAGE" \
    codex sandbox -P engineering -C /workspace -- /bin/bash -c 'set -eu; test ! -r /codex-home/auth.json; node -e '\''fetch("https://example.com").then(()=>process.exit(42)).catch(()=>process.exit(0))'\''; touch /workspace/write-ok; test -f /workspace/write-ok; ! touch /etc/company-os-probe 2>/dev/null' \
    >/dev/null 2>&1; then
    rm -rf "$probe"
    die "Sandbox no confirmó límites de lectura, escritura y red"
  fi
  rm -rf "$probe"
}

loaded() { launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; }
healthy() {
  /usr/bin/curl -fsS --max-time 3 "http://127.0.0.1:$HEALTH_PORT/health" 2>/dev/null | "$NODE_BIN" -e '
    let s=""; process.stdin.on("data",c=>s+=c).on("end",()=>{try{const v=JSON.parse(s);process.exit(v.service==="company-os-engineering-v2"&&v.ok===true?0:1)}catch{process.exit(1)}})
  '
}

render_plist() {
  local destination="$1"
  /bin/cat > "$destination" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>/bin/zsh</string><string>$CURRENT/manage.sh</string><string>__run</string></array>
<key>WorkingDirectory</key><string>$CURRENT/worker</string>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
<key>COMPANY_OS_ENGINEERING_NODE_BIN</key><string>$NODE_BIN</string>
<key>COMPANY_OS_ENGINEERING_GIT_BIN</key><string>$GIT_BIN</string>
<key>COMPANY_OS_ENGINEERING_GH_BIN</key><string>$GH_BIN</string>
<key>COMPANY_OS_ENGINEERING_DOCKER_BIN</key><string>$DOCKER_BIN</string>
<key>COMPANY_OS_ENGINEERING_CODEX_IMAGE</key><string>$CODEX_IMAGE</string>
<key>COMPANY_OS_ENGINEERING_CODEX_AUTH_DIR</key><string>${CODEX_AUTH_DIR:A}</string>
<key>COMPANY_OS_ENGINEERING_REPOSITORY_PATH</key><string>${COMPANY_OS_ENGINEERING_REPOSITORY_PATH}</string>
<key>COMPANY_OS_ENGINEERING_REPOSITORY_SLUG</key><string>${COMPANY_OS_ENGINEERING_REPOSITORY_SLUG}</string>
<key>COMPANY_OS_ENGINEERING_MAX_AUTONOMY</key><string>${COMPANY_OS_ENGINEERING_MAX_AUTONOMY:-A1}</string>
<key>COMPANY_OS_ENGINEERING_API_BASE_URL</key><string>${COMPANY_OS_ENGINEERING_API_BASE_URL:-https://webapp-weld-psi.vercel.app}</string>
<key>COMPANY_OS_ENGINEERING_STATE_DIR</key><string>$STATE_DIR</string>
<key>COMPANY_OS_ENGINEERING_HEALTH_PORT</key><string>$HEALTH_PORT</string>
<key>COMPANY_OS_ENGINEERING_HMAC_KEYCHAIN_SERVICE</key><string>$HMAC_SERVICE</string>
<key>COMPANY_OS_ENGINEERING_GITHUB_KEYCHAIN_SERVICE</key><string>$GITHUB_SERVICE</string>
<key>COMPANY_OS_ENGINEERING_GITHUB_KEYCHAIN_PATH</key><string>${GITHUB_KEYCHAIN_PATH:A}</string>
<key>COMPANY_OS_ENGINEERING_KEYCHAIN_ACCOUNT</key><string>$KEYCHAIN_ACCOUNT</string>
</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ProcessType</key><string>Background</string><key>ThrottleInterval</key><integer>15</integer>
<key>StandardOutPath</key><string>$LOGS/stdout.log</string><key>StandardErrorPath</key><string>$LOGS/stderr.log</string>
</dict></plist>
EOF
}

snapshot() {
  local label="$1" stamp backup
  stamp="$(date '+%Y%m%dT%H%M%S')"; backup="$BACKUPS/$stamp-$label"
  mkdir -p "$backup"
  [[ -d "$CURRENT" ]] && /usr/bin/ditto "$CURRENT" "$backup/current" || touch "$backup/ABSENT_CURRENT"
  [[ -f "$PLIST" ]] && cp -p "$PLIST" "$backup/launchd.plist" || touch "$backup/ABSENT_PLIST"
  print -r -- "$backup" > "$STATE_DIR/last-backup"
  print -r -- "$backup"
}

bootout() { launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true; }
bootstrap() { launchctl bootstrap "gui/$(id -u)" "$PLIST"; launchctl kickstart "gui/$(id -u)/$LABEL"; }

doctor() {
  validate_state; check_bins; check_target_repo; keychain_has || die "Falta HMAC en Keychain service=$HMAC_SERVICE"; auth_ready; docker_sandbox_ready
  local repo; repo="$(source_repo)"
  "$NODE_BIN" --check "$repo/webapp/company-os-engineering-worker/src/server.mjs"
  (cd "$repo/webapp/company-os-engineering-worker" && "$NODE_BIN" --test test/*.test.mjs)
  if /usr/sbin/lsof -nP -iTCP:"$HEALTH_PORT" -sTCP:LISTEN >/dev/null 2>&1 && ! healthy; then die "Puerto $HEALTH_PORT ocupado"; fi
  say "DOCTOR_OK repo=$repo target=${COMPANY_OS_ENGINEERING_REPOSITORY_SLUG} maxAutonomy=${COMPANY_OS_ENGINEERING_MAX_AUTONOMY:-A1}"
}

install() {
  doctor
  mkdir -p "$STATE_DIR" "$BACKUPS" "$LOGS" "$HOME/Library/LaunchAgents"; chmod 700 "$STATE_DIR" "$BACKUPS" "$LOGS"
  local repo stage backup; repo="$(source_repo)"; stage="$(mktemp -d "$STATE_DIR/.install.XXXXXX")"
  mkdir -p "$stage/current"; /usr/bin/ditto "$repo/webapp/company-os-engineering-worker" "$stage/current/worker"
  cp "$repo/company-os/engineering-runtime/manage.sh" "$stage/current/manage.sh"; chmod 700 "$stage/current/manage.sh"
  render_plist "$stage/launchd.plist"; plutil -lint "$stage/launchd.plist" >/dev/null
  backup="$(snapshot pre-install)"; bootout
  [[ -d "$CURRENT" ]] && mv "$CURRENT" "$backup/displaced-current"
  [[ -f "$PLIST" ]] && mv "$PLIST" "$backup/displaced-launchd.plist"
  mv "$stage/current" "$CURRENT"; mv "$stage/launchd.plist" "$PLIST"
  if ! bootstrap; then die "bootstrap falló; usar rollback"; fi
  local attempt; for attempt in {1..20}; do healthy && { say "INSTALL_OK backup=$backup"; return; }; sleep 1; done
  die "Instalado sin health; ejecutar rollback"
}

status() {
  say "label=$LABEL loaded=$(loaded && print true || print false) installed=$([[ -f "$CURRENT/worker/src/server.mjs" ]] && print true || print false)"
  /usr/bin/curl -sS --max-time 3 "http://127.0.0.1:$HEALTH_PORT/health" 2>/dev/null || true
  loaded && healthy
}

rollback() {
  validate_state; [[ -f "$STATE_DIR/last-backup" ]] || die "No hay backup"
  local target safety; target="$(<"$STATE_DIR/last-backup")"
  [[ "${target:A}" == "${BACKUPS:A}"/* && -d "$target" ]] || die "Backup inválido"
  safety="$(snapshot pre-rollback)"; bootout
  [[ -d "$CURRENT" ]] && mv "$CURRENT" "$safety/displaced-current"
  [[ -f "$PLIST" ]] && mv "$PLIST" "$safety/displaced-launchd.plist"
  [[ -d "$target/current" ]] && /usr/bin/ditto "$target/current" "$CURRENT"
  [[ -f "$target/launchd.plist" ]] && cp -p "$target/launchd.plist" "$PLIST"
  [[ -f "$PLIST" ]] && bootstrap
  say "ROLLBACK_OK restored=$target safety=$safety"
}

uninstall() {
  validate_state; mkdir -p "$BACKUPS"; local backup; backup="$(snapshot pre-uninstall)"; bootout
  [[ -d "$CURRENT" ]] && mv "$CURRENT" "$backup/displaced-current"
  [[ -f "$PLIST" ]] && mv "$PLIST" "$backup/displaced-launchd.plist"
  say "UNINSTALL_OK recoverable=true backup=$backup"
}

run() {
  validate_state; check_bins
  export COMPANY_OS_ENGINEERING_HMAC_SECRET="$(keychain_get)"
  if [[ "${COMPANY_OS_ENGINEERING_MAX_AUTONOMY:-A1}" == "A2" ]]; then
    export COMPANY_OS_ENGINEERING_GITHUB_TOKEN="$(github_keychain_get)"
  else
    unset COMPANY_OS_ENGINEERING_GITHUB_TOKEN GH_TOKEN GH_CONFIG_DIR
  fi
  exec "$NODE_BIN" "$CURRENT/worker/src/server.mjs"
}

case "$ACTION" in
  provision-a2) provision_a2 ;;
  gui) run_gui ;;
  doctor) doctor ;;
  install) install ;;
  status) status ;;
  rollback) rollback ;;
  uninstall) uninstall ;;
  __run) run ;;
  __provision_a2_gui) provision_a2_gui ;;
  __gui_dispatch) gui_dispatch ;;
  *) die "Uso: manage.sh provision-a2|gui doctor|gui install|gui status|doctor|install|status|rollback|uninstall" ;;
esac
