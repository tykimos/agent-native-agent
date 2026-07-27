#!/bin/bash
# 콘텐츠 스튜디오 전용 Cloudflare quick tunnel (launchd 관리).
# *.trycloudflare.com URL을 잡아 studio-url.txt 에, 토큰 포함 링크를 studio-link.txt 에 저장.
# 보안: 스튜디오 서버는 STUDIO_TOKEN 게이트 → 링크에 ?token= 를 붙여 노출.
#      (링크 파일은 토큰을 포함하므로 저장소에 커밋하지 말 것.)
set -uo pipefail
# ▼▼ 프로젝트별 설정(원본 키트는 config 디렉터리·포트가 하드코딩이었다) ▼▼
CFG=${STUDIO_CONFIG_DIR:-"$HOME/.config/content-studio"}
PORT=${STUDIO_PORT:-8791}
# ▲▲ 프로젝트별 설정 끝 ▲▲
ENV="$CFG/secrets.env"
LOG="$CFG/studio-tunnel.log"
URLFILE="$CFG/studio-url.txt"      # 순수 origin (예: https://xxx.trycloudflare.com)
LINKFILE="$CFG/studio-link.txt"    # 토큰 포함 완전 링크

TOKEN=$(grep -E '^STUDIO_TOKEN=' "$ENV" | cut -d= -f2-)


: > "$LOG"
cloudflared tunnel --url "http://localhost:${PORT}" --no-autoupdate >> "$LOG" 2>&1 &
CF_PID=$!

URL=""
for i in $(seq 1 40); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1)
  [ -n "$URL" ] && break
  sleep 1
done

PREV=$(cat "$URLFILE" 2>/dev/null || echo "")
if [ -n "$URL" ]; then
  echo "$URL" > "$URLFILE"
  LINK="$URL"
  [ -n "$TOKEN" ] && LINK="${URL}/?token=${TOKEN}"
  echo "$LINK" > "$LINKFILE"
fi

wait "$CF_PID"
