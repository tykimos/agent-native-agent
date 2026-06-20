# fakechat 대시보드 에이전트 — 아키텍처 상세

## 데이터 흐름

```
사용자(브라우저)
  │  ① 채팅 입력
  ▼
대시보드 서버 :PORT  ── POST /api/chat ──►  inbox 요청 큐(status:new) + 피드에 user 메시지
  ▲                                              │
  │                                              │ ② 릴레이가 /api/inbox-wait 롱폴로 수신
  │                                              ▼
  │                                   fakechat-bridge.js  ── ws.send({id:"dash-N", text}) ──►
  │                                              │
  │                                              ▼
  │                                   fakechat WS :8787  ── notifications/claude/channel ──►
  │                                              │
  │                                              ▼
  │                                   Claude Code 세션 (두뇌)
  │                                     · 채널 메시지 <channel source="fakechat" message_id="dash-N">
  │                                     · GET /api/state 로 대시보드 데이터 조회
  │                                     · 작업 수행 / 변경안 작성
  │                                              │
  │  ④ 대시보드에 표시(SSE+폴링 수신)             │ ③ POST /api/agent { reqId:N, text 또는 diff }
  └──────────────────────────────────────────────┘
         리치 응답: 텍스트 답변 또는 "전/후 미리보기 + 승인/거절" 제안 카드
                          │ 사용자가 승인 → POST /api/approve → 서버가 적용(version++) → 전원 동기화
```

## 시퀀스 (조회 vs 변경)

**조회** "오늘 매출 어때?"
1. /api/chat → inbox → 릴레이 → 채널 → Claude
2. Claude가 /api/state 읽고 → POST /api/agent { reqId, text:"오늘 매출 …" }
3. 대시보드 피드에 답변 표시

**변경** "민준 7시 영어학원 추가"
1~2. 위와 동일하게 Claude 도달
3. Claude가 POST /api/agent { reqId, diff:{ add:[{...}] }, text:"이렇게 추가할까요?" }
4. 대시보드에 **제안 카드(전/후 미리보기)** 표시
5. 사용자가 승인 → POST /api/approve → 서버 applyDiff + version++ → 모든 접속자 자동 반영

## 핵심 설계 결정 (왜 이렇게)

1. **인바운드만 릴레이, 응답은 항상 `/api/agent`**
   - 채널(fakechat)은 "Claude 세션으로의 확실한 푸시 배달"만 담당.
   - 응답을 채널 텍스트로 보내면 diff/승인 같은 리치 구조를 못 싣는다. 그래서 응답은 대시보드 API로.
   - fakechat 의 user 주입은 채널 UI 로 echo 되지 않아 중복도 없다.

2. **version 기반 동기화 (폴링 필수)**
   - 상태 변경마다 `version++`. 프론트는 `/api/feed` 응답의 version 으로 데이터 변화를 감지해 재요청.
   - **SSE만 믿지 말 것**: cloudflared 등 터널이 `text/event-stream` 을 버퍼링해 이벤트가 안 흘러올 수 있다. 2.5초 폴링을 항상 함께 돌리고, 수신부는 메시지 id 로 중복을 무시한다.

3. **상태는 서버 저장(공유)**
   - 완료/토글을 localStorage 에 두면 기기마다 달라진다. 서버에 저장해야 전원에게 반영.

4. **재렌더 시 스크롤 보존**
   - 폴링 동기화로 대시보드를 다시 그릴 때 스크롤 위치를 저장/복원해 UX 가 튀지 않게 한다.

## 메시지/요청 상태 머신
- 요청(request): `new → proposed → applied|rejected` (또는 조회는 `new → done`)
- 메시지(message.kind): `text` | `proposal`(status: pending→applied|rejected) | `applied`(시스템) | `info`

## 프론트엔드 수신 로직(요지)
```js
// SSE(저지연) + 폴링(안전망) 동시 가동. onIncoming 이 id 로 중복 무시.
function startRealtime() {
  if (window.EventSource) {
    const es = new EventSource("/api/stream?since=" + lastId);
    es.onmessage = e => { try { onIncoming([JSON.parse(e.data)]); } catch (_) {} };
  }
  setInterval(async () => {
    const r = await fetch("/api/feed?since=" + lastId).then(x => x.json());
    onIncoming(r.messages);
    if (r.version > dataVer) { dataVer = r.version; refreshState(); } // 데이터 동기화
  }, 2500);
}
```

## 보안/운영 체크리스트
- [ ] 무인증 공개 시 민감 데이터 노출 주의(필요하면 비밀번호 게이트)
- [ ] 터널 URL은 임시(무료 퀵터널) — 고정 필요 시 named tunnel
- [ ] 자동 응답은 Claude 세션 + 릴레이 + 서버 (+터널)이 모두 떠 있을 때만
- [ ] 단일 채팅방·발신자 미구분 — 다중 사용자면 이름/세션 분리 고려
- [ ] 동시 수정은 last-write-wins(잠금 없음)
