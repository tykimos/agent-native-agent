/* =========================================================================
   fakechat 인바운드 릴레이 — 대시보드 채팅 → fakechat 채널 → Claude 세션
   ------------------------------------------------------------------------
   역할(인바운드 전용):
     대시보드에서 보낸 채팅(/api/chat → inbox)을 fakechat WS 로 밀어넣어
     Claude Code 세션에 채널 메시지로 자동 푸시한다.
   응답은 두뇌(Claude)가 직접 POST /api/agent 로 보낸다(제안/승인 등 리치 UX 유지).
   의존성 0 — Node 22 내장 fetch / 전역 WebSocket.

   실행:  node fakechat-bridge.js
   환경변수: DASH_URL(기본 http://127.0.0.1:8777), FAKECHAT_WS(기본 ws://127.0.0.1:8787/ws),
            TAG(채널에 붙는 접두 라벨, 기본 "대시보드")
   ========================================================================= */
const DASH = process.env.DASH_URL || "http://127.0.0.1:8777";
const FC_WS = process.env.FAKECHAT_WS || "ws://127.0.0.1:8787/ws";
const TAG = process.env.TAG || "대시보드";

const forwarded = new Set();   // 이미 채널로 넘긴 reqId (중복 방지)
let ws = null, wsReady = false;

function log() { console.log("[bridge]", ...arguments); }

/* ---- fakechat WS 연결(자동 재접속) ---- */
function connectWS() {
  try { ws = new WebSocket(FC_WS); }
  catch (e) { log("ws ctor 실패, 2s 후 재시도:", e.message); return setTimeout(connectWS, 2000); }
  ws.addEventListener("open", function () { wsReady = true; log("fakechat 연결됨:", FC_WS); });
  ws.addEventListener("close", function () { wsReady = false; log("fakechat 끊김, 2s 후 재접속"); setTimeout(connectWS, 2000); });
  ws.addEventListener("error", function () { /* close 가 뒤따름 */ });
}

/* fakechat 의 user 메시지로 주입 → Claude 세션에 채널 알림 도착 (채널 UI 로 echo 안 됨) */
function pushToChannel(reqId, text) {
  if (!wsReady) return false;
  ws.send(JSON.stringify({ id: "dash-" + reqId, text: "[" + TAG + " #" + reqId + "] " + text }));
  return true;
}

/* ---- 대시보드 인박스 롱폴 루프 ---- */
async function inboxLoop() {
  for (;;) {
    let pend = [];
    try {
      const r = await fetch(DASH + "/api/inbox-wait", { signal: AbortSignal.timeout(30000) });
      const j = await r.json();
      pend = Array.isArray(j.requests) ? j.requests : [];
    } catch (e) {
      await sleep(1500);   // 타임아웃/서버 미기동 → 잠깐 쉬고 재시도
      continue;
    }
    let sent = 0;
    for (const req of pend) {
      if (forwarded.has(req.id)) continue;
      if (pushToChannel(req.id, req.text)) { forwarded.add(req.id); sent++; log("→ fakechat #" + req.id + ":", req.text); }
    }
    if (sent === 0 && pend.length) await sleep(1500);   // 미답변 요청 잔류 시 핫루프 방지
  }
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---- 시작 ---- */
connectWS();
inboxLoop();
log("기동: DASH=" + DASH + "  FAKECHAT=" + FC_WS + "  TAG=" + TAG);
