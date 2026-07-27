#!/bin/zsh
# 콘텐츠 스튜디오 상시 구동 — 서버 + 인바운드 브리지(의존성 0, Node 내장)
# 세션 fakechat 은 격리 포트를 쓴다(다른 ANA 세션의 8787 과 충돌 방지).
# ▼▼ 프로젝트별 설정(원본 키트는 프로젝트 경로·config 디렉터리가 하드코딩이었다) ▼▼
cd "$(dirname "$0")/.." || exit 1                            # 프로젝트 루트(= studio/ 의 상위)
export STUDIO_PORT=${STUDIO_PORT:-8791}
export FAKECHAT_WS=${FAKECHAT_WS:-ws://127.0.0.1:8798/ws}
export STUDIO_DOC=${STUDIO_DOC:-"$PWD/docs/document.html"}   # 렌더된 문서 HTML
export STUDIO_DOC_ROUTE=${STUDIO_DOC_ROUTE:-/document.html}  # studio.js 의 DOC_URL 과 동일
CFG=${STUDIO_CONFIG_DIR:-"$HOME/.config/content-studio"}     # secrets.env·로그·터널 URL 보관
NODE=${NODE_BIN:-/opt/homebrew/bin/node}
# ▲▲ 프로젝트별 설정 끝 ▲▲

# 접근 토큰(있으면 URL 에 ?token= 로): secrets.env 의 STUDIO_TOKEN — 값은 저장소에 두지 않는다
export STUDIO_TOKEN=$(grep '^STUDIO_TOKEN=' "$CFG/secrets.env" 2>/dev/null | cut -d= -f2-)

# 기존 인스턴스 정리
pkill -f "studio/studio-server.mjs" 2>/dev/null
pkill -f "studio/studio-bridge.mjs" 2>/dev/null
sleep 0.5

"$NODE" studio/studio-server.mjs &
SRV=$!
sleep 1
# studio-bridge.mjs 는 realtime-mirror-channel 빌딩블록이 제공한다(여기 중복 배치하지 않음).
"$NODE" studio/studio-bridge.mjs &
BR=$!
echo "studio-server pid=$SRV  bridge pid=$BR  (:$STUDIO_PORT, fakechat $FAKECHAT_WS)"
wait
