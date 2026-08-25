#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
PLIST="$HOME/Library/LaunchAgents/com.esw.diegoserver-worker.plist"
LOGDIR="$HOME/08_LOGS"
STATE_DIR="$HOME/.diegoserver-worker"
EXEC_REPO="$STATE_DIR/repo"
RUNTIME_WORKER="$STATE_DIR/worker.mjs"
mkdir -p "$LOGDIR" "$HOME/Library/LaunchAgents" "$STATE_DIR"
command -v gh >/dev/null || { echo 'ERROR: gh no instalado'; exit 2; }
command -v codex >/dev/null || { echo 'ERROR: codex no instalado'; exit 3; }
gh auth status >/dev/null 2>&1 || { echo 'ERROR: GitHub CLI no autenticado'; exit 4; }
SOURCE_REPO="${DIEGOSERVER_SOURCE_REPO:-}"
if [[ -z "$SOURCE_REPO" || ! -d "$SOURCE_REPO/.git" ]]; then
  SOURCE_REPO="$(find "$HOME" -maxdepth 7 -type f -path '*/company-os/diegoserver-worker/worker.mjs' -print 2>/dev/null | head -1 | sed 's#/company-os/diegoserver-worker/worker.mjs$##')"
fi
[[ -n "$SOURCE_REPO" && -f "$SOURCE_REPO/company-os/diegoserver-worker/worker.mjs" ]] || { echo 'ERROR: worker.mjs fuente no encontrado'; exit 5; }
cp "$SOURCE_REPO/company-os/diegoserver-worker/worker.mjs" "$RUNTIME_WORKER"
chmod 700 "$RUNTIME_WORKER"
if [[ ! -d "$EXEC_REPO/.git" ]]; then
  gh repo clone diegoteacade22/Sistema-Manejo-Eswcargo "$EXEC_REPO"
else
  git -C "$EXEC_REPO" fetch --all --prune
fi
NODE="$(command -v node)"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.esw.diegoserver-worker</string>
<key>ProgramArguments</key><array><string>$NODE</string><string>$RUNTIME_WORKER</string></array>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
<key>DIEGOSERVER_REPO</key><string>$EXEC_REPO</string>
<key>DIEGOSERVER_WORKSPACE</key><string>$STATE_DIR</string>
</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$LOGDIR/diegoserver-worker.log</string>
<key>StandardErrorPath</key><string>$LOGDIR/diegoserver-worker.err.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/com.esw.diegoserver-worker" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.esw.diegoserver-worker"
sleep 2
launchctl print "gui/$(id -u)/com.esw.diegoserver-worker" >/dev/null
echo "SOURCE_REPO=$SOURCE_REPO"
echo "ISOLATED_REPO=$EXEC_REPO"
echo 'DIEGOSERVER_CHATGPT_WORKER_READY_ISOLATED'
tail -20 "$LOGDIR/diegoserver-worker.log" 2>/dev/null || true
