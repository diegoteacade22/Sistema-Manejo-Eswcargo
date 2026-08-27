#!/bin/zsh
set -euo pipefail
umask 077

ACTION="${1:-}"
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
github_keychain_has() { /usr/bin/security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$GITHUB_SERVICE" >/dev/null 2>&1; }
github_keychain_get() { /usr/bin/security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$GITHUB_SERVICE" -w 2>/dev/null || die "Falta token GitHub en Keychain service=$GITHUB_SERVICE account=$KEYCHAIN_ACCOUNT"; }

auth_ready() {
  [[ "${COMPANY_OS_ENGINEERING_MAX_AUTONOMY:-A1}" != "A2" ]] || github_keychain_has || die "Falta token GitHub A2 en Keychain service=$GITHUB_SERVICE"
}

docker_sandbox_ready() {
  "$DOCKER_BIN" run --rm --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 512m --cpus 1 \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    --mount "type=bind,src=${CODEX_AUTH_DIR:A},dst=/codex-auth,ro" -e CODEX_HOME=/codex-auth "$CODEX_IMAGE" \
    codex sandbox linux --sandbox workspace-write -- node -e 'fetch("https://example.com").then(()=>process.exit(42)).catch(()=>process.exit(0))' \
    >/dev/null 2>&1 || die "Sandbox interno permitió red o no pudo verificarse"
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
  doctor) doctor ;;
  install) install ;;
  status) status ;;
  rollback) rollback ;;
  uninstall) uninstall ;;
  __run) run ;;
  *) die "Uso: manage.sh doctor|install|status|rollback|uninstall" ;;
esac
