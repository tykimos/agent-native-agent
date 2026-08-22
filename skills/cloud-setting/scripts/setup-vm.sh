#!/usr/bin/env bash
# Run ON the VM. Installs Node 22, tmux, Claude Code; clones REPO into ~/Projects/PROJECT; starts tmux <PROJECT>-ana running claude.
# Usage: PROJECT=prosecution REPO=https://github.com/tykimos/agent-native-agent bash setup-vm.sh
#    or: bash setup-vm.sh <PROJECT> <REPO>
set -euo pipefail
PROJECT=${1:-${PROJECT:?project name}}; REPO=${2:-${REPO:?git repo url}}
SESSION="${PROJECT}-ana"; DIR="$HOME/Projects/$PROJECT"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq && sudo apt-get install -y -qq tmux git curl >/dev/null
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs >/dev/null
fi
command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash >/dev/null
grep -q '.local/bin' ~/.bashrc || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
export PATH="$HOME/.local/bin:$PATH"
mkdir -p "$DIR"; cd "$DIR"
NAME=$(basename "$REPO" .git); [ -d "$NAME" ] || git clone -q "$REPO"
cd "$NAME"
tmux has-session -t "$SESSION" 2>/dev/null || tmux new-session -d -s "$SESSION" -c "$PWD" -x 200 -y 50 'export PATH="$HOME/.local/bin:$PATH"; claude'
echo "node $(node -v), $(claude --version), tmux session $SESSION in $PWD"
echo "Next: tmux attach -t $SESSION  (finish Claude login), then install-cloudflared.sh and install-services.sh"
