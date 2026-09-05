#!/bin/zsh
set -euo pipefail
umask 077

ACTION="${1:-}"
SCRIPT_PATH="${0:A}"
SCRIPT_DIR="${SCRIPT_PATH:h}"
RUNTIME_STATE_DIR="${COMPANY_OS_RUNTIME_STATE_DIR:-$HOME/.company-os-runtime}"
CURRENT_DIR="$RUNTIME_STATE_DIR/current"
BACKUPS_DIR="$RUNTIME_STATE_DIR/backups"
LOG_DIR="${COMPANY_OS_RUNTIME_LOG_DIR:-$RUNTIME_STATE_DIR/logs}"
PLIST="$HOME/Library/LaunchAgents/com.esw.company-os-runtime.plist"
LAUNCH_LABEL="com.esw.company-os-runtime"
RUNTIME_API_BASE_URL="${COMPANY_OS_RUNTIME_API_BASE_URL:-https://webapp-weld-psi.vercel.app}"
RUNTIME_ALLOWED_HOSTS="${COMPANY_OS_RUNTIME_ALLOWED_HOSTS:-webapp-weld-psi.vercel.app,app.eswcargo.com}"
RUNTIME_WORKER_ID="${COMPANY_OS_RUNTIME_WORKER_ID:-diegoserver-company-os}"
RUNTIME_HEALTH_PORT="${COMPANY_OS_RUNTIME_HEALTH_PORT:-8794}"
RUNTIME_ALLOWED_AGENT_IDS="${COMPANY_OS_RUNTIME_ALLOWED_AGENT_IDS:-general-manager-ai-v3,systems-manager-ai-v1,data-manager-ai-v1}"
RUNTIME_HMAC_KEYCHAIN_SERVICE="${COMPANY_OS_RUNTIME_HMAC_KEYCHAIN_SERVICE:-com.esw.company-os-runtime.hmac}"
RUNTIME_OPENAI_KEYCHAIN_SERVICE="${COMPANY_OS_RUNTIME_OPENAI_KEYCHAIN_SERVICE:-OPENAI_API_KEY}"
RUNTIME_GOOGLE_KEYCHAIN_SERVICE="${COMPANY_OS_RUNTIME_GOOGLE_KEYCHAIN_SERVICE:-com.esw.company-os-runtime.google-service-account}"
RUNTIME_EXTERNAL_IDENTITY_KEYCHAIN_SERVICE="${COMPANY_OS_RUNTIME_EXTERNAL_IDENTITY_KEYCHAIN_SERVICE:-com.esw.company-os-runtime.external-identity-v1}"
RUNTIME_CHATGPT_WORK_PROJECT_IDS_EXPLICIT="${+COMPANY_OS_RUNTIME_CHATGPT_WORK_PROJECT_IDS}"
RUNTIME_CHATGPT_WORK_PROJECT_IDS="${COMPANY_OS_RUNTIME_CHATGPT_WORK_PROJECT_IDS:-}"
RUNTIME_OLLAMA_FALLBACK_ENABLED="${COMPANY_OS_RUNTIME_OLLAMA_FALLBACK_ENABLED:-true}"
RUNTIME_OLLAMA_BASE_URL="${COMPANY_OS_RUNTIME_OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
RUNTIME_OLLAMA_MODEL="${COMPANY_OS_RUNTIME_OLLAMA_MODEL:-qwen3:14b-q4_K_M}"
RUNTIME_LOCAL_LINEAGE_MODEL="${COMPANY_OS_RUNTIME_LOCAL_LINEAGE_MODEL:-qwen3:4b-q4_K_M}"
RUNTIME_KEYCHAIN_ACCOUNT="${COMPANY_OS_RUNTIME_KEYCHAIN_ACCOUNT:-$(id -un)}"
EXTERNAL_NOTIFICATIONS_ENABLED="${COMPANY_OS_RUNTIME_EXTERNAL_NOTIFICATIONS_ENABLED:-false}"
NODE_BIN="${COMPANY_OS_RUNTIME_NODE_BIN:-$(command -v node 2>/dev/null || true)}"

say() { print -r -- "$*"; }
die() { print -r -- "ERROR: $*" >&2; exit 1; }

validate_state_dir() {
  local resolved="${RUNTIME_STATE_DIR:A}"
  [[ -n "$resolved" && "$resolved" != "/" && "$resolved" != "$HOME" ]] || die "COMPANY_OS_RUNTIME_STATE_DIR inseguro: $resolved"
  case "$resolved" in
    "$HOME"/*) ;;
    *) die "COMPANY_OS_RUNTIME_STATE_DIR debe estar dentro del home del usuario" ;;
  esac
}

valid_repo() {
  local candidate="$1"
  [[ -e "$candidate/.git" \
    && -f "$candidate/webapp/company-os-worker/src/server.mjs" \
    && -f "$candidate/company-os/runtime/manage.sh" ]]
}

detect_repo() {
  local candidate root found
  if [[ -n "${COMPANY_OS_RUNTIME_SOURCE_REPO:-}" ]] && valid_repo "$COMPANY_OS_RUNTIME_SOURCE_REPO"; then
    print -r -- "${COMPANY_OS_RUNTIME_SOURCE_REPO:A}"
    return
  fi
  if [[ -x "$NODE_BIN" && -f "$CURRENT_DIR/install-manifest.json" ]]; then
    candidate="$("$NODE_BIN" -p 'try { JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).sourceRepo || "" } catch { "" }' "$CURRENT_DIR/install-manifest.json" 2>/dev/null || true)"
    if [[ -n "$candidate" ]] && valid_repo "$candidate"; then
      print -r -- "${candidate:A}"
      return
    fi
  fi
  candidate="$(cd "$SCRIPT_DIR/../.." 2>/dev/null && pwd -P || true)"
  if [[ -n "$candidate" ]] && valid_repo "$candidate"; then
    print -r -- "$candidate"
    return
  fi
  root="$(git -C "$PWD" rev-parse --show-toplevel 2>/dev/null || true)"
  if [[ -n "$root" ]] && valid_repo "$root"; then
    print -r -- "${root:A}"
    return
  fi
  for root in "$HOME/02_DESARROLLO" "$HOME/Documents"; do
    [[ -d "$root" ]] || continue
    found="$(find "$root" -maxdepth 9 -type f -path '*/webapp/company-os-worker/src/server.mjs' -print 2>/dev/null | head -1)"
    if [[ -n "$found" ]]; then
      candidate="${found%/webapp/company-os-worker/src/server.mjs}"
      if valid_repo "$candidate"; then
        print -r -- "${candidate:A}"
        return
      fi
    fi
  done
  die "No se encontró el repositorio real con webapp/company-os-worker y company-os/runtime"
}

