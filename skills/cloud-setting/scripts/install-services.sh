#!/usr/bin/env bash
# Run ON the VM. Renders and enables systemd units for the agent tmux session and the ANA server.
# Usage: bash install-services.sh <PROJECT> [PORT=8809] [APP_DIR=~/Projects/<PROJECT>/<repo>]
set -euo pipefail
PROJECT=${1:?project}; PORT=${2:-8809}
APP_DIR=${3:-$(ls -d "$HOME/Projects/$PROJECT"/*/ | head -1)}; APP_DIR=${APP_DIR%/}
SESSION="${PROJECT}-ana"; USER_NAME=$(id -un); HOME_DIR=$HOME
TPL=$(cd "$(dirname "$0")/../templates" && pwd)
render() { sed -e "s|{{PROJECT}}|$PROJECT|g" -e "s|{{SESSION}}|$SESSION|g" -e "s|{{PORT}}|$PORT|g" \
               -e "s|{{APP_DIR}}|$APP_DIR|g" -e "s|{{USER}}|$USER_NAME|g" -e "s|{{HOME}}|$HOME_DIR|g" "$1"; }
render "$TPL/project-ana-tmux.service" | sudo tee "/etc/systemd/system/${PROJECT}-ana-tmux.service" >/dev/null
render "$TPL/ana-project.service"      | sudo tee "/etc/systemd/system/ana-${PROJECT}.service" >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable --now "${PROJECT}-ana-tmux.service" "ana-${PROJECT}.service"
sleep 3; systemctl is-active "${PROJECT}-ana-tmux" "ana-${PROJECT}"
curl -s "http://127.0.0.1:${PORT}/api/health"; echo
