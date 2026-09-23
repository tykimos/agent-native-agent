#!/usr/bin/env bash
# ANA 설치 — 빠진 것만 설치한다(이미 있는 것은 건드리지 않음, 여러 번 돌려도 안전).
#   macOS           : Homebrew → node, tmux, git
#   Linux / WSL     : apt · dnf/yum · pacman · zypper · apk → tmux, git, curl + Node 22(NodeSource, apt/dnf)
#   공통             : Claude Code CLI (공식 설치 스크립트), ANA 저장소 clone(저장소 밖에서 실행한 경우)
#   Windows(비 WSL) : 거부 — PowerShell에서 install-wsl.ps1을 먼저 실행하라고 안내
# Usage: bash install.sh                       (저장소 안에서)
#        ANA_DIR=~/ana/agent-native-agent bash install.sh   (clone 위치 지정)
# Env:   ANA_REPO (기본 https://github.com/tykimos/agent-native-agent), ANA_DIR, SKIP_CLAUDE=1
set -euo pipefail
ANA_REPO=${ANA_REPO:-https://github.com/tykimos/agent-native-agent}
ANA_DIR=${ANA_DIR:-$HOME/ana/agent-native-agent}
say() { printf '\033[36m[ana-install]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[ana-install]\033[0m %s\n' "$*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }
node_ok() { has node && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; }
SUDO=""; [ "$(id -u)" -ne 0 ] && has sudo && SUDO="sudo"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) die "Windows detected outside WSL. tmux runs only in WSL — open PowerShell and run: powershell -ExecutionPolicy Bypass -File skills\\install\\scripts\\install-wsl.ps1" ;;
esac

# ---------- macOS ----------
if [ "$(uname -s)" = Darwin ]; then
  if ! has brew; then
    say "Installing Homebrew (asks for your password once)…"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
  fi
  PKGS=(); has tmux || PKGS+=(tmux); has git || PKGS+=(git); node_ok || PKGS+=(node)
  if [ ${#PKGS[@]} -gt 0 ]; then say "brew install ${PKGS[*]}"; brew install "${PKGS[@]}"; fi

# ---------- Linux / WSL ----------
else
  if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; then say "WSL detected (${WSL_DISTRO_NAME:-wsl})"; fi
  if   has apt-get; then PM=apt
  elif has dnf;     then PM=dnf
  elif has yum;     then PM=yum
  elif has pacman;  then PM=pacman
  elif has zypper;  then PM=zypper
  elif has apk;     then PM=apk
  else die "No supported package manager (apt/dnf/yum/pacman/zypper/apk). Install tmux, git, curl and Node ≥ 20 manually."; fi
  BASE=(); has tmux || BASE+=(tmux); has git || BASE+=(git); has curl || BASE+=(curl)
  inst() {
    case $PM in
      apt)    export DEBIAN_FRONTEND=noninteractive; $SUDO apt-get update -qq; $SUDO apt-get install -y -qq "$@" ;;
      dnf|yum) $SUDO $PM install -y -q "$@" ;;
      pacman) $SUDO pacman -Sy --noconfirm --needed "$@" ;;
      zypper) $SUDO zypper -n install "$@" ;;
      apk)    $SUDO apk add --no-cache "$@" ;;
    esac
  }
  [ ${#BASE[@]} -gt 0 ] && { say "Installing ${BASE[*]} via $PM"; inst "${BASE[@]}"; }
  if ! node_ok; then
    say "Installing Node.js 22"
    case $PM in
      apt)     curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - >/dev/null; inst nodejs ;;
      dnf|yum) curl -fsSL https://rpm.nodesource.com/setup_22.x | $SUDO bash - >/dev/null; inst nodejs ;;
      pacman)  inst nodejs npm ;;
      zypper)  inst nodejs22 || inst nodejs ;;
      apk)     inst nodejs npm ;;
    esac
    node_ok || die "Node ≥ 20 still not available ($(node -v 2>/dev/null || echo none)). Install it manually (e.g. nvm) and re-run."
  fi
fi

# ---------- Claude Code ----------
export PATH="$HOME/.local/bin:$PATH"
if [ "${SKIP_CLAUDE:-0}" != 1 ] && ! has claude; then
  say "Installing Claude Code CLI"
  curl -fsSL https://claude.ai/install.sh | bash
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    [ -f "$rc" ] && ! grep -q '.local/bin' "$rc" && echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$rc"
  done
fi

# ---------- 저장소 ----------
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." 2>/dev/null && pwd || true)
if [ -n "$HERE" ] && [ -f "$HERE/server.js" ] && [ -f "$HERE/channel-core.js" ]; then
  ANA_DIR="$HERE"
elif [ ! -f "$ANA_DIR/server.js" ]; then
  say "Cloning $ANA_REPO → $ANA_DIR"
  mkdir -p "$(dirname "$ANA_DIR")"; git clone -q "$ANA_REPO" "$ANA_DIR"
fi

echo
say "Done: node $(node -v) · tmux $(tmux -V | awk '{print $2}') · git $(git --version | awk '{print $3}') · claude $(has claude && claude --version 2>/dev/null | head -1 || echo 'skipped')"
say "Repo: $ANA_DIR"
say "Next: bash $ANA_DIR/skills/install/scripts/run.sh   (first run: attach and finish the Claude login)"