ensure_node() {
  [[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || die "Falta node en PATH; se requiere Node.js >=22"
  local major
  major="$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])')"
  [[ "$major" -ge 22 ]] || die "Node.js >=22 requerido; detectado major=$major"
}

validate_api_origin() {
  "$NODE_BIN" -e '
    const value = process.argv[1];
    const allowed = process.argv[2].split(",").map((item) => item.trim()).filter(Boolean);
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || !allowed.includes(url.hostname)) process.exit(1);
  ' "$RUNTIME_API_BASE_URL" "$RUNTIME_ALLOWED_HOSTS" || die "COMPANY_OS_RUNTIME_API_BASE_URL debe ser un origen HTTPS incluido en COMPANY_OS_RUNTIME_ALLOWED_HOSTS"
}

check_ollama_fallback() {
  case "${RUNTIME_OLLAMA_FALLBACK_ENABLED:l}" in
    false|0|no)
      RUNTIME_OLLAMA_FALLBACK_ENABLED=false
      ;;
    true|1|yes) RUNTIME_OLLAMA_FALLBACK_ENABLED=true ;;
    *) die "COMPANY_OS_RUNTIME_OLLAMA_FALLBACK_ENABLED debe ser true o false" ;;
  esac
  [[ "$RUNTIME_LOCAL_LINEAGE_MODEL" == "qwen3:4b-q4_K_M" ]] \
    || die "COMPANY_OS_RUNTIME_LOCAL_LINEAGE_MODEL debe ser el modelo local permitido qwen3:4b-q4_K_M"

  "$NODE_BIN" -e '
    try {
      const url = new URL(process.argv[1]);
      const loopback = url.hostname === "127.0.0.1" || url.hostname === "[::1]";
      if (url.protocol !== "http:" || !loopback || url.username || url.password
        || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) process.exit(1);
    } catch { process.exit(1); }
  ' "$RUNTIME_OLLAMA_BASE_URL" \
    || die "COMPANY_OS_RUNTIME_OLLAMA_BASE_URL debe ser un origen HTTP loopback puro"

  local tags
  tags="$(/usr/bin/curl -sS --fail --location --max-redirs 0 --max-time 5 \
    --proto '=http' --proto-redir '=http' "$RUNTIME_OLLAMA_BASE_URL/api/tags" 2>/dev/null)" \
    || die "Ollama local no respondió de forma válida en /api/tags"
  print -rn -- "$tags" | "$NODE_BIN" -e '
    let input=""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => {
      try {
        const value = JSON.parse(input);
        const required = [process.argv[2], ...(process.argv[3] === "true" ? [process.argv[1]] : [])];
        const exact = Array.isArray(value.models) && required.every((expected) => value.models.some((item) => item && item.name === expected));
        process.exit(exact ? 0 : 1);
      } catch { process.exit(1); }
    });
  ' "$RUNTIME_OLLAMA_MODEL" "$RUNTIME_LOCAL_LINEAGE_MODEL" "$RUNTIME_OLLAMA_FALLBACK_ENABLED" \
    || die "Ollama local no contiene los modelos requeridos para linaje Data y fallback habilitado"
}

keychain_has() {
  /usr/bin/security find-generic-password -a "$RUNTIME_KEYCHAIN_ACCOUNT" -s "$1" -w >/dev/null 2>&1
}

keychain_get() {
  local service="$1" value
  value="$(/usr/bin/security find-generic-password -a "$RUNTIME_KEYCHAIN_ACCOUNT" -s "$service" -w 2>/dev/null)" \
    || die "Falta credencial Keychain service=$service account=$RUNTIME_KEYCHAIN_ACCOUNT"
  [[ -n "$value" ]] || die "Credencial Keychain vacía service=$service account=$RUNTIME_KEYCHAIN_ACCOUNT"
  print -rn -- "$value"
}

