#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"
python3 run_pipeline.py
REPO_ROOT="$(cd ../.. && pwd)"
cd "$REPO_ROOT"
git push origin HEAD:market-radar-data
printf '\nOK: market radar normalized and published to Google Sheets feed.\n'
