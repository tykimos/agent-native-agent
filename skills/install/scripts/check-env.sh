#!/usr/bin/env bash
# ANA 환경 진단 — 무엇이 있고 무엇이 빠졌는지 보고만 한다(아무것도 설치·변경하지 않는다).
# Usage: bash check-env.sh [PORT]      (기본 PORT=8809)
# 출력: 사람이 읽는 표 + 마지막 줄에 기계가 읽는 요약  ANA_ENV platform=<..> missing=<a,b> ready=<yes|no>
set -uo pipefail
PORT=${1:-${PORT:-8809}}

ok()   { printf '  \033[32m✓\033[0m %-10s %s\n' "$1" "$2"; }
bad()  { printf '  \033[31m✗\033[0m %-10s %s\n' "$1" "$2"; MISSING+=("$1"); }
warn() { printf '  \033[33m!\033[0m %-10s %s\n' "$1" "$2"; }
MISSING=()

# ---- 플랫폼 ----
UNAME=$(uname -s 2>/dev/null || echo unknown)
PLATFORM=unknown; DISTRO=""; PKG=""
case "$UNAME" in
  Darwin) PLATFORM=macos; DISTRO="macOS $(sw_vers -productVersion 2>/dev/null)"; command -v brew >/dev/null && PKG=brew ;;
  Linux)
    if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; then PLATFORM=wsl; else PLATFORM=linux; fi
    [ -r /etc/os-release ] && . /etc/os-release && DISTRO="${PRETTY_NAME:-$ID}"
    for p in apt-get dnf yum pacman zypper apk; do command -v $p >/dev/null && { PKG=$p; break; }; done ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM=windows-native ;;
esac

echo "ANA environment check"
echo "  platform   $PLATFORM ${DISTRO:+($DISTRO)}"
echo "  pkg mgr    ${PKG:-none}"
echo

if [ "$PLATFORM" = windows-native ]; then
  bad windows "Git Bash/MSYS/Cygwin detected — ANA needs tmux, which runs only inside WSL. Run scripts/install-wsl.ps1 from PowerShell."
  echo; echo "ANA_ENV platform=$PLATFORM missing=wsl ready=no"; exit 0
fi
[ "$PLATFORM" = macos ] && [ -z "$PKG" ] && warn brew "Homebrew not found — install.sh will install it (https://brew.sh)"

# ---- 필수 도구 ----
if command -v node >/dev/null; then
  NV=$(node -p 'process.versions.node' 2>/dev/null); NM=${NV%%.*}
  if [ "${NM:-0}" -ge 24 ]; then ok node "v$NV"; else bad node "v$NV found — need ≥ 24 (node:sqlite for the NodeRel graph)"; fi
else bad node "not installed (need ≥ 24)"; fi

if command -v tmux >/dev/null; then
  TV=$(tmux -V | awk '{print $2}'); ok tmux "$TV"
  [ "${TV%%.*}" -lt 3 ] 2>/dev/null && warn tmux "tmux < 3.0 — upgrade recommended"
else bad tmux "not installed"; fi

command -v git  >/dev/null && ok git  "$(git --version | awk '{print $3}')" || bad git "not installed"
command -v curl >/dev/null && ok curl "present" || bad curl "not installed"

if command -v claude >/dev/null || [ -x "$HOME/.local/bin/claude" ]; then
  ok claude "$( (command -v claude >/dev/null && claude --version || "$HOME/.local/bin/claude" --version) 2>/dev/null | head -1)"
else bad claude "Claude Code CLI not installed (any agent CLI works, claude is the default)"; fi

# ---- 저장소 / 포트 ----
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." 2>/dev/null && pwd)
if [ -f "$HERE/server.js" ] && [ -f "$HERE/channel-core.js" ]; then ok repo "$HERE"
  case "$HERE" in /mnt/[a-z]/*) warn repo "repo is on the Windows drive (/mnt/…) — slow file I/O; clone into ~ inside WSL instead";; esac
else warn repo "not inside the ANA repo — install.sh will clone it"; fi

if (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; then warn port "$PORT is in use — run.sh will pick the next free port"
else ok port "$PORT free"; fi

if command -v tmux >/dev/null && tmux has-session -t "${TMUX_SESSION:-ana}" 2>/dev/null; then
  warn session "tmux session '${TMUX_SESSION:-ana}' already exists (run.sh reuses it)"
fi

echo
READY=yes; [ ${#MISSING[@]} -gt 0 ] && READY=no
MIS=$(IFS=,; echo "${MISSING[*]:-}")
[ "$READY" = yes ] && echo "All set — start ANA with: bash skills/install/scripts/run.sh" \
                   || echo "Missing: $MIS — fix with: bash skills/install/scripts/install.sh"
echo "ANA_ENV platform=$PLATFORM missing=${MIS:-none} ready=$READY"