check_keychain_credentials() {
  case "${EXTERNAL_NOTIFICATIONS_ENABLED:l}" in
    false|0|no) EXTERNAL_NOTIFICATIONS_ENABLED=false ;;
    true|1|yes) die "Las notificaciones externas deben permanecer deshabilitadas en la instalación Mac genérica" ;;
    *) die "COMPANY_OS_RUNTIME_EXTERNAL_NOTIFICATIONS_ENABLED debe ser false" ;;
  esac
  keychain_has "$RUNTIME_HMAC_KEYCHAIN_SERVICE" \
    || die "Falta credencial Keychain service=$RUNTIME_HMAC_KEYCHAIN_SERVICE account=$RUNTIME_KEYCHAIN_ACCOUNT"
  keychain_has "$RUNTIME_OPENAI_KEYCHAIN_SERVICE" \
    || die "Falta credencial Keychain service=$RUNTIME_OPENAI_KEYCHAIN_SERVICE account=$RUNTIME_KEYCHAIN_ACCOUNT"
  keychain_has "$RUNTIME_EXTERNAL_IDENTITY_KEYCHAIN_SERVICE" \
    || die "Falta credencial Keychain service=$RUNTIME_EXTERNAL_IDENTITY_KEYCHAIN_SERVICE account=$RUNTIME_KEYCHAIN_ACCOUNT"
}

ensure_external_identity_keychain() {
  local payload
  if keychain_has "$RUNTIME_EXTERNAL_IDENTITY_KEYCHAIN_SERVICE"; then return; fi
  payload="$(/usr/bin/openssl rand -hex 32)"
  [[ ${#payload} -eq 64 && "$payload" != *[^0-9a-f]* ]] \
    || die "No se pudo generar la identidad estable de fuentes externas"
  /usr/bin/security add-generic-password -U -a "$RUNTIME_KEYCHAIN_ACCOUNT" -s "$RUNTIME_EXTERNAL_IDENTITY_KEYCHAIN_SERVICE" -w "$payload" >/dev/null \
    || die "No se pudo guardar la identidad estable de fuentes externas en Keychain"
  unset payload
  keychain_has "$RUNTIME_EXTERNAL_IDENTITY_KEYCHAIN_SERVICE" \
    || die "No se pudo verificar la identidad estable de fuentes externas en Keychain"
}

google_keychain_has() {
  /usr/bin/security find-generic-password -a "$RUNTIME_KEYCHAIN_ACCOUNT" -s "$RUNTIME_GOOGLE_KEYCHAIN_SERVICE" -w >/dev/null 2>&1
}

ensure_google_keychain() {
  local repo="$1" source_path payload
  if google_keychain_has; then return; fi
  source_path="${COMPANY_OS_RUNTIME_GOOGLE_CREDENTIALS_PATH:-$repo/google_credentials.json}"
  [[ -f "$source_path" ]] || source_path="$HOME/02_DESARROLLO/02_Activos_Deploy/Sistema-Manejo-Eswcargo/google_credentials.json"
  [[ -f "$source_path" ]] || die "Falta archivo local de credenciales Google para inicializar Keychain"
  "$NODE_BIN" -e 'const fs=require("node:fs"); const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(j.type!=="service_account" || typeof j.client_email!=="string" || typeof j.private_key!=="string") process.exit(1)' "$source_path" \
    || die "El archivo de credenciales Google no es una cuenta de servicio válida"
  payload="$(<"$source_path")"
  /usr/bin/security add-generic-password -U -a "$RUNTIME_KEYCHAIN_ACCOUNT" -s "$RUNTIME_GOOGLE_KEYCHAIN_SERVICE" -w "$payload" >/dev/null \
    || die "No se pudo guardar la credencial Google en Keychain"
  unset payload
  google_keychain_has || die "No se pudo verificar la credencial Google en Keychain"
}

ensure_dirs() {
  mkdir -p "$RUNTIME_STATE_DIR" "$BACKUPS_DIR" "$LOG_DIR" "$RUNTIME_STATE_DIR/bridges" "$HOME/Library/LaunchAgents"
  chmod 700 "$RUNTIME_STATE_DIR" "$BACKUPS_DIR" "$LOG_DIR" "$RUNTIME_STATE_DIR/bridges"
}

runtime_source_digest() {
  local worker_dir="$1"
  "$NODE_BIN" -e '
    const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
    const root=process.argv[1],files=[];
    function walk(dir){ for(const name of fs.readdirSync(dir).sort()){ const full=path.join(dir,name),stat=fs.lstatSync(full); if(stat.isSymbolicLink()) throw new Error("symlink"); if(stat.isDirectory()) walk(full); else if(stat.isFile()) files.push(full); } }
    walk(path.join(root,"src")); for(const name of ["package.json","package-lock.json"]) if(fs.existsSync(path.join(root,name))) files.push(path.join(root,name));
    const hash=crypto.createHash("sha256"); for(const file of [...new Set(files)].sort()){ hash.update(path.relative(root,file)); hash.update("\0"); hash.update(fs.readFileSync(file)); hash.update("\0"); } process.stdout.write(hash.digest("hex"));
  ' "$worker_dir"
}

write_install_manifest() {
  local install_dir="$1" repo="$2" source_commit="$3" worker_digest manage_digest
  worker_digest="$(runtime_source_digest "$install_dir/worker")"
  manage_digest="$(/usr/bin/shasum -a 256 "$install_dir/manage.sh" | /usr/bin/awk '{print $1}')"
  "$NODE_BIN" -e '
    const fs=require("node:fs"); const [target,sourceRepo,sourceCommit,workerSourceSha256,manageSha256]=process.argv.slice(1);
    fs.writeFileSync(target,JSON.stringify({schemaVersion:1,installedAt:new Date().toISOString(),sourceRepo,sourceCommit,workerSourceSha256,manageSha256})+"\n",{mode:0o600});
  ' "$install_dir/install-manifest.json" "$repo" "$source_commit" "$worker_digest" "$manage_digest"
  chmod 600 "$install_dir/install-manifest.json"
}

verify_install_manifest() {
  local install_dir="${1:-$CURRENT_DIR}" worker_digest manage_digest
  [[ -f "$install_dir/install-manifest.json" && -f "$install_dir/manage.sh" && -d "$install_dir/worker/src" ]] || return 1
  worker_digest="$(runtime_source_digest "$install_dir/worker")" || return 1
  manage_digest="$(/usr/bin/shasum -a 256 "$install_dir/manage.sh" | /usr/bin/awk '{print $1}')" || return 1
  "$NODE_BIN" -e '
    const fs=require("node:fs"),path=require("node:path"); const value=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const valid=value.schemaVersion===1 && typeof value.installedAt==="string" && !Number.isNaN(Date.parse(value.installedAt))
      && typeof value.sourceRepo==="string" && path.isAbsolute(value.sourceRepo) && /^[a-f0-9]{40}$/.test(value.sourceCommit)
      && value.workerSourceSha256===process.argv[2] && value.manageSha256===process.argv[3]; process.exit(valid?0:1);
  ' "$install_dir/install-manifest.json" "$worker_digest" "$manage_digest"
}

service_loaded() {
  launchctl print "gui/$(id -u)/$LAUNCH_LABEL" >/dev/null 2>&1
}

launchd_pid() {
  launchctl print "gui/$(id -u)/$LAUNCH_LABEL" 2>/dev/null | /usr/bin/awk '
    $1 == "pid" && $2 == "=" && $3 ~ /^[0-9]+$/ { print $3; exit }
  '
}

listener_pids() {
  /usr/sbin/lsof -nP -tiTCP:"$RUNTIME_HEALTH_PORT" -sTCP:LISTEN 2>/dev/null \
    | /usr/bin/awk '!seen[$0]++ { print }'
}

port_has_listener() {
  [[ -n "$(listener_pids || true)" ]]
}

runtime_listener_is_owned() {
  local service_pid listeners
  service_loaded || return 1
  service_pid="$(launchd_pid || true)"
  [[ "$service_pid" == <-> && "$service_pid" -gt 1 ]] || return 1
  listeners="$(listener_pids || true)"
  [[ "$listeners" == "$service_pid" ]]
}

health_body() {
  /usr/bin/curl -sS --max-time 3 "http://127.0.0.1:$RUNTIME_HEALTH_PORT/health" 2>/dev/null
}

health_is_own_runtime() {
  local body
  body="$(health_body || true)"
  [[ -n "$body" ]] || return 1
  print -rn -- "$body" | "$NODE_BIN" -e '
    let input=""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => {
      try { const value=JSON.parse(input); process.exit(value.service === "company-os-runtime" ? 0 : 1); }
      catch { process.exit(1); }
    });
  '
}

health_is_own_operational() {
  local body
  body="$(health_body || true)"
  [[ -n "$body" ]] || return 1
  print -rn -- "$body" | "$NODE_BIN" -e '
    let input=""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => {
      try {
        const value=JSON.parse(input);
        const remoteHeartbeatConfirmed = typeof value.lastWorkerHeartbeatAt === "string" && !Number.isNaN(Date.parse(value.lastWorkerHeartbeatAt));
        const operational = value.acceptingWork === true && ["IDLE", "BUSY"].includes(value.state);
        process.exit(value.service === "company-os-runtime" && value.ok === true && remoteHeartbeatConfirmed && operational ? 0 : 1);
      }
      catch { process.exit(1); }
    });
  '
}

health_is_target_runtime() {
  local body
  body="$(health_body || true)"
  [[ -n "$body" ]] || return 1
  print -rn -- "$body" | "$NODE_BIN" -e '
    let input=""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => {
      try {
        const value=JSON.parse(input);
        process.exit(value.service === "company-os-runtime" && value.binaryVersion === "1.1.0" && value.contractVersion === "runtime-v1" && /^[a-f0-9]{40}$/.test(value.sourceRevision) ? 0 : 1);
      }
      catch { process.exit(1); }
    });
  '
}

