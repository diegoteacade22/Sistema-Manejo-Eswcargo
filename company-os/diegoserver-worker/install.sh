#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
PLIST="$HOME/Library/LaunchAgents/com.esw.diegoserver-worker.plist"
LOGDIR="$HOME/08_LOGS"
mkdir -p "$LOGDIR" "$HOME/Library/LaunchAgents"
command -v gh >/dev/null || { echo 'ERROR: gh no instalado'; exit 2; }
command -v codex >/dev/null || { echo 'ERROR: codex no instalado'; exit 3; }
gh auth status >/dev/null 2>&1 || { echo 'ERROR: GitHub CLI no autenticado'; exit 4; }
REPO="${DIEGOSERVER_REPO:-}"
if [[ -z "$REPO" || ! -d "$REPO/.git" ]]; then
  REPO="$(find "$HOME" -maxdepth 6 -type d -name Sistema-Manejo-Eswcargo -exec test -d '{}/.git' \; -print 2>/dev/null | head -1)"
fi
if [[ -z "$REPO" ]]; then
  ROOT="$HOME/02_DESARROLLO/02_Activos_Deploy"
  mkdir -p "$ROOT"
  REPO="$ROOT/Sistema-Manejo-Eswcargo"
  gh repo clone diegoteacade22/Sistema-Manejo-Eswcargo "$REPO"
fi
cd "$REPO"
git fetch origin --prune
git checkout main
git pull --ff-only origin main
NODE="$(command -v node)"
WORKER="$REPO/company-os/diegoserver-worker/worker.mjs"
[[ -f "$WORKER" ]] || { echo 'ERROR: worker.mjs no existe en main'; exit 5; }
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.esw.diegoserver-worker</string>
<key>ProgramArguments</key><array><string>$NODE</string><string>$WORKER</string></array>
<key>EnvironmentVariables</key><dict>
<key>PATH</key><string>/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
<key>DIEGOSERVER_REPO</key><string>$REPO</string>
<key>DIEGOSERVER_WORKSPACE</key><string>${REPO:h}</string>
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
echo "REPO=$REPO"
echo 'DIEGOSERVER_CHATGPT_WORKER_READY'
tail -20 "$LOGDIR/diegoserver-worker.log" 2>/dev/null || true
