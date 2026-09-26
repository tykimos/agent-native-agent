#!/usr/bin/env bash
# ANA 실행 — tmux 세션 2개를 띄운다: 에이전트(<S>)와 서버(<S>-server). 이미 떠 있으면 재사용.
# Usage: bash run.sh [start|stop|status|restart]
# Env:   TMUX_SESSION (기본 ana) · PORT (기본 8809, 사용 중이면 다음 빈 포트) · AGENT_CMD (기본 claude)
#        BIND (기본 127.0.0.1 — 0.0.0.0은 인증이 없으므로 신뢰망에서만)
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
S=${TMUX_SESSION:-ana}; SRV="$S-server"
AGENT_CMD=${AGENT_CMD:-claude}
BIND=${BIND:-127.0.0.1}
export PATH="$HOME/.local/bin:$PATH"
say() { printf '\033[36m[ana]\033[0m %s\n' "$*"; }
busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
alive() { tmux has-session -t "$1" 2>/dev/null; }
command -v tmux >/dev/null && command -v node >/dev/null || { echo "tmux/node missing — run: bash $ROOT/skills/install/scripts/install.sh" >&2; exit 1; }
[ -f "$ROOT/server.js" ] || { echo "server.js not found under $ROOT" >&2; exit 1; }
[ -d "$ROOT/node_modules/@tykimos/noderel" ] || { say "Installing npm dependencies"; (cd "$ROOT" && npm install --no-audit --no-fund --silent); }

# run.sh가 띄운 세션은 ANA_PORT를 기록해 둔다. 손으로 띄운 세션이면 서버 시작 로그(ANA → http://host:port)에서 읽는다.
port_of() {
  local p; p=$(tmux show-environment -t "$SRV" ANA_PORT 2>/dev/null | cut -d= -f2 || true)
  [ -n "$p" ] || p=$(tmux capture-pane -p -S -200 -t "$SRV" 2>/dev/null | grep -o 'ANA → http://[^ ]*' | tail -1 | sed 's/.*://' || true)
  echo "$p"
}

status() {
  alive "$S" && say "agent  : tmux '$S' (attach: tmux attach -t $S)" || say "agent  : not running"
  if alive "$SRV"; then
    P=$(port_of); say "server : tmux '$SRV' → http://localhost:${P:-?}"
    [ -n "$P" ] && curl -fsS -o /dev/null "http://127.0.0.1:$P/" && say "health : HTTP 200" || say "health : not responding yet (tmux attach -t $SRV to see logs)"
  else say "server : not running"; fi
}

start() {
  if ! alive "$S"; then
    command -v "${AGENT_CMD%% *}" >/dev/null || { echo "agent CLI '$AGENT_CMD' not found — install it or set AGENT_CMD" >&2; exit 1; }
    tmux new-session -d -s "$S" -c "$ROOT" -x 200 -y 50
    tmux send-keys -t "$S" "$AGENT_CMD" Enter
    say "started agent in tmux '$S' ($AGENT_CMD)"
  else say "agent tmux '$S' already running — reusing"; fi

  if ! alive "$SRV"; then
    P=${PORT:-8809}; while busy "$P"; do P=$((P + 1)); done
    tmux new-session -d -s "$SRV" -c "$ROOT"
    tmux set-environment -t "$SRV" ANA_PORT "$P"
    tmux send-keys -t "$SRV" "PORT=$P BIND=$BIND TMUX_SESSION=$S node server.js" Enter
    for _ in $(seq 1 20); do curl -fsS -o /dev/null "http://127.0.0.1:$P/" 2>/dev/null && break; sleep 0.5; done
    say "started server in tmux '$SRV' on port $P"
  else say "server tmux '$SRV' already running — reusing"; fi
  echo; status
  echo
  say "Open http://localhost:$(port_of) in a browser (on Windows, the Windows browser reaches WSL's localhost)."
  say "First run? tmux attach -t $S → finish the Claude login / trust prompt → detach with Ctrl-b d"
}

stop() {
  alive "$SRV" && tmux kill-session -t "$SRV" && say "stopped server '$SRV'"
  alive "$S" && tmux kill-session -t "$S" && say "stopped agent '$S'"
  return 0
}

case "${1:-start}" in
  start) start ;; stop) stop ;; status) status ;;
  restart) stop; start ;;
  *) echo "usage: run.sh [start|stop|status|restart]" >&2; exit 2 ;;
esac