health_is_target_operational() {
  local body
  body="$(health_body || true)"
  [[ -n "$body" ]] || return 1
  print -rn -- "$body" | "$NODE_BIN" -e '
    let input=""; process.stdin.on("data", (chunk) => input += chunk); process.stdin.on("end", () => {
      try {
        const value=JSON.parse(input);
        const remoteHeartbeatConfirmed = typeof value.lastWorkerHeartbeatAt === "string" && !Number.isNaN(Date.parse(value.lastWorkerHeartbeatAt));
        const operational = value.acceptingWork === true && ["IDLE", "BUSY"].includes(value.state);
        const target = value.binaryVersion === "1.1.0" && value.contractVersion === "runtime-v1" && /^[a-f0-9]{40}$/.test(value.sourceRevision);
        process.exit(value.service === "company-os-runtime" && target && value.ok === true && remoteHeartbeatConfirmed && operational ? 0 : 1);
      }
      catch { process.exit(1); }
    });
  '
}

runtime_own_is_operational() {
  health_is_own_operational && runtime_listener_is_owned
}

runtime_own_is_identified() {
  health_is_own_runtime && runtime_listener_is_owned
}

runtime_target_is_identified() {
  health_is_target_runtime && runtime_listener_is_owned
}

runtime_target_is_operational() {
  health_is_target_operational && runtime_listener_is_owned
}

