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
RUN_LOCK="$STATE_DIR/run.lock.v2"
INSTALL_LOCK="$STATE_DIR/install.lock.v2"
LEGACY_RUN_LOCK="$STATE_DIR/run.lock"
INSTALL_TRANSACTION="$STATE_DIR/install-transaction.json"
UNINSTALL_TRANSACTION="$STATE_DIR/uninstall-transaction.json"
RUN_LOCK_HELD=0
INSTALL_LOCK_HELD=0
LEGACY_SENTINEL_TARGET=""
LEGACY_SENTINEL_TOKEN=""
COLLECTOR_PID=""
COLLECTOR_START_GATE=""
COLLECTOR_START_TOKEN=""
INSTALL_TRANSACTION_ACTIVE=0
UNINSTALL_TRANSACTION_ACTIVE=0

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
transaction_marker_present() { [[ -e "$INSTALL_TRANSACTION" || -L "$INSTALL_TRANSACTION" ]]; }
marker_safe() {
  local marker_path="$1"
  [[ -f "$marker_path" && ! -L "$marker_path" ]] || return 1
  [[ "$(/usr/bin/stat -f %u "$marker_path" 2>/dev/null || true)" == "$(id -u)" ]] || return 1
  [[ "$(/usr/bin/stat -f %Lp "$marker_path" 2>/dev/null || true)" == "600" ]] || return 1
}
transaction_marker_safe() { marker_safe "$INSTALL_TRANSACTION"; }
uninstall_marker_present() { [[ -e "$UNINSTALL_TRANSACTION" || -L "$UNINSTALL_TRANSACTION" ]]; }
uninstall_marker_safe() { marker_safe "$UNINSTALL_TRANSACTION"; }
installed_manager_supports_uninstall_gate() {
  [[ -f "$CURRENT/manage.sh" && ! -L "$CURRENT/manage.sh" ]] || return 1
  /usr/bin/grep -Fq 'UNINSTALL_TRANSACTION_BLOCKS_RUNTIME' "$CURRENT/manage.sh"
}
file_sha256() { /usr/bin/shasum -a 256 "$1" | /usr/bin/cut -d ' ' -f 1; }
valid_sha256() { print -r -- "$1" | /usr/bin/grep -Eq '^[0-9a-f]{64}$'; }
legacy_installed_collector_pids() {
  local installed_node="$NODE_BIN"
  if [[ -f "$PLIST" && ! -L "$PLIST" ]]; then
    installed_node="$(/usr/bin/plutil -extract EnvironmentVariables.COMPANY_OS_CODEX_NODE_BIN raw -o - "$PLIST" 2>/dev/null || print -r -- "$NODE_BIN")"
  fi
  "$NODE_BIN" -e '
    const { execFileSync } = require("node:child_process");
    const { existsSync, realpathSync } = require("node:fs");
    const nodes = new Set(process.argv.slice(1, 3));
    for (const candidate of [...nodes]) {
      try { if (existsSync(candidate)) nodes.add(realpathSync(candidate)); } catch { /* retain exact invocation */ }
    }
    const collector = process.argv[3];
    const expected = new Set([...nodes].map((node) => `${node} ${collector}`));
    const lines = execFileSync("/bin/ps", ["-ww", "-axo", "pid=,command="], { encoding: "utf8" }).split("\n");
    const pids = [];
    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      if (match && expected.has(match[2])) pids.push(match[1]);
    }
    process.stdout.write(pids.join(","));
  ' "$NODE_BIN" "$installed_node" "$CURRENT/collector.mjs"
}
check_legacy_lock() {
  local lock_pid=""
  local lock_start=""
  local lock_command=""
  local current_start=""
  local current_command=""
  local lock_mtime=0
  local lock_age=-1
  local stale_path=""
  local bridge_target=""
  local bridge_dir=""
  [[ ! -e "$LEGACY_RUN_LOCK" && ! -L "$LEGACY_RUN_LOCK" ]] && return 0
  if [[ -L "$LEGACY_RUN_LOCK" ]]; then
    bridge_target="$(readlink "$LEGACY_RUN_LOCK" 2>/dev/null || true)"
    if [[ "$bridge_target" != run.lock.bridge.* || "$bridge_target" == */* ]]; then
      echo "LEGACY_LOCK_UNSUPPORTED: requiere inspección manual" >&2
      return 1
    fi
    bridge_dir="$STATE_DIR/$bridge_target"
    [[ -d "$bridge_dir" ]] || { echo "LEGACY_BRIDGE_TARGET_MISSING" >&2; return 1; }
  elif [[ ! -d "$LEGACY_RUN_LOCK" ]]; then
    echo "LEGACY_LOCK_UNSUPPORTED: requiere inspección manual" >&2
    return 1
  fi
  [[ -f "$LEGACY_RUN_LOCK/pid" ]] && lock_pid="$(<"$LEGACY_RUN_LOCK/pid")"
  [[ -f "$LEGACY_RUN_LOCK/start" ]] && lock_start="$(<"$LEGACY_RUN_LOCK/start")"
  [[ -f "$LEGACY_RUN_LOCK/command" ]] && lock_command="$(<"$LEGACY_RUN_LOCK/command")"
  if [[ "$lock_pid" == <-> ]]; then
    current_start="$(/bin/ps -p "$lock_pid" -o lstart= 2>/dev/null || true)"
    current_command="$(/bin/ps -ww -p "$lock_pid" -o command= 2>/dev/null || true)"
  fi
  if [[ -n "$current_start" && "$current_start" == "$lock_start" && "$current_command" == "$lock_command" ]]; then
    echo "LEGACY_COLLECTOR_RUNNING pid=$lock_pid" >&2
    return 1
  fi
  if [[ -n "$current_start" && ( -z "$lock_start" || -z "$lock_command" ) ]]; then
    echo "LEGACY_LOCK_IDENTITY_UNVERIFIED pid=$lock_pid" >&2
    return 1
  fi
  local orphaned_collector_pids="$(legacy_installed_collector_pids 2>/dev/null || print -r -- UNVERIFIED)"
  if [[ "$orphaned_collector_pids" == "UNVERIFIED" ]]; then
    echo "LEGACY_COLLECTOR_PROCESS_SCAN_FAILED" >&2
    return 1
  fi
  if [[ -n "$orphaned_collector_pids" ]]; then
    echo "LEGACY_COLLECTOR_ORPHANED pids=$orphaned_collector_pids" >&2
    return 1
  fi
  if [[ -n "$bridge_dir" ]]; then lock_mtime="$(/usr/bin/stat -f %m "$bridge_dir" 2>/dev/null || echo 0)"
  else lock_mtime="$(/usr/bin/stat -f %m "$LEGACY_RUN_LOCK" 2>/dev/null || echo 0)"; fi
  if [[ "$lock_mtime" == <-> && "$lock_mtime" -gt 0 ]]; then
    lock_age=$(( $(/bin/date +%s) - lock_mtime ))
  fi
  if [[ "$lock_age" -lt 0 ]]; then
    echo "LEGACY_LOCK_STATE_UNREADABLE" >&2
    return 1
  fi
  if [[ "$lock_age" -lt 30 ]]; then
    echo "LEGACY_LOCK_INITIALIZING" >&2
    return 1
  fi
  if [[ -n "$bridge_target" ]]; then
    if ! "$NODE_BIN" -e '
      const fs = require("node:fs");
      if (fs.readlinkSync(process.argv[1]) !== process.argv[2]) process.exit(2);
      fs.unlinkSync(process.argv[1]);
    ' "$LEGACY_RUN_LOCK" "$bridge_target" 2>/dev/null; then
      echo "LEGACY_BRIDGE_RACE_RETRY_LATER" >&2
      return 1
    fi
    rm -f "$bridge_dir/pid" "$bridge_dir/start" "$bridge_dir/command" "$bridge_dir/token" 2>/dev/null || true
    rmdir "$bridge_dir" 2>/dev/null || true
    return 0
  fi
  if [[ "$ACTION" != "install" && "$ACTION" != "uninstall" ]]; then
    echo "LEGACY_LOCK_REQUIRES_INSTALL" >&2
    return 1
  fi
  stale_path="$STATE_DIR/run.lock.legacy.$(/bin/date +%Y%m%d%H%M%S).$$"
  if ! mv "$LEGACY_RUN_LOCK" "$stale_path" 2>/dev/null; then
    echo "LEGACY_LOCK_RACE_RETRY_LATER" >&2
    return 1
  fi
  echo "LEGACY_LOCK_MIGRATED backup=$stale_path"
  return 0
}
cleanup_legacy_sentinel_target() {
  local target_dir="$1"
  [[ "$target_dir" == "$STATE_DIR"/run.lock.bridge.* ]] || return 1
  rm -f "$target_dir/pid" "$target_dir/start" "$target_dir/command" "$target_dir/token" 2>/dev/null || true
  rmdir "$target_dir" 2>/dev/null || true
}
legacy_sentinel_metadata_safe() {
  local target_dir="$1"
  local expected_pid="$2"
  local expected_start="$3"
  local expected_command="$4"
  local expected_token="$5"
  [[ -d "$target_dir" && ! -L "$target_dir" ]] || return 1
  [[ "$(/usr/bin/stat -f %u "$target_dir" 2>/dev/null || true)" == "$(id -u)" ]] || return 1
  [[ "$(/usr/bin/stat -f %Lp "$target_dir" 2>/dev/null || true)" == "700" ]] || return 1
  for metadata_file in pid start command token; do marker_safe "$target_dir/$metadata_file" || return 1; done
  [[ "$(<"$target_dir/pid")" == "$expected_pid" ]] || return 1
  [[ "$(<"$target_dir/start")" == "$expected_start" ]] || return 1
  [[ "$(<"$target_dir/command")" == "$expected_command" ]] || return 1
  [[ "$(<"$target_dir/token")" == "$expected_token" ]] || return 1
}
acquire_legacy_sentinel() {
  local attempt=0
  local target_name=""
  local target_dir=""
  local lock_start=""
  local lock_command=""
  while [[ "$attempt" -lt 3 ]]; do
    LEGACY_SENTINEL_TOKEN="$(/usr/bin/uuidgen)"
    target_name="run.lock.bridge.$LEGACY_SENTINEL_TOKEN"
    target_dir="$STATE_DIR/$target_name"
    if ! mkdir "$target_dir" 2>/dev/null; then return 2; fi
    lock_start="$(/bin/ps -p "$$" -o lstart=)"
    lock_command="$(/bin/ps -ww -p "$$" -o command=)"
    if [[ -z "$lock_start" || -z "$lock_command" ]]; then cleanup_legacy_sentinel_target "$target_dir"; return 2; fi
    if ! print -r -- "$$" > "$target_dir/pid" \
      || ! print -r -- "$lock_start" > "$target_dir/start" \
      || ! print -r -- "$lock_command" > "$target_dir/command" \
      || ! print -r -- "$LEGACY_SENTINEL_TOKEN" > "$target_dir/token" \
      || ! chmod 600 "$target_dir/pid" "$target_dir/start" "$target_dir/command" "$target_dir/token" \
      || ! legacy_sentinel_metadata_safe "$target_dir" "$$" "$lock_start" "$lock_command" "$LEGACY_SENTINEL_TOKEN"; then
      cleanup_legacy_sentinel_target "$target_dir"
      return 2
    fi
    if "$NODE_BIN" -e 'require("node:fs").symlinkSync(process.argv[1], process.argv[2], "dir")' "$target_name" "$LEGACY_RUN_LOCK" 2>/dev/null; then
      LEGACY_SENTINEL_TARGET="$target_name"
      return 0
    fi
    cleanup_legacy_sentinel_target "$target_dir"
    if ! check_legacy_lock; then return 1; fi
    attempt=$((attempt + 1))
    /bin/sleep 0.05
  done
  echo "LEGACY_BRIDGE_RACE_RETRY_LATER" >&2
  return 1
}
rotate_legacy_sentinel_owner() {
  local owner_pid="$1"
  local owner_start=""
  local owner_command=""
  local old_target="$LEGACY_SENTINEL_TARGET"
  local old_dir=""
  local new_token=""
  local new_target=""
  local new_dir=""
  local temporary_link=""
  [[ "$owner_pid" == <-> && -n "$old_target" && -n "$LEGACY_SENTINEL_TOKEN" ]] || return 1
  [[ "$(readlink "$LEGACY_RUN_LOCK" 2>/dev/null || true)" == "$old_target" ]] || return 1
  owner_start="$(/bin/ps -p "$owner_pid" -o lstart= 2>/dev/null || true)"
  owner_command="$(/bin/ps -ww -p "$owner_pid" -o command= 2>/dev/null || true)"
  [[ -n "$owner_start" && -n "$owner_command" ]] || return 1
  new_token="$(/usr/bin/uuidgen)"
  new_target="run.lock.bridge.$new_token"
  new_dir="$STATE_DIR/$new_target"
  temporary_link="$STATE_DIR/run.lock.swap.$new_token"
  if ! mkdir "$new_dir" 2>/dev/null; then return 1; fi
  if ! print -r -- "$owner_pid" > "$new_dir/pid" \
    || ! print -r -- "$owner_start" > "$new_dir/start" \
    || ! print -r -- "$owner_command" > "$new_dir/command" \
    || ! print -r -- "$new_token" > "$new_dir/token" \
    || ! chmod 600 "$new_dir/pid" "$new_dir/start" "$new_dir/command" "$new_dir/token" \
    || ! legacy_sentinel_metadata_safe "$new_dir" "$owner_pid" "$owner_start" "$owner_command" "$new_token"; then
    cleanup_legacy_sentinel_target "$new_dir"
    return 1
  fi
  if ! "$NODE_BIN" -e '
    const fs = require("node:fs");
    const lock = process.argv[1];
    const expected = process.argv[2];
    const replacement = process.argv[3];
    const temporary = process.argv[4];
    try {
      fs.symlinkSync(replacement, temporary, "dir");
      if (fs.readlinkSync(lock) !== expected) throw new Error("bridge-owner-changed");
      fs.renameSync(temporary, lock);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch { /* no temporary link */ }
      throw error;
    }
  ' "$LEGACY_RUN_LOCK" "$old_target" "$new_target" "$temporary_link" 2>/dev/null; then
    cleanup_legacy_sentinel_target "$new_dir"
    return 1
  fi
  old_dir="$STATE_DIR/$old_target"
  LEGACY_SENTINEL_TARGET="$new_target"
  LEGACY_SENTINEL_TOKEN="$new_token"
  cleanup_legacy_sentinel_target "$old_dir" || true
}
release_legacy_sentinel() {
  local current_target=""
  local target_dir=""
  local owner_token=""
  [[ -n "$LEGACY_SENTINEL_TARGET" ]] || return 0
  current_target="$(readlink "$LEGACY_RUN_LOCK" 2>/dev/null || true)"
  target_dir="$STATE_DIR/$LEGACY_SENTINEL_TARGET"
  [[ -f "$target_dir/token" ]] && owner_token="$(<"$target_dir/token")"
  if [[ "$current_target" == "$LEGACY_SENTINEL_TARGET" && "$owner_token" == "$LEGACY_SENTINEL_TOKEN" ]]; then
    "$NODE_BIN" -e '
      const fs = require("node:fs");
      if (fs.readlinkSync(process.argv[1]) !== process.argv[2]) process.exit(2);
      fs.unlinkSync(process.argv[1]);
    ' "$LEGACY_RUN_LOCK" "$LEGACY_SENTINEL_TARGET" 2>/dev/null || return 1
    cleanup_legacy_sentinel_target "$target_dir"
  fi
  LEGACY_SENTINEL_TARGET=""
  LEGACY_SENTINEL_TOKEN=""
}
acquire_lock() {
  local wait_seconds="${1:-0}"
  if [[ -L "$RUN_LOCK" || ( -e "$RUN_LOCK" && ! -f "$RUN_LOCK" ) ]]; then
    echo "KERNEL_LOCK_PATH_INVALID" >&2
    return 2
  fi
  if ! exec 9>>"$RUN_LOCK"; then return 2; fi
  chmod 600 "$RUN_LOCK" 2>/dev/null || { exec 9>&-; return 2; }
  if ! /usr/bin/lockf -s -t "$wait_seconds" 9; then
    exec 9>&-
    echo "ALREADY_RUNNING"
    return 1
  fi
  RUN_LOCK_HELD=1
  if ! check_legacy_lock; then
    release_lock
    return 1
  fi
  if ! acquire_legacy_sentinel; then
    release_lock
    return 1
  fi
  return 0
}
release_lock() {
  [[ "$RUN_LOCK_HELD" == 1 ]] || return 0
  release_legacy_sentinel || true
  exec 9>&-
  RUN_LOCK_HELD=0
}
acquire_install_lock() {
  if [[ -L "$INSTALL_LOCK" || ( -e "$INSTALL_LOCK" && ! -f "$INSTALL_LOCK" ) ]]; then
    echo "INSTALL_LOCK_PATH_INVALID" >&2
    return 2
  fi
  if ! exec 8>>"$INSTALL_LOCK"; then return 2; fi
  chmod 600 "$INSTALL_LOCK" 2>/dev/null || { exec 8>&-; return 2; }
  if ! /usr/bin/lockf -s -t 0 8; then
    exec 8>&-
    echo "INSTALL_ALREADY_RUNNING"
    return 1
  fi
  INSTALL_LOCK_HELD=1
}
release_install_lock() {
  [[ "$INSTALL_LOCK_HELD" == 1 ]] || return 0
  exec 8>&-
  INSTALL_LOCK_HELD=0
}
bootout_and_wait() {
  local attempt=0
  launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  while [[ "$attempt" -lt 40 ]]; do
    if ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then return 0; fi
    /bin/sleep 0.25
    attempt=$((attempt + 1))
  done
  echo "SERVICE_QUIESCENCE_UNVERIFIED label=$LABEL" >&2
  return 1
}
prepare_collector_start_gate() {
  COLLECTOR_START_TOKEN="$(/usr/bin/uuidgen)"
  COLLECTOR_START_GATE="$STATE_DIR/start-gate.$COLLECTOR_START_TOKEN"
  [[ ! -e "$COLLECTOR_START_GATE" && ! -L "$COLLECTOR_START_GATE" ]] || return 1
}
signal_collector_start() {
  [[ -n "$COLLECTOR_START_GATE" && -n "$COLLECTOR_START_TOKEN" ]] || return 1
  if ! "$NODE_BIN" -e '
    const fs = require("node:fs");
    const paths = require("node:path");
    const gate = process.argv[1];
    const token = process.argv[2];
    const temporary = `${gate}.${process.pid}.tmp`;
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(descriptor, `${token}\n`); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, gate);
    const directory = fs.openSync(paths.dirname(gate), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  ' "$COLLECTOR_START_GATE" "$COLLECTOR_START_TOKEN"; then return 1; fi
}
clear_collector_start_gate() {
  if [[ -n "$COLLECTOR_START_GATE" && ( -e "$COLLECTOR_START_GATE" || -L "$COLLECTOR_START_GATE" ) ]]; then
    "$NODE_BIN" -e '
      const fs = require("node:fs");
      const path = process.argv[1];
      const info = fs.lstatSync(path);
      if (!info.isFile() || info.isSymbolicLink()) process.exit(2);
      fs.unlinkSync(path);
    ' "$COLLECTOR_START_GATE" 2>/dev/null || true
  fi
  COLLECTOR_START_GATE=""
  COLLECTOR_START_TOKEN=""
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
  clear_collector_start_gate
  exit "$exit_code"
}
wait_for_collector() {
  local collector_status=0
  wait "$COLLECTOR_PID" || collector_status=$?
  COLLECTOR_PID=""
  clear_collector_start_gate
  return "$collector_status"
}
wait_for_install_readback() {
  local start_line="${1:-0}"
  local expected_install_id="${2:-$INSTALL_ID}"
  local readback_mode="${3:-v2}"
  local attempt=0
  [[ "$start_line" == <-> ]] || start_line=0
  [[ "$readback_mode" == "v2" || "$readback_mode" == "legacy" ]] || return 1
  while [[ "$attempt" -lt 45 ]]; do
    if [[ -f "$LOGS/stdout.log" ]]; then
      if "$NODE_BIN" -e '
        const fs = require("node:fs");
        const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").slice(Number(process.argv[3]));
        let scan = false;
        let dispatch = false;
        for (const line of lines) {
          if (!line) continue;
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          if (event.installId !== process.argv[2] || event.ok !== true) continue;
          if (event.event === "COLLECTOR_SCAN_OK" && typeof event.scanId === "string" && event.scanId.startsWith("auto-")) scan = true;
          if (event.event === "DISPATCH_POLL_OK") dispatch = true;
        }
        const summary = lines.some((line) => {
          if (!line) return false;
          try {
            const event = JSON.parse(line);
            return event.installId === process.argv[2] && event.ok === true
              && typeof event.scanId === "string" && event.scanId.startsWith("auto-")
              && event.dispatch && typeof event.dispatch === "object";
          } catch { return false; }
        });
        process.exit(process.argv[4] === "v2" ? ((scan && dispatch) || summary ? 0 : 1) : (summary ? 0 : 1));
      ' "$LOGS/stdout.log" "$expected_install_id" "$start_line" "$readback_mode"; then return 0; fi
    fi
    /bin/sleep 1
    attempt=$((attempt + 1))
  done
  return 1
}
write_install_transaction() {
  local backup_dir="$1"
  local had_collector="$2"
  local had_manager="$3"
  local had_plist="$4"
  local was_loaded="$5"
  local old_install_id="$6"
  local old_readback_mode="$7"
  local owner_start="$(/bin/ps -p "$$" -o lstart= 2>/dev/null || true)"
  local owner_command="$(/bin/ps -ww -p "$$" -o command= 2>/dev/null || true)"
  if transaction_marker_present; then echo "INSTALL_TRANSACTION_ALREADY_EXISTS" >&2; return 1; fi
  if uninstall_marker_present; then echo "UNINSTALL_RECOVERY_REQUIRED" >&2; return 1; fi
  [[ -n "$owner_start" && -n "$owner_command" ]] || { echo "INSTALL_TRANSACTION_OWNER_UNVERIFIED" >&2; return 1; }
  if ! "$NODE_BIN" -e '
    const fs = require("node:fs");
    const crypto = require("node:crypto");
    const paths = require("node:path");
    const path = process.argv[1];
    const temporary = `${path}.${process.pid}.tmp`;
    const backupDir = process.argv[2];
    const hadCollector = process.argv[3] === "1";
    const hadManager = process.argv[4] === "1";
    const hadPlist = process.argv[5] === "1";
    const syncAndHash = (file) => {
      const descriptor = fs.openSync(file, "r");
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    };
    const collectorSha256 = hadCollector ? syncAndHash(paths.join(backupDir, "collector.mjs")) : null;
    const managerSha256 = hadManager ? syncAndHash(paths.join(backupDir, "manage.sh")) : null;
    const plistSha256 = hadPlist ? syncAndHash(paths.join(backupDir, `${process.argv[9]}.plist`)) : null;
    const backupDirectory = fs.openSync(backupDir, "r");
    try { fs.fsyncSync(backupDirectory); } finally { fs.closeSync(backupDirectory); }
    const state = {
      version: 1, phase: "PREPARED", backupDir,
      hadCollector, hadManager, hadPlist, wasLoaded: process.argv[6] === "1",
      oldInstallId: process.argv[7] || null, oldReadbackMode: process.argv[8],
      newInstallId: process.argv[10], allowedRunInstallId: null,
      ownerPid: Number(process.argv[11]), ownerStart: process.argv[12], ownerCommand: process.argv[13],
      collectorSha256, managerSha256, plistSha256,
      createdAt: new Date().toISOString(),
    };
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(descriptor, `${JSON.stringify(state)}\n`); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, path);
    const directory = fs.openSync(paths.dirname(path), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  ' "$INSTALL_TRANSACTION" "$backup_dir" "$had_collector" "$had_manager" "$had_plist" "$was_loaded" "$old_install_id" "$old_readback_mode" "$LABEL" "$INSTALL_ID" "$$" "$owner_start" "$owner_command"; then return 1; fi
  transaction_marker_safe || { echo "INSTALL_TRANSACTION_NOT_DURABLE" >&2; return 1; }
  INSTALL_TRANSACTION_ACTIVE=1
}
transaction_field() {
  transaction_marker_safe || return 1
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const value = state[process.argv[2]];
    process.stdout.write(typeof value === "boolean" ? (value ? "1" : "0") : value == null ? "" : String(value));
  ' "$INSTALL_TRANSACTION" "$1"
}
clear_install_transaction() {
  transaction_marker_present || { INSTALL_TRANSACTION_ACTIVE=0; return 0; }
  transaction_marker_safe || return 1
  if ! "$NODE_BIN" -e '
    const fs = require("node:fs");
    const path = process.argv[1];
    const contents = fs.readFileSync(path);
    fs.unlinkSync(path);
    const directory = fs.openSync(require("node:path").dirname(path), "r");
    try {
      fs.fsyncSync(directory);
    } catch (error) {
      const temporary = `${path}.${process.pid}.restore`;
      const descriptor = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(descriptor, contents); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, path);
      try { fs.fsyncSync(directory); } catch { /* preserve the marker and fail closed below */ }
      throw error;
    } finally { fs.closeSync(directory); }
  ' "$INSTALL_TRANSACTION"; then return 1; fi
  transaction_marker_present && return 1
  INSTALL_TRANSACTION_ACTIVE=0
}
uninstall_field() {
  uninstall_marker_safe || return 1
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const value = state[process.argv[2]];
    process.stdout.write(typeof value === "boolean" ? (value ? "1" : "0") : value == null ? "" : String(value));
  ' "$UNINSTALL_TRANSACTION" "$1"
}
write_uninstall_transaction() {
  local disabled_path="$1"
  local had_plist="$2"
  local was_loaded="$3"
  uninstall_marker_present && { echo "UNINSTALL_TRANSACTION_ALREADY_EXISTS" >&2; return 1; }
  transaction_marker_present && { echo "INSTALL_RECOVERY_REQUIRED" >&2; return 1; }
  if ! "$NODE_BIN" -e '
    const fs = require("node:fs");
    const crypto = require("node:crypto");
    const paths = require("node:path");
    const marker = process.argv[1];
    const plist = process.argv[2];
    const hadPlist = process.argv[4] === "1";
    let plistSha256 = null;
    if (hadPlist) {
      const descriptor = fs.openSync(plist, "r");
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      plistSha256 = crypto.createHash("sha256").update(fs.readFileSync(plist)).digest("hex");
      const plistDirectory = fs.openSync(paths.dirname(plist), "r");
      try { fs.fsyncSync(plistDirectory); } finally { fs.closeSync(plistDirectory); }
    }
    const state = {
      version: 1, phase: "PREPARED", disabledPath: process.argv[3], hadPlist,
      wasLoaded: process.argv[5] === "1", plistSha256, createdAt: new Date().toISOString(),
    };
    const temporary = `${marker}.${process.pid}.tmp`;
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(descriptor, `${JSON.stringify(state)}\n`); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, marker);
    const directory = fs.openSync(paths.dirname(marker), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  ' "$UNINSTALL_TRANSACTION" "$PLIST" "$disabled_path" "$had_plist" "$was_loaded"; then return 1; fi
  uninstall_marker_safe || { echo "UNINSTALL_TRANSACTION_NOT_DURABLE" >&2; return 1; }
  UNINSTALL_TRANSACTION_ACTIVE=1
}
clear_uninstall_transaction() {
  uninstall_marker_present || { UNINSTALL_TRANSACTION_ACTIVE=0; return 0; }
  uninstall_marker_safe || return 1
  if ! "$NODE_BIN" -e '
    const fs = require("node:fs");
    const paths = require("node:path");
    const marker = process.argv[1];
    const contents = fs.readFileSync(marker);
    fs.unlinkSync(marker);
    const directory = fs.openSync(paths.dirname(marker), "r");
    try {
      fs.fsyncSync(directory);
    } catch (error) {
      const temporary = `${marker}.${process.pid}.restore`;
      const descriptor = fs.openSync(temporary, "wx", 0o600);
      try { fs.writeFileSync(descriptor, contents); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      fs.renameSync(temporary, marker);
      try { fs.fsyncSync(directory); } catch { /* preserve marker and fail closed */ }
      throw error;
    } finally { fs.closeSync(directory); }
  ' "$UNINSTALL_TRANSACTION"; then return 1; fi
  uninstall_marker_present && return 1
  UNINSTALL_TRANSACTION_ACTIVE=0
}
complete_uninstall_transaction() {
  uninstall_marker_present || return 0
  uninstall_marker_safe || { echo "UNINSTALL_RECOVERY_INVALID" >&2; return 1; }
  local version="$(uninstall_field version 2>/dev/null || true)"
  local phase="$(uninstall_field phase 2>/dev/null || true)"
  local disabled_path="$(uninstall_field disabledPath 2>/dev/null || true)"
  local had_plist="$(uninstall_field hadPlist 2>/dev/null || true)"
  local was_loaded="$(uninstall_field wasLoaded 2>/dev/null || true)"
  local plist_sha256="$(uninstall_field plistSha256 2>/dev/null || true)"
  local disabled_resolved="${disabled_path:A}"
  local state_root="${STATE_DIR:A}"
  local uninstall_ok=1
  [[ "$version" == 1 && "$phase" == "PREPARED" && "$had_plist" == [01] && "$was_loaded" == [01] ]] || { echo "UNINSTALL_RECOVERY_INVALID" >&2; return 1; }
  [[ "$disabled_resolved" == "$state_root"/${LABEL}.plist.disabled.* ]] || { echo "UNINSTALL_RECOVERY_INVALID" >&2; return 1; }
  [[ ! -L "$PLIST" && ! -L "$disabled_resolved" ]] || { echo "UNINSTALL_RECOVERY_INVALID" >&2; return 1; }
  if [[ "$had_plist" == 1 ]]; then
    valid_sha256 "$plist_sha256" || { echo "UNINSTALL_RECOVERY_INVALID" >&2; return 1; }
    if [[ -f "$PLIST" && -f "$disabled_resolved" ]]; then echo "UNINSTALL_STATE_DRIFT" >&2; return 1
    elif [[ -f "$PLIST" ]]; then [[ "$(file_sha256 "$PLIST")" == "$plist_sha256" ]] || { echo "UNINSTALL_SOURCE_CHANGED" >&2; return 1; }
    elif [[ -f "$disabled_resolved" ]]; then [[ "$(file_sha256 "$disabled_resolved")" == "$plist_sha256" ]] || { echo "UNINSTALL_DISABLED_HASH_MISMATCH" >&2; return 1; }
    else echo "UNINSTALL_PLIST_MISSING" >&2; return 1; fi
  elif [[ -f "$PLIST" || -e "$disabled_resolved" || -L "$disabled_resolved" ]]; then
    echo "UNINSTALL_STATE_DRIFT" >&2
    return 1
  fi
  if ! bootout_and_wait; then return 1; fi
  if ! acquire_lock 35; then echo "UNINSTALL_RUN_LOCK_BUSY" >&2; return 1; fi
  if [[ -f "$STATE_DIR/dispatch-state.json" || -f "$STATE_DIR/dispatch-state.quarantined" ]]; then
    local restart_ok=1
    local restart_required=0
    if [[ -f "$PLIST" ]]; then
      restart_required=1
      launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || restart_ok=0
      launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || restart_ok=0
    else restart_ok=0; fi
    if [[ "$restart_ok" == 1 ]] && ! clear_uninstall_transaction; then restart_ok=0; fi
    release_lock
    if [[ "$restart_ok" == 1 && "$restart_required" == 1 ]]; then
      launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || restart_ok=0
      launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || restart_ok=0
    fi
    if [[ "$restart_ok" != 1 ]]; then echo "UNINSTALL_RECONCILIATION_RESTART_FAILED" >&2; return 1; fi
    echo "UNINSTALL_REQUIRES_DISPATCH_RECONCILIATION" >&2
    return 1
  fi
  if [[ "$had_plist" == 1 && -f "$PLIST" ]] && ! mv "$PLIST" "$disabled_resolved"; then uninstall_ok=0; fi
  if [[ "$had_plist" == 1 ]]; then
    [[ -f "$disabled_resolved" && "$(file_sha256 "$disabled_resolved")" == "$plist_sha256" ]] || uninstall_ok=0
  fi
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || [[ -f "$PLIST" ]]; then uninstall_ok=0; fi
  if [[ "$uninstall_ok" == 1 ]]; then
    if ! "$NODE_BIN" -e '
      const fs = require("node:fs");
      const paths = require("node:path");
      if (process.argv[2] === "1") {
        const descriptor = fs.openSync(process.argv[1], "r");
        try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
      }
      for (const directoryPath of new Set([paths.dirname(process.argv[1]), process.argv[3]])) {
        const directory = fs.openSync(directoryPath, "r");
        try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
      }
    ' "$disabled_resolved" "$had_plist" "${PLIST:h}"; then uninstall_ok=0; fi
  fi
  release_lock
  if [[ "$uninstall_ok" != 1 ]]; then echo "UNINSTALL_RECOVERY_FAILED" >&2; return 1; fi
  if ! clear_uninstall_transaction; then echo "UNINSTALL_MARKER_CLEAR_FAILED" >&2; return 1; fi
}
sync_install_destinations() {
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const paths = require("node:path");
    const files = [[process.argv[1], process.argv[4]], [process.argv[2], process.argv[5]], [process.argv[3], process.argv[6]]];
    for (const [file, required] of files) {
      if (required !== "1") continue;
      const descriptor = fs.openSync(file, "r");
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    }
    for (const directoryPath of new Set(files.map(([file]) => paths.dirname(file)))) {
      const directory = fs.openSync(directoryPath, "r");
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  ' "$CURRENT/collector.mjs" "$CURRENT/manage.sh" "$PLIST" "$1" "$2" "$3"
}
sync_candidate_files() {
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const paths = require("node:path");
    for (const file of process.argv.slice(1)) {
      const descriptor = fs.openSync(file, "r");
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    }
    for (const directoryPath of new Set(process.argv.slice(1).map((file) => paths.dirname(file)))) {
      const directory = fs.openSync(directoryPath, "r");
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  ' "$1" "$2" "$3"
}
sync_selected_files() {
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const paths = require("node:path");
    const files = [[process.argv[1], process.argv[4]], [process.argv[2], process.argv[5]], [process.argv[3], process.argv[6]]];
    for (const [file, required] of files) {
      if (required !== "1") continue;
      const descriptor = fs.openSync(file, "r");
      try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    }
    for (const directoryPath of new Set(files.filter(([, required]) => required === "1").map(([file]) => paths.dirname(file)))) {
      const directory = fs.openSync(directoryPath, "r");
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  ' "$1" "$2" "$3" "$4" "$5" "$6"
}
sync_file_and_directory() {
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const paths = require("node:path");
    const file = process.argv[1];
    const descriptor = fs.openSync(file, "r");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    const directory = fs.openSync(paths.dirname(file), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  ' "$1"
}
sync_directory() {
  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const directory = fs.openSync(process.argv[1], "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  ' "$1"
}
set_transaction_phase() {
  local phase="$1"
  local allowed_install_id="$2"
  local owner_start="$(/bin/ps -p "$$" -o lstart= 2>/dev/null || true)"
  local owner_command="$(/bin/ps -ww -p "$$" -o command= 2>/dev/null || true)"
  [[ "$phase" == "VERIFYING" || "$phase" == "RECOVERING" ]] || return 1
  [[ -n "$owner_start" && -n "$owner_command" ]] || return 1
  transaction_marker_safe || return 1
  if ! "$NODE_BIN" -e '
    const fs = require("node:fs");
    const paths = require("node:path");
    const path = process.argv[1];
    const state = JSON.parse(fs.readFileSync(path, "utf8"));
    state.phase = process.argv[2];
    state.allowedRunInstallId = process.argv[3] || null;
    state.ownerPid = Number(process.argv[4]);
    state.ownerStart = process.argv[5];
    state.ownerCommand = process.argv[6];
    state.phaseUpdatedAt = new Date().toISOString();
    const temporary = `${path}.${process.pid}.recover`;
    const descriptor = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(descriptor, `${JSON.stringify(state)}\n`); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.renameSync(temporary, path);
    const directory = fs.openSync(paths.dirname(path), "r");
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  ' "$INSTALL_TRANSACTION" "$phase" "$allowed_install_id" "$$" "$owner_start" "$owner_command"; then return 1; fi
  transaction_marker_safe || return 1
  [[ "$(transaction_field phase 2>/dev/null || true)" == "$phase" ]] || return 1
  [[ "$(transaction_field allowedRunInstallId 2>/dev/null || true)" == "$allowed_install_id" ]] || return 1
  [[ "$(transaction_field ownerPid 2>/dev/null || true)" == "$$" ]] || return 1
  [[ "$(transaction_field ownerStart 2>/dev/null || true)" == "$owner_start" ]] || return 1
  [[ "$(transaction_field ownerCommand 2>/dev/null || true)" == "$owner_command" ]] || return 1
}
set_transaction_recovery_phase() { set_transaction_phase "RECOVERING" "$1"; }
set_transaction_verification_phase() { set_transaction_phase "VERIFYING" "$1"; }
runtime_transaction_allows_run() {
  if uninstall_marker_present; then
    uninstall_marker_safe || { echo "UNINSTALL_RECOVERY_INVALID" >&2; return 1; }
    echo "UNINSTALL_TRANSACTION_BLOCKS_RUNTIME" >&2
    return 1
  fi
  transaction_marker_present || return 0
  transaction_marker_safe || { echo "INSTALL_RECOVERY_INVALID" >&2; return 1; }
  local phase="$(transaction_field phase 2>/dev/null || true)"
  local allowed_install_id="$(transaction_field allowedRunInstallId 2>/dev/null || true)"
  local owner_pid="$(transaction_field ownerPid 2>/dev/null || true)"
  local owner_start="$(transaction_field ownerStart 2>/dev/null || true)"
  local owner_command="$(transaction_field ownerCommand 2>/dev/null || true)"
  local phase_updated_at="$(transaction_field phaseUpdatedAt 2>/dev/null || true)"
  local current_start=""
  local current_command=""
  local current_state=""
  if [[ "$owner_pid" == <-> ]]; then
    current_start="$(/bin/ps -p "$owner_pid" -o lstart= 2>/dev/null || true)"
    current_command="$(/bin/ps -ww -p "$owner_pid" -o command= 2>/dev/null || true)"
    current_state="$(/bin/ps -p "$owner_pid" -o state= 2>/dev/null | /usr/bin/tr -d '[:space:]' || true)"
  fi
  [[ "$phase" == "VERIFYING" || "$phase" == "RECOVERING" ]] || { echo "INSTALL_TRANSACTION_BLOCKS_RUNTIME" >&2; return 1; }
  [[ -n "$allowed_install_id" && "$allowed_install_id" == "$INSTALL_ID" ]] || { echo "INSTALL_TRANSACTION_BLOCKS_RUNTIME" >&2; return 1; }
  [[ -n "$current_start" && "$current_start" == "$owner_start" && "$current_command" == "$owner_command" ]] || { echo "INSTALL_TRANSACTION_OWNER_INACTIVE" >&2; return 1; }
  [[ -n "$current_state" && "$current_state" != *T* && "$current_state" != *Z* ]] || { echo "INSTALL_TRANSACTION_OWNER_NOT_RUNNABLE" >&2; return 1; }
  if ! "$NODE_BIN" -e '
    const updated = Date.parse(process.argv[1]);
    const age = Date.now() - updated;
    process.exit(Number.isFinite(updated) && age >= -10_000 && age <= 120_000 ? 0 : 1);
  ' "$phase_updated_at"; then
    echo "INSTALL_TRANSACTION_PHASE_EXPIRED" >&2
    return 1
  fi
}
restore_install_transaction() {
  if ! transaction_marker_present; then
    [[ "$INSTALL_TRANSACTION_ACTIVE" == 1 ]] && { echo "INSTALL_RECOVERY_MARKER_MISSING" >&2; return 1; }
    return 0
  fi
  transaction_marker_safe || { echo "INSTALL_RECOVERY_INVALID" >&2; return 1; }
  local version="$(transaction_field version 2>/dev/null || true)"
  local phase="$(transaction_field phase 2>/dev/null || true)"
  local backup_dir="$(transaction_field backupDir 2>/dev/null || true)"
  local had_collector="$(transaction_field hadCollector 2>/dev/null || true)"
  local had_manager="$(transaction_field hadManager 2>/dev/null || true)"
  local had_plist="$(transaction_field hadPlist 2>/dev/null || true)"
  local was_loaded="$(transaction_field wasLoaded 2>/dev/null || true)"
  local old_install_id="$(transaction_field oldInstallId 2>/dev/null || true)"
  local old_readback_mode="$(transaction_field oldReadbackMode 2>/dev/null || true)"
  local new_install_id="$(transaction_field newInstallId 2>/dev/null || true)"
  local collector_sha256="$(transaction_field collectorSha256 2>/dev/null || true)"
  local manager_sha256="$(transaction_field managerSha256 2>/dev/null || true)"
  local plist_sha256="$(transaction_field plistSha256 2>/dev/null || true)"
  local backup_root="${STATE_DIR:A}/backups"
  local backup_resolved="${backup_dir:A}"
  local readback_start_line=0
  local restored_ok=1
  [[ "$version" == 1 && ( "$phase" == "PREPARED" || "$phase" == "VERIFYING" || "$phase" == "RECOVERING" ) && "$backup_resolved" == "$backup_root"/* && -d "$backup_resolved" ]] || { echo "INSTALL_RECOVERY_INVALID" >&2; return 1; }
  print -r -- "$new_install_id" | /usr/bin/grep -Eq '^[A-Za-z0-9._:-]{1,120}$' || { echo "INSTALL_RECOVERY_INVALID" >&2; return 1; }
  backup_dir="$backup_resolved"
  [[ "$had_collector" == [01] && "$had_manager" == [01] && "$had_plist" == [01] && "$was_loaded" == [01] ]] || { echo "INSTALL_RECOVERY_INVALID" >&2; return 1; }
  [[ "$old_readback_mode" == "v2" || "$old_readback_mode" == "legacy" ]] || { echo "INSTALL_RECOVERY_INVALID" >&2; return 1; }
  if [[ "$was_loaded" == 1 ]]; then
    [[ "$had_collector" == 1 && "$had_manager" == 1 && "$had_plist" == 1 ]] || { echo "INSTALL_RECOVERY_INVALID" >&2; return 1; }
    print -r -- "$old_install_id" | /usr/bin/grep -Eq '^[A-Za-z0-9._:-]{1,120}$' || { echo "INSTALL_RECOVERY_INVALID" >&2; return 1; }
  fi
  [[ "$had_collector" != 1 || -f "$backup_dir/collector.mjs" ]] || { echo "INSTALL_RECOVERY_BACKUP_INCOMPLETE" >&2; return 1; }
  [[ "$had_manager" != 1 || -f "$backup_dir/manage.sh" ]] || { echo "INSTALL_RECOVERY_BACKUP_INCOMPLETE" >&2; return 1; }
  [[ "$had_plist" != 1 || -f "$backup_dir/${LABEL}.plist" ]] || { echo "INSTALL_RECOVERY_BACKUP_INCOMPLETE" >&2; return 1; }
  if [[ "$had_collector" == 1 ]]; then valid_sha256 "$collector_sha256" && [[ "$(file_sha256 "$backup_dir/collector.mjs")" == "$collector_sha256" ]] || { echo "INSTALL_RECOVERY_BACKUP_HASH_MISMATCH" >&2; return 1; }; fi
  if [[ "$had_manager" == 1 ]]; then valid_sha256 "$manager_sha256" && [[ "$(file_sha256 "$backup_dir/manage.sh")" == "$manager_sha256" ]] || { echo "INSTALL_RECOVERY_BACKUP_HASH_MISMATCH" >&2; return 1; }; fi
  if [[ "$had_plist" == 1 ]]; then valid_sha256 "$plist_sha256" && [[ "$(file_sha256 "$backup_dir/${LABEL}.plist")" == "$plist_sha256" ]] || { echo "INSTALL_RECOVERY_BACKUP_HASH_MISMATCH" >&2; return 1; }; fi

  if ! bootout_and_wait; then return 1; fi
  if ! acquire_lock 35; then echo "INSTALL_RECOVERY_RUN_LOCK_BUSY" >&2; return 1; fi
  if ! set_transaction_recovery_phase "$old_install_id"; then
    release_lock
    echo "INSTALL_RECOVERY_MARKER_UPDATE_FAILED" >&2
    return 1
  fi
  local restore_token="$(/usr/bin/uuidgen)"
  local collector_restore="$CURRENT/.collector.mjs.restore.$restore_token"
  local manager_restore="$CURRENT/.manage.sh.restore.$restore_token"
  local plist_restore="${PLIST}.restore.$restore_token"
  local restore_candidate=""
  mkdir -p "$CURRENT" "$LOGS" "${PLIST:h}" || restored_ok=0
  for restore_candidate in "$collector_restore" "$manager_restore" "$plist_restore"; do
    if [[ -e "$restore_candidate" || -L "$restore_candidate" ]]; then restored_ok=0; fi
  done
  if [[ "$restored_ok" == 1 && "$had_collector" == 1 ]]; then
    cp "$backup_dir/collector.mjs" "$collector_restore" || restored_ok=0
    if [[ "$restored_ok" == 1 ]] && ! chmod 700 "$collector_restore"; then restored_ok=0; fi
  fi
  if [[ "$restored_ok" == 1 && "$had_plist" == 1 ]]; then
    cp "$backup_dir/${LABEL}.plist" "$plist_restore" || restored_ok=0
    if [[ "$restored_ok" == 1 ]] && ! chmod 600 "$plist_restore"; then restored_ok=0; fi
  fi
  if [[ "$restored_ok" == 1 && "$had_manager" == 1 ]]; then
    cp "$backup_dir/manage.sh" "$manager_restore" || restored_ok=0
    if [[ "$restored_ok" == 1 ]] && ! chmod 700 "$manager_restore"; then restored_ok=0; fi
  fi
  if [[ "$restored_ok" == 1 ]] && ! sync_selected_files "$collector_restore" "$manager_restore" "$plist_restore" "$had_collector" "$had_manager" "$had_plist"; then restored_ok=0; fi
  if [[ "$restored_ok" == 1 ]]; then
    if [[ "$had_collector" == 1 ]]; then mv "$collector_restore" "$CURRENT/collector.mjs" || restored_ok=0
    elif [[ -e "$CURRENT/collector.mjs" || -L "$CURRENT/collector.mjs" ]] && ! mv "$CURRENT/collector.mjs" "$backup_dir/collector.mjs.partial.$(/bin/date +%Y%m%d%H%M%S).$$"; then restored_ok=0; fi
  fi
  if [[ "$restored_ok" == 1 ]]; then
    if [[ "$had_plist" == 1 ]]; then mv "$plist_restore" "$PLIST" || restored_ok=0
    elif [[ -e "$PLIST" || -L "$PLIST" ]] && ! mv "$PLIST" "$backup_dir/${LABEL}.plist.partial.$(/bin/date +%Y%m%d%H%M%S).$$"; then restored_ok=0; fi
  fi
  if [[ "$restored_ok" == 1 ]] && ! sync_install_destinations "$had_collector" 0 "$had_plist"; then restored_ok=0; fi
  if [[ "$restored_ok" == 1 ]] && ! sync_directory "$backup_dir"; then restored_ok=0; fi
  if [[ "$restored_ok" == 1 ]]; then
    if [[ "$had_manager" == 1 ]]; then mv "$manager_restore" "$CURRENT/manage.sh" || restored_ok=0
    elif [[ -e "$CURRENT/manage.sh" || -L "$CURRENT/manage.sh" ]] && ! mv "$CURRENT/manage.sh" "$backup_dir/manage.sh.partial.$(/bin/date +%Y%m%d%H%M%S).$$"; then restored_ok=0; fi
  fi
  if [[ "$had_collector" == 1 ]]; then /usr/bin/cmp -s "$backup_dir/collector.mjs" "$CURRENT/collector.mjs" || restored_ok=0
  elif [[ -e "$CURRENT/collector.mjs" || -L "$CURRENT/collector.mjs" ]]; then restored_ok=0; fi
  if [[ "$had_manager" == 1 ]]; then /usr/bin/cmp -s "$backup_dir/manage.sh" "$CURRENT/manage.sh" || restored_ok=0
  elif [[ -e "$CURRENT/manage.sh" || -L "$CURRENT/manage.sh" ]]; then restored_ok=0; fi
  if [[ "$had_plist" == 1 ]]; then /usr/bin/cmp -s "$backup_dir/${LABEL}.plist" "$PLIST" || restored_ok=0
  elif [[ -e "$PLIST" || -L "$PLIST" ]]; then restored_ok=0; fi
  if [[ "$restored_ok" == 1 ]] && ! sync_install_destinations "$had_collector" "$had_manager" "$had_plist"; then restored_ok=0; fi
  if [[ "$restored_ok" == 1 ]] && ! sync_directory "$backup_dir"; then restored_ok=0; fi
  if [[ "$restored_ok" != 1 ]]; then
    release_lock
    echo "INSTALL_RECOVERY_RESTORE_FAILED backup=$backup_dir" >&2
    return 1
  fi
  if [[ -f "$LOGS/stdout.log" ]]; then readback_start_line="$(/usr/bin/wc -l < "$LOGS/stdout.log" | /usr/bin/tr -d '[:space:]')"; fi
  [[ "$readback_start_line" == <-> ]] || readback_start_line=0

  release_lock
  if [[ "$was_loaded" == 1 ]] && ! launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1; then restored_ok=0; fi
  if [[ "$was_loaded" == 1 && "$restored_ok" == 1 ]] && ! wait_for_install_readback "$readback_start_line" "$old_install_id" "$old_readback_mode"; then restored_ok=0; fi
  if [[ "$was_loaded" == 1 ]]; then
    [[ -f "$PLIST" ]] || restored_ok=0
    launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || restored_ok=0
  else
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then restored_ok=0; fi
  fi
  if [[ "$restored_ok" != 1 ]]; then echo "INSTALL_RECOVERY_READBACK_FAILED backup=$backup_dir" >&2; return 1; fi
  if ! clear_install_transaction; then echo "INSTALL_RECOVERY_MARKER_CLEAR_FAILED backup=$backup_dir" >&2; return 1; fi
  echo "INSTALL_RECOVERED backup=$backup_dir"
}
handle_install_signal() {
  local signal_name="$1"
  local exit_code=130
  [[ "$signal_name" == "TERM" ]] && exit_code=143
  trap - TERM INT
  release_lock
  if [[ "$INSTALL_TRANSACTION_ACTIVE" == 1 ]] || transaction_marker_present; then restore_install_transaction || true; fi
  if [[ "$UNINSTALL_TRANSACTION_ACTIVE" == 1 ]] || uninstall_marker_present; then complete_uninstall_transaction || true; fi
  release_install_lock
  exit "$exit_code"
}
handle_uninstall_signal() {
  local signal_name="$1"
  local exit_code=130
  [[ "$signal_name" == "TERM" ]] && exit_code=143
  trap - TERM INT
  release_lock
  if [[ "$INSTALL_TRANSACTION_ACTIVE" == 1 ]] || transaction_marker_present; then restore_install_transaction || true; fi
  if [[ "$UNINSTALL_TRANSACTION_ACTIVE" == 1 ]] || uninstall_marker_present; then complete_uninstall_transaction || true; fi
  release_install_lock
  exit "$exit_code"
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
    [[ "${STATE_DIR:A}" == "$HOME"/* && "${STATE_DIR:A}" != "$HOME" ]] || { echo "STATE_DIR inseguro" >&2; exit 1; }
    [[ -x "$NODE_BIN" ]] || { echo "Falta Node para recuperar la instalación" >&2; exit 1; }
    mkdir -p "$STATE_DIR" "$CURRENT" "$LOGS" "$HOME/Library/LaunchAgents"
    if ! acquire_install_lock; then
      echo "INSTALL_BUSY otra instalación está activa" >&2
      exit 1
    fi
    trap 'release_lock; release_install_lock' EXIT
    trap 'handle_install_signal TERM' TERM
    trap 'handle_install_signal INT' INT
    if transaction_marker_present && uninstall_marker_present; then
      echo "TRANSACTION_STATE_AMBIGUOUS install=$INSTALL_TRANSACTION uninstall=$UNINSTALL_TRANSACTION" >&2
      exit 1
    fi
    if transaction_marker_present; then
      transaction_marker_safe || { echo "INSTALL_RECOVERY_INVALID marker=$INSTALL_TRANSACTION" >&2; exit 1; }
      INSTALL_TRANSACTION_ACTIVE=1
      if ! restore_install_transaction; then
        echo "INSTALL_RECOVERY_REQUIRED marker=$INSTALL_TRANSACTION" >&2
        exit 1
      fi
    fi
    if uninstall_marker_present; then
      uninstall_marker_safe || { echo "UNINSTALL_RECOVERY_INVALID marker=$UNINSTALL_TRANSACTION" >&2; exit 1; }
      UNINSTALL_TRANSACTION_ACTIVE=1
      if ! complete_uninstall_transaction; then
        echo "UNINSTALL_RECOVERY_REQUIRED marker=$UNINSTALL_TRANSACTION" >&2
        exit 1
      fi
      echo "UNINSTALL_RECOVERED state_preserved=$STATE_DIR"
    fi
    validate 1
    "$NODE_BIN" --check "$SOURCE_DIR/collector.mjs"
    /bin/zsh -n "$SCRIPT_PATH"
    backup_dir="$STATE_DIR/backups/$(/bin/date +%Y%m%d%H%M%S).$$"
    mkdir -p "$backup_dir"
    had_collector=0
    had_manager=0
    had_plist=0
    was_loaded=0
    old_install_id=""
    old_readback_mode="legacy"
    launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && was_loaded=1
    [[ -f "$CURRENT/collector.mjs" ]] && { had_collector=1; cp "$CURRENT/collector.mjs" "$backup_dir/collector.mjs"; }
    [[ -f "$CURRENT/manage.sh" ]] && { had_manager=1; cp "$CURRENT/manage.sh" "$backup_dir/manage.sh"; }
    [[ -f "$PLIST" ]] && { had_plist=1; cp "$PLIST" "$backup_dir/${LABEL}.plist"; }
    if [[ "$had_plist" == 1 ]]; then old_install_id="$(/usr/bin/plutil -extract EnvironmentVariables.COMPANY_OS_CODEX_INSTALL_ID raw -o - "$backup_dir/${LABEL}.plist" 2>/dev/null || true)"; fi
    if [[ "$had_manager" == 1 ]] && /usr/bin/grep -Fq 'DISPATCH_POLL_OK' "$backup_dir/manage.sh"; then old_readback_mode="v2"; fi
    if [[ "$was_loaded" == 1 && ( -z "$old_install_id" || "$had_collector" != 1 || "$had_manager" != 1 || "$had_plist" != 1 ) ]]; then
      echo "INSTALL_BACKUP_NOT_RECOVERABLE" >&2
      exit 1
    fi
    chmod 700 "$STATE_DIR" "$CURRENT" "$LOGS"
    collector_candidate="$STATE_DIR/collector.mjs.new.$$"
    manager_candidate="$STATE_DIR/manage.sh.new.$$"
    plist_candidate="$STATE_DIR/${LABEL}.plist.new.$$"
    cp "$SOURCE_DIR/collector.mjs" "$collector_candidate"
    cp "$SCRIPT_PATH" "$manager_candidate"
    chmod 700 "$collector_candidate" "$manager_candidate"
    render_plist "$plist_candidate"
    sync_candidate_files "$collector_candidate" "$manager_candidate" "$plist_candidate"
    write_install_transaction "$backup_dir" "$had_collector" "$had_manager" "$had_plist" "$was_loaded" "$old_install_id" "$old_readback_mode"
    if ! bootout_and_wait; then
      echo "INSTALL_QUIESCENCE_REQUIRED marker=$INSTALL_TRANSACTION" >&2
      exit 1
    fi
    if ! acquire_lock 35; then
      restore_install_transaction || true
      echo "INSTALL_BUSY collector activo o lock legacy no reconciliado" >&2
      exit 1
    fi
    if [[ -f "$STATE_DIR/dispatch-state.json" || -f "$STATE_DIR/dispatch-state.quarantined" ]]; then
      release_lock
      restore_install_transaction || true
      echo "INSTALL_REQUIRES_QUIESCENCE: primero debe reconciliarse el journal de despacho" >&2
      exit 1
    fi
    install_ok=1
    if ! mv "$manager_candidate" "$CURRENT/manage.sh"; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! sync_file_and_directory "$CURRENT/manage.sh"; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! mv "$collector_candidate" "$CURRENT/collector.mjs"; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! mv "$plist_candidate" "$PLIST"; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! sync_install_destinations 1 1 1; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! set_transaction_verification_phase "$INSTALL_ID"; then install_ok=0; fi
    readback_start_line=0
    if [[ -f "$LOGS/stdout.log" ]]; then readback_start_line="$(/usr/bin/wc -l < "$LOGS/stdout.log" | /usr/bin/tr -d '[:space:]')"; fi
    [[ "$readback_start_line" == <-> ]] || readback_start_line=0
    release_lock
    if [[ "$install_ok" == 1 ]] && ! launchctl bootstrap "gui/$(id -u)" "$PLIST"; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! wait_for_install_readback "$readback_start_line"; then install_ok=0; fi
    if [[ "$install_ok" == 1 && ! -f "$PLIST" ]]; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! /usr/bin/cmp -s "$SOURCE_DIR/collector.mjs" "$CURRENT/collector.mjs"; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! /usr/bin/cmp -s "$SCRIPT_PATH" "$CURRENT/manage.sh"; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! /usr/bin/plutil -lint "$PLIST" >/dev/null; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! sync_install_destinations 1 1 1; then install_ok=0; fi
    if [[ "$install_ok" == 1 ]] && ! clear_install_transaction; then install_ok=0; fi
    if [[ "$install_ok" != 1 ]]; then
      if ! restore_install_transaction; then echo "INSTALL_FAILED rollback_incomplete=$backup_dir" >&2; exit 1; fi
      echo "INSTALL_FAILED rollback=$backup_dir" >&2
      exit 1
    fi
    echo "INSTALLED label=$LABEL interval=300 install_id=$INSTALL_ID"
    release_install_lock
    trap - EXIT TERM INT
    ;;
  run)
    validate 1
    mkdir -p "$STATE_DIR"
    acquire_lock || exit 0
    trap release_lock EXIT
    runtime_transaction_allows_run || exit 1
    trap 'forward_signal TERM' TERM
    trap 'forward_signal INT' INT
    prepare_collector_start_gate || { echo "COLLECTOR_START_GATE_PREPARE_FAILED" >&2; exit 1; }
    COMPANY_OS_CODEX_START_GATE="$COLLECTOR_START_GATE" COMPANY_OS_CODEX_START_TOKEN="$COLLECTOR_START_TOKEN" COMPANY_OS_CODEX_SOURCE_HOST="$SOURCE_HOST" COMPANY_OS_CODEX_INSTALL_ID="$INSTALL_ID" COMPANY_OS_CODEX_INTAKE_SECRET="$(secret)" "$NODE_BIN" "$CURRENT/collector.mjs" &
    COLLECTOR_PID="$!"
    if ! rotate_legacy_sentinel_owner "$COLLECTOR_PID"; then
      kill -TERM "$COLLECTOR_PID" 2>/dev/null || true
      wait "$COLLECTOR_PID" 2>/dev/null || true
      COLLECTOR_PID=""
      echo "LEGACY_BRIDGE_OWNER_UPDATE_FAILED" >&2
      exit 1
    fi
    if ! signal_collector_start; then
      kill -TERM "$COLLECTOR_PID" 2>/dev/null || true
      wait "$COLLECTOR_PID" 2>/dev/null || true
      COLLECTOR_PID=""
      clear_collector_start_gate
      echo "COLLECTOR_START_GATE_SIGNAL_FAILED" >&2
      exit 1
    fi
    wait_for_collector
    ;;
  once)
    COMPANY_OS_CODEX_AUTO_RESUME=0 validate 0
    mkdir -p "$STATE_DIR"
    acquire_lock || exit 0
    trap release_lock EXIT
    runtime_transaction_allows_run || exit 1
    trap 'forward_signal TERM' TERM
    trap 'forward_signal INT' INT
    prepare_collector_start_gate || { echo "COLLECTOR_START_GATE_PREPARE_FAILED" >&2; exit 1; }
    COMPANY_OS_CODEX_START_GATE="$COLLECTOR_START_GATE" COMPANY_OS_CODEX_START_TOKEN="$COLLECTOR_START_TOKEN" COMPANY_OS_CODEX_AUTO_RESUME=0 COMPANY_OS_CODEX_SOURCE_HOST="$SOURCE_HOST" COMPANY_OS_CODEX_INSTALL_ID="$INSTALL_ID" COMPANY_OS_CODEX_INTAKE_SECRET="$(secret)" "$NODE_BIN" "$SOURCE_DIR/collector.mjs" &
    COLLECTOR_PID="$!"
    if ! rotate_legacy_sentinel_owner "$COLLECTOR_PID"; then
      kill -TERM "$COLLECTOR_PID" 2>/dev/null || true
      wait "$COLLECTOR_PID" 2>/dev/null || true
      COLLECTOR_PID=""
      echo "LEGACY_BRIDGE_OWNER_UPDATE_FAILED" >&2
      exit 1
    fi
    if ! signal_collector_start; then
      kill -TERM "$COLLECTOR_PID" 2>/dev/null || true
      wait "$COLLECTOR_PID" 2>/dev/null || true
      COLLECTOR_PID=""
      clear_collector_start_gate
      echo "COLLECTOR_START_GATE_SIGNAL_FAILED" >&2
      exit 1
    fi
    wait_for_collector
    ;;
  uninstall)
    [[ "${STATE_DIR:A}" == "$HOME"/* && "${STATE_DIR:A}" != "$HOME" ]] || { echo "STATE_DIR inseguro" >&2; exit 1; }
    [[ -x "$NODE_BIN" ]] || { echo "Falta Node para completar la desinstalación" >&2; exit 1; }
    mkdir -p "$STATE_DIR"
    if ! acquire_install_lock; then
      echo "UNINSTALL_BUSY instalación o desinstalación activa" >&2
      exit 1
    fi
    trap 'release_lock; release_install_lock' EXIT
    trap 'handle_uninstall_signal TERM' TERM
    trap 'handle_uninstall_signal INT' INT
    if transaction_marker_present && uninstall_marker_present; then
      echo "TRANSACTION_STATE_AMBIGUOUS install=$INSTALL_TRANSACTION uninstall=$UNINSTALL_TRANSACTION" >&2
      exit 1
    fi
    if transaction_marker_present; then
      transaction_marker_safe || { echo "INSTALL_RECOVERY_INVALID marker=$INSTALL_TRANSACTION" >&2; exit 1; }
      INSTALL_TRANSACTION_ACTIVE=1
      if ! restore_install_transaction; then
        echo "UNINSTALL_REQUIRES_INSTALL_RECOVERY marker=$INSTALL_TRANSACTION" >&2
        exit 1
      fi
    fi
    uninstall_guard_required=0
    if [[ -f "$PLIST" ]] || launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then uninstall_guard_required=1; fi
    if [[ "$uninstall_guard_required" == 1 ]] && ! installed_manager_supports_uninstall_gate; then
      echo "UNINSTALL_REQUIRES_V2_GUARD: ejecute install primero" >&2
      exit 1
    fi
    if uninstall_marker_present; then
      uninstall_marker_safe || { echo "UNINSTALL_RECOVERY_INVALID marker=$UNINSTALL_TRANSACTION" >&2; exit 1; }
      UNINSTALL_TRANSACTION_ACTIVE=1
      if ! complete_uninstall_transaction; then
        echo "UNINSTALL_RECOVERY_REQUIRED marker=$UNINSTALL_TRANSACTION" >&2
        exit 1
      fi
      echo "UNINSTALLED state_preserved=$STATE_DIR recovered=1"
      release_install_lock
      trap - EXIT TERM INT
      exit 0
    fi
    [[ ! -L "$PLIST" ]] || { echo "UNINSTALL_PLIST_INVALID" >&2; exit 1; }
    if [[ -f "$STATE_DIR/dispatch-state.json" || -f "$STATE_DIR/dispatch-state.quarantined" ]]; then
      echo "UNINSTALL_REQUIRES_DISPATCH_RECONCILIATION" >&2
      exit 1
    fi
    uninstall_was_loaded=0
    launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && uninstall_was_loaded=1
    uninstall_had_plist=0
    [[ -f "$PLIST" ]] && uninstall_had_plist=1
    uninstall_disabled_path="$STATE_DIR/${LABEL}.plist.disabled.$(/bin/date +%Y%m%d%H%M%S).$$"
    if [[ -e "$uninstall_disabled_path" || -L "$uninstall_disabled_path" ]]; then
      echo "UNINSTALL_DESTINATION_EXISTS" >&2
      exit 1
    fi
    write_uninstall_transaction "$uninstall_disabled_path" "$uninstall_had_plist" "$uninstall_was_loaded"
    if ! complete_uninstall_transaction; then
      echo "UNINSTALL_RECOVERY_REQUIRED marker=$UNINSTALL_TRANSACTION" >&2
      exit 1
    fi
    echo "UNINSTALLED state_preserved=$STATE_DIR"
    release_install_lock
    trap - EXIT TERM INT
    ;;
  status)
    if transaction_marker_present; then
      if transaction_marker_safe; then echo "INSTALL_RECOVERY_REQUIRED marker=$INSTALL_TRANSACTION"
      else echo "INSTALL_RECOVERY_INVALID marker=$INSTALL_TRANSACTION"; fi
    fi
    if uninstall_marker_present; then
      if uninstall_marker_safe; then echo "UNINSTALL_RECOVERY_REQUIRED marker=$UNINSTALL_TRANSACTION"
      else echo "UNINSTALL_RECOVERY_INVALID marker=$UNINSTALL_TRANSACTION"; fi
    fi
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      echo "LOADED label=$LABEL"
      launchctl print "gui/$(id -u)/$LABEL" | /usr/bin/grep -E 'state =|pid =|last exit code =' || true
    else echo "INACTIVE label=$LABEL"; fi
    [[ -f "$LOGS/stdout.log" ]] && tail -1 "$LOGS/stdout.log" || true
    [[ -s "$LOGS/stderr.log" ]] && tail -3 "$LOGS/stderr.log" || true
    ;;
  *) echo "Uso: manage.sh install|run|once|status|uninstall" >&2; exit 2 ;;
esac
