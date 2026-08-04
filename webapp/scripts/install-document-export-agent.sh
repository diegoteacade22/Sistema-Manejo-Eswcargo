#!/bin/zsh
set -euo pipefail

APP_DIR="${1:-$PWD}"
LABEL="com.eswcargo.document-export"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.eswcargo/document-export"
NODE_BIN="$(command -v node)"

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

/usr/libexec/PlistBuddy -c 'Clear dict' "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :Label string $LABEL" "$PLIST"
/usr/libexec/PlistBuddy -c 'Add :ProgramArguments array' "$PLIST"
/usr/libexec/PlistBuddy -c "Add :ProgramArguments:0 string $NODE_BIN" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :ProgramArguments:1 string $APP_DIR/node_modules/tsx/dist/cli.mjs" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :ProgramArguments:2 string $APP_DIR/scripts/export-operational-documents.ts" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :WorkingDirectory string $APP_DIR" "$PLIST"
/usr/libexec/PlistBuddy -c 'Add :EnvironmentVariables dict' "$PLIST"
/usr/libexec/PlistBuddy -c 'Add :EnvironmentVariables:ESW_PRISMA_QUERY_LOG string 0' "$PLIST"
/usr/libexec/PlistBuddy -c 'Add :RunAtLoad bool true' "$PLIST"
/usr/libexec/PlistBuddy -c 'Add :StartInterval integer 1800' "$PLIST"
/usr/libexec/PlistBuddy -c "Add :StandardOutPath string $LOG_DIR/launchd.out.log" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :StandardErrorPath string $LOG_DIR/launchd.err.log" "$PLIST"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
echo "Agente instalado: $LABEL"