xml_escape() {
  print -r -- "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

load_chatgpt_project_ids_configuration() {
  local existing=""
  if [[ "$RUNTIME_CHATGPT_WORK_PROJECT_IDS_EXPLICIT" == "0" && -f "$PLIST" ]]; then
    existing="$(plutil -extract EnvironmentVariables.COMPANY_OS_RUNTIME_CHATGPT_WORK_PROJECT_IDS raw -o - "$PLIST" 2>/dev/null)" \
      || die "No se pudo conservar COMPANY_OS_RUNTIME_CHATGPT_WORK_PROJECT_IDS desde el plist vigente"
    RUNTIME_CHATGPT_WORK_PROJECT_IDS="$existing"
  fi
  "$NODE_BIN" -e '
    const raw = process.argv[1];
    const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
    const valid = values.length <= 50 && values.every((value) => /^[A-Za-z0-9._:-]{1,128}$/.test(value));
    process.exit(valid ? 0 : 1);
  ' "$RUNTIME_CHATGPT_WORK_PROJECT_IDS" \
    || die "COMPANY_OS_RUNTIME_CHATGPT_WORK_PROJECT_IDS contiene una allowlist inválida"
}

render_plist() {
  local destination="$1"
  local manage_path worker_path api_url allowed_hosts worker_id state_dir log_dir keychain_account hmac_service openai_service google_service external_identity_service chatgpt_project_ids agent_ids node_path
  manage_path="$(xml_escape "$CURRENT_DIR/manage.sh")"
  worker_path="$(xml_escape "$CURRENT_DIR/worker")"
  api_url="$(xml_escape "$RUNTIME_API_BASE_URL")"
  allowed_hosts="$(xml_escape "$RUNTIME_ALLOWED_HOSTS")"
  worker_id="$(xml_escape "$RUNTIME_WORKER_ID")"
  state_dir="$(xml_escape "$RUNTIME_STATE_DIR")"
  log_dir="$(xml_escape "$LOG_DIR")"
  keychain_account="$(xml_escape "$RUNTIME_KEYCHAIN_ACCOUNT")"
  hmac_service="$(xml_escape "$RUNTIME_HMAC_KEYCHAIN_SERVICE")"
  openai_service="$(xml_escape "$RUNTIME_OPENAI_KEYCHAIN_SERVICE")"
  google_service="$(xml_escape "$RUNTIME_GOOGLE_KEYCHAIN_SERVICE")"
  external_identity_service="$(xml_escape "$RUNTIME_EXTERNAL_IDENTITY_KEYCHAIN_SERVICE")"
  chatgpt_project_ids="$(xml_escape "$RUNTIME_CHATGPT_WORK_PROJECT_IDS")"
  agent_ids="$(xml_escape "$RUNTIME_ALLOWED_AGENT_IDS")"
  node_path="$(xml_escape "$NODE_BIN")"
  /bin/cat > "$destination" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LAUNCH_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/zsh</string><string>$manage_path</string><string>__run</string></array>
  <key>WorkingDirectory</key><string>$worker_path</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>COMPANY_OS_RUNTIME_NODE_BIN</key><string>$node_path</string>
    <key>COMPANY_OS_RUNTIME_API_BASE_URL</key><string>$api_url</string>
    <key>COMPANY_OS_RUNTIME_ALLOWED_HOSTS</key><string>$allowed_hosts</string>
    <key>COMPANY_OS_RUNTIME_WORKER_ID</key><string>$worker_id</string>
    <key>COMPANY_OS_RUNTIME_HEALTH_PORT</key><string>$RUNTIME_HEALTH_PORT</string>
    <key>COMPANY_OS_RUNTIME_ALLOWED_AGENT_IDS</key><string>$agent_ids</string>
    <key>COMPANY_OS_RUNTIME_STATE_DIR</key><string>$state_dir</string>
    <key>COMPANY_OS_RUNTIME_LOG_DIR</key><string>$log_dir</string>
    <key>COMPANY_OS_RUNTIME_CONSOLE_LOG_ENABLED</key><string>false</string>
    <key>COMPANY_OS_RUNTIME_EXTERNAL_NOTIFICATIONS_ENABLED</key><string>$EXTERNAL_NOTIFICATIONS_ENABLED</string>
    <key>COMPANY_OS_RUNTIME_KEYCHAIN_ACCOUNT</key><string>$keychain_account</string>
    <key>COMPANY_OS_RUNTIME_HMAC_KEYCHAIN_SERVICE</key><string>$hmac_service</string>
    <key>COMPANY_OS_RUNTIME_OPENAI_KEYCHAIN_SERVICE</key><string>$openai_service</string>
    <key>COMPANY_OS_RUNTIME_GOOGLE_KEYCHAIN_SERVICE</key><string>$google_service</string>
    <key>COMPANY_OS_RUNTIME_EXTERNAL_IDENTITY_KEYCHAIN_SERVICE</key><string>$external_identity_service</string>
    <key>COMPANY_OS_RUNTIME_CHATGPT_WORK_PROJECT_IDS</key><string>$chatgpt_project_ids</string>
    <key>COMPANY_OS_RUNTIME_OLLAMA_FALLBACK_ENABLED</key><string>$RUNTIME_OLLAMA_FALLBACK_ENABLED</string>
    <key>COMPANY_OS_RUNTIME_OLLAMA_BASE_URL</key><string>$(xml_escape "$RUNTIME_OLLAMA_BASE_URL")</string>
    <key>COMPANY_OS_RUNTIME_OLLAMA_MODEL</key><string>$(xml_escape "$RUNTIME_OLLAMA_MODEL")</string>
    <key>COMPANY_OS_RUNTIME_LOCAL_LINEAGE_MODEL</key><string>$(xml_escape "$RUNTIME_LOCAL_LINEAGE_MODEL")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>ExitTimeOut</key><integer>55</integer>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/dev/null</string>
  <key>StandardErrorPath</key><string>/dev/null</string>
</dict>
</plist>
EOF
}

backup_snapshot() {
  local label="$1" timestamp backup reference_tmp
  [[ -n "$label" && "$label" != *[^A-Za-z0-9._-]* ]] || die "Label de snapshot inválido"
  timestamp="$(date '+%Y%m%dT%H%M%S')"
  backup="$(mktemp -d "$BACKUPS_DIR/$timestamp-$label.XXXXXX")" \
    || die "No se pudo crear snapshot único"
  if [[ -d "$CURRENT_DIR" ]]; then /usr/bin/ditto "$CURRENT_DIR" "$backup/current"; else touch "$backup/ABSENT_CURRENT"; fi
  if [[ -f "$PLIST" ]]; then cp -p "$PLIST" "$backup/launchd.plist"; else touch "$backup/ABSENT_PLIST"; fi
  {
    print -r -- "createdAt=$timestamp"
    print -r -- "label=$label"
    print -r -- "workerId=$RUNTIME_WORKER_ID"
  } > "$backup/manifest.txt"
  reference_tmp="$(mktemp "$RUNTIME_STATE_DIR/.last-backup.XXXXXX")" \
    || die "No se pudo crear referencia temporal de snapshot"
  print -r -- "$backup" > "$reference_tmp"
  chmod 600 "$reference_tmp"
  mv -f "$reference_tmp" "$RUNTIME_STATE_DIR/last-backup"
  print -r -- "$backup"
}

restore_snapshot() {
  local backup="$1"
  [[ -d "$backup" ]] || return 1
  if [[ -d "$backup/current" && -f "$backup/launchd.plist" ]]; then
    /usr/bin/ditto "$backup/current" "$CURRENT_DIR"
    cp -p "$backup/launchd.plist" "$PLIST"
    return 0
  fi
  [[ -f "$backup/ABSENT_CURRENT" && -f "$backup/ABSENT_PLIST" ]] || return 1
}

bootout_if_loaded() {
  launchctl bootout "gui/$(id -u)/$LAUNCH_LABEL" >/dev/null 2>&1 || true
}

bootstrap_service() {
  local attempt output=""
  for attempt in {1..10}; do
    if output="$(launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>&1)"; then
      return 0
    fi
    [[ "$attempt" -lt 10 ]] && sleep 1
  done
  [[ -n "$output" ]] && print -r -- "$output" >&2
  return 1
}

wait_for_target_health() {
  local attempt
  for attempt in {1..20}; do
    runtime_target_is_operational && return 0
    sleep 1
  done
  return 1
}

wait_for_own_health() {
  local attempt
  for attempt in {1..20}; do
    runtime_own_is_operational && return 0
    sleep 1
  done
  return 1
}

restore_snapshot_and_verify() {
  local backup="$1"
  bootout_if_loaded
  [[ ! -e "$CURRENT_DIR" && ! -e "$PLIST" ]] || return 1
  restore_snapshot "$backup" || return 1
  if [[ -d "$CURRENT_DIR" && -f "$PLIST" ]]; then
    [[ -f "$CURRENT_DIR/worker/src/server.mjs" ]] || return 1
    bootstrap_service || return 1
    launchctl kickstart "gui/$(id -u)/$LAUNCH_LABEL" >/dev/null 2>&1 || return 1
    wait_for_own_health
    return
  fi
  [[ ! -e "$CURRENT_DIR" && ! -e "$PLIST" ]] || return 1
  ! service_loaded && ! port_has_listener
}

doctor_action() {
  validate_state_dir
  ensure_node
  local repo
  repo="$(detect_repo)"
  validate_api_origin
  check_keychain_credentials
  check_ollama_fallback
  "$NODE_BIN" --check "$repo/webapp/company-os-worker/src/server.mjs"
  /bin/zsh -n "$repo/company-os/runtime/manage.sh"
  if runtime_target_is_operational; then
    say "OK health=company-os-runtime target=1.1.0 port=$RUNTIME_HEALTH_PORT owner=launchd"
  elif runtime_target_is_identified; then
    die "Runtime objetivo 1.1 identificado y propio en puerto $RUNTIME_HEALTH_PORT pero no está operativo"
  elif runtime_own_is_identified; then
    say "OK health=company-os-runtime target=previous port=$RUNTIME_HEALTH_PORT owner=launchd cutover_allowed=true"
  elif port_has_listener; then
    if health_is_own_runtime; then
      die "Puerto $RUNTIME_HEALTH_PORT responde como runtime pero su listener no coincide con el PID de $LAUNCH_LABEL o no está operativo"
    fi
    die "Puerto $RUNTIME_HEALTH_PORT ocupado por otro proceso"
  elif service_loaded; then
    die "Servicio $LAUNCH_LABEL cargado sin listener propio y operativo en puerto $RUNTIME_HEALTH_PORT"
  else
    say "OK port=$RUNTIME_HEALTH_PORT disponible; runtime no iniciado por doctor"
  fi
  say "OK repo=$repo"
  say "OK keychain services presentes: $RUNTIME_HMAC_KEYCHAIN_SERVICE, $RUNTIME_OPENAI_KEYCHAIN_SERVICE"
  [[ "$RUNTIME_OLLAMA_FALLBACK_ENABLED" == true ]] \
    && say "OK ollama=fallback-local model=$RUNTIME_OLLAMA_MODEL" \
    || say "OK ollama=fallback-disabled"
  say "DOCTOR_OK"
}

status_action() {
  validate_state_dir
  ensure_node
  local loaded=false own_operational=false target_operational=false listener_owned=false lineage_verified=false body=""
  service_loaded && loaded=true
  body="$(health_body || true)"
  runtime_listener_is_owned && listener_owned=true
  runtime_own_is_operational && own_operational=true
  runtime_target_is_operational && target_operational=true
  verify_install_manifest "$CURRENT_DIR" && lineage_verified=true
  say "label=$LAUNCH_LABEL"
  say "loaded=$loaded"
  say "listenerOwned=$listener_owned"
  say "ownOperational=$own_operational"
  say "targetOperational=$target_operational"
  say "lineageVerified=$lineage_verified"
  say "installed=$([[ -f "$CURRENT_DIR/worker/src/server.mjs" ]] && print true || print false)"
  say "health=${body:-UNAVAILABLE}"
  [[ "$loaded" == true && "$target_operational" == true && "$lineage_verified" == true ]] || return 1
}

install_action() {
  validate_state_dir
  ensure_node
  validate_api_origin
  ensure_external_identity_keychain
  check_keychain_credentials
  check_ollama_fallback
  ensure_dirs
  load_chatgpt_project_ids_configuration
  local repo stage backup source_commit source_changes
  repo="$(detect_repo)"
  source_commit="$(git -C "$repo" rev-parse HEAD 2>/dev/null || true)"
  [[ ${#source_commit} -eq 40 && "$source_commit" != *[^0-9a-f]* ]] || die "El origen del runtime no tiene un commit Git identificable"
  source_changes="$(git -C "$repo" status --porcelain --untracked-files=all 2>/dev/null || true)"
  [[ -z "$source_changes" ]] || die "El origen del runtime tiene cambios sin commit; no se puede certificar la revisión instalada"
  ensure_google_keychain "$repo"
  stage="$(mktemp -d "$RUNTIME_STATE_DIR/.install.XXXXXX")"
  trap '[[ -n "${stage:-}" && "${stage:A}" == "${RUNTIME_STATE_DIR:A}"/.install.* ]] && rm -rf -- "$stage"' EXIT INT TERM
  mkdir -p "$stage/current"
  /usr/bin/ditto "$repo/webapp/company-os-worker" "$stage/current/worker"
  cp "$repo/company-os/runtime/manage.sh" "$stage/current/manage.sh"
  chmod 700 "$stage/current/manage.sh"
  write_install_manifest "$stage/current" "$repo" "$source_commit"
  verify_install_manifest "$stage/current" || die "No se pudo verificar el manifiesto de revisión del runtime"
  "$NODE_BIN" --check "$stage/current/worker/src/server.mjs"
  /bin/zsh -n "$stage/current/manage.sh"
  (cd "$stage/current/worker" && npm test)
  render_plist "$stage/launchd.plist"
  plutil -lint "$stage/launchd.plist" >/dev/null

  backup="$(backup_snapshot pre-install)"
  bootout_if_loaded
  [[ -d "$CURRENT_DIR" ]] && mv "$CURRENT_DIR" "$backup/displaced-current"
  [[ -f "$PLIST" ]] && mv "$PLIST" "$backup/displaced-launchd.plist"
  mv "$stage/current" "$CURRENT_DIR"
  mv "$stage/launchd.plist" "$PLIST"
  chmod 700 "$CURRENT_DIR/manage.sh"
  verify_install_manifest "$CURRENT_DIR" || die "El runtime instalado no coincide con su manifiesto de revisión"

  if ! bootstrap_service; then
    [[ -d "$CURRENT_DIR" ]] && mv "$CURRENT_DIR" "$backup/failed-current"
    [[ -f "$PLIST" ]] && mv "$PLIST" "$backup/failed-launchd.plist"
    if restore_snapshot_and_verify "$backup"; then
      die "launchctl bootstrap falló; snapshot anterior restaurado y verificado desde $backup"
    fi
    die "launchctl bootstrap falló y el snapshot anterior no quedó como servicio propio operativo: $backup"
  fi
  launchctl kickstart "gui/$(id -u)/$LAUNCH_LABEL"
  if ! wait_for_target_health; then
    bootout_if_loaded
    [[ -d "$CURRENT_DIR" ]] && mv "$CURRENT_DIR" "$backup/failed-health-current"
    [[ -f "$PLIST" ]] && mv "$PLIST" "$backup/failed-health-launchd.plist"
    if restore_snapshot_and_verify "$backup"; then
      die "launchd cargó pero no confirmó runtime objetivo 1.1 operativo; snapshot anterior restaurado y verificado desde $backup"
    fi
    die "launchd cargó pero no confirmó runtime objetivo 1.1 y el snapshot anterior no quedó como servicio propio operativo: $backup"
  fi
  say "INSTALL_OK repo=$repo backup=$backup label=$LAUNCH_LABEL"
}

restart_action() {
  validate_state_dir
  service_loaded || die "Servicio no cargado: $LAUNCH_LABEL"
  [[ -f "$PLIST" ]] || die "Falta plist instalado: $PLIST"
  launchctl kickstart -k "gui/$(id -u)/$LAUNCH_LABEL"
  wait_for_target_health || die "Restart ejecutado pero no confirmó runtime objetivo 1.1, listener propio y heartbeat operativo en puerto $RUNTIME_HEALTH_PORT"
  say "RESTART_OK"
}

uninstall_action() {
  validate_state_dir
  ensure_dirs
  if [[ ! -e "$CURRENT_DIR" && ! -e "$PLIST" ]] && ! service_loaded; then
    say "UNINSTALL_OK already_uninstalled=true"
    return
  fi
  local backup
  backup="$(backup_snapshot pre-uninstall)"
  bootout_if_loaded
  [[ -d "$CURRENT_DIR" ]] && mv "$CURRENT_DIR" "$backup/displaced-current"
  [[ -f "$PLIST" ]] && mv "$PLIST" "$backup/displaced-launchd.plist"
  say "UNINSTALL_OK recoverable=true backup=$backup"
}

rollback_action() {
  validate_state_dir
  ensure_dirs
  [[ -f "$RUNTIME_STATE_DIR/last-backup" ]] || die "No existe referencia last-backup"
  local target safety
  target="$(<"$RUNTIME_STATE_DIR/last-backup")"
  case "${target:A}" in
    "${BACKUPS_DIR:A}"/*) ;;
    *) die "Referencia de rollback fuera de backups: $target" ;;
  esac
  [[ -d "$target" ]] || die "Backup de rollback no existe: $target"
  safety="$(backup_snapshot pre-rollback)"
  bootout_if_loaded
  [[ -d "$CURRENT_DIR" ]] && mv "$CURRENT_DIR" "$safety/displaced-current"
  [[ -f "$PLIST" ]] && mv "$PLIST" "$safety/displaced-launchd.plist"
  if ! restore_snapshot "$target"; then
    if restore_snapshot_and_verify "$safety"; then
      die "Snapshot de rollback inconsistente; estado previo restaurado y verificado desde $safety"
    fi
    die "Snapshot de rollback inconsistente y el estado previo no quedó como servicio propio operativo: $safety"
  fi
  if [[ -f "$PLIST" && -f "$CURRENT_DIR/worker/src/server.mjs" ]]; then
    if ! bootstrap_service; then
      [[ -d "$CURRENT_DIR" ]] && mv "$CURRENT_DIR" "$safety/failed-rollback-current"
      [[ -f "$PLIST" ]] && mv "$PLIST" "$safety/failed-rollback-launchd.plist"
      if restore_snapshot_and_verify "$safety"; then
        die "Rollback no pudo cargar launchd; estado previo restaurado y verificado desde $safety"
      fi
      die "Rollback no pudo cargar launchd y el estado previo no quedó como servicio propio operativo: $safety"
    fi
    launchctl kickstart "gui/$(id -u)/$LAUNCH_LABEL"
    if ! wait_for_own_health; then
      bootout_if_loaded
      [[ -d "$CURRENT_DIR" ]] && mv "$CURRENT_DIR" "$safety/failed-rollback-health-current"
      [[ -f "$PLIST" ]] && mv "$PLIST" "$safety/failed-rollback-health-launchd.plist"
      if restore_snapshot_and_verify "$safety"; then
        die "Rollback sin health propio operativo; estado previo restaurado y verificado desde $safety"
      fi
      die "Rollback sin health propio operativo y el estado previo tampoco pudo verificarse: $safety"
    fi
    say "ROLLBACK_OK restored=$target safety=$safety"
  else
    say "ROLLBACK_OK restored=uninstalled safety=$safety"
  fi
}

run_action() {
  validate_state_dir
  ensure_node
  [[ -f "$CURRENT_DIR/worker/src/server.mjs" ]] || die "Runtime instalado incompleto: $CURRENT_DIR/worker/src/server.mjs"
  [[ "${EXTERNAL_NOTIFICATIONS_ENABLED:l}" == "false" ]] \
    || die "Las notificaciones externas deben permanecer deshabilitadas en la instalación Mac genérica"
  local runtime_hmac_secret openai_api_key external_identity_secret source_revision
  local google_service_account_json
  runtime_hmac_secret="$(keychain_get "$RUNTIME_HMAC_KEYCHAIN_SERVICE")"
  openai_api_key="$(keychain_get "$RUNTIME_OPENAI_KEYCHAIN_SERVICE")"
  google_service_account_json="$(keychain_get "$RUNTIME_GOOGLE_KEYCHAIN_SERVICE")"
  external_identity_secret="$(keychain_get "$RUNTIME_EXTERNAL_IDENTITY_KEYCHAIN_SERVICE")"
  verify_install_manifest "$CURRENT_DIR" || die "La revisión instalada del runtime no coincide con su manifiesto"
  source_revision="$("$NODE_BIN" -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).sourceCommit' "$CURRENT_DIR/install-manifest.json")"
  export COMPANY_OS_RUNTIME_HMAC_SECRET="$runtime_hmac_secret"
  export OPENAI_API_KEY="$openai_api_key"
  export COMPANY_OS_RUNTIME_GOOGLE_SERVICE_ACCOUNT_JSON="$google_service_account_json"
  export COMPANY_OS_EXTERNAL_IDENTITY_HMAC_SECRET="$external_identity_secret"
  export COMPANY_OS_RUNTIME_SOURCE_REVISION="$source_revision"
  exec "$NODE_BIN" "$CURRENT_DIR/worker/src/server.mjs" daemon
}

case "$ACTION" in
  install) install_action ;;
  status) status_action ;;
  doctor) doctor_action ;;
  restart) restart_action ;;
  uninstall) uninstall_action ;;
  rollback) rollback_action ;;
  __run) run_action ;;
  *) die "Uso: $0 install|status|doctor|restart|uninstall|rollback" ;;
esac
