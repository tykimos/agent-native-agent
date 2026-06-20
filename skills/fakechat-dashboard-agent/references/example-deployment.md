# 예시 배포 사례 — 웹페이지 채팅 ↔ Claude 연결

> `fakechat-dashboard-agent` 스킬을 실제로 적용한 **구체 인스턴스**(가족 주간 계획표) 기록입니다.
> 일반화된 설계는 [`architecture.md`](architecture.md)를, 템플릿은 [`server.js`](server.js)·[`fakechat-bridge.js`](fakechat-bridge.js)를 참고하세요.
> 여기서는 실제 포트(`:8777`/`:8787`), 메시지 id 규칙(`sched-N`), 데이터 파일(`schedule.json`)이 그대로 나옵니다.

이 문서는 **우리집 주간 계획표** 웹페이지에서 "채팅하기"로 입력한 메시지가 어떻게 **Claude Code 세션(두뇌)** 까지 도달하고, 답변이 다시 화면으로 돌아오는지를 설명합니다.

> 한 줄 요약: 브라우저 채팅 → 브리지 서버(요청 큐) → **인바운드 릴레이** → **fakechat MCP 채널** → **Claude 세션**. 답변은 Claude가 **서버 API로 직접** 보내 화면에 표시. 즉 "채팅만 원격조종"이 아니라 **대시보드를 보면서 대화**하는 구조.

---

## 1. 핵심 원리 (왜 이렇게 만들었나)

1. **채널은 '확실한 푸시 배달부'로만 쓴다.**
   브라우저가 보낸 메시지를 Claude 세션으로 **자동으로 밀어 넣는** 역할은 `fakechat`이라는 MCP 채널이 담당한다. 덕분에 Claude가 폴링 루프를 돌거나 수동으로 확인할 필요가 없다.

2. **응답은 채널이 아니라 대시보드 API로 보낸다.**
   채널 텍스트로 답하면 "전/후 미리보기 + 승인" 같은 **리치 UI**를 실을 수 없다. 그래서 인바운드(사용자→Claude)만 채널로 받고, 아웃바운드(Claude→사용자)는 서버의 `/api/agent`로 보낸다.

3. **보면서 대화한다.**
   화면엔 일정 격자(시간×요일×4명)가 떠 있고, 그 위에서 "민준 7시 영어 추가"처럼 말하면 변경이 **승인 카드**로 와서 누르면 반영된다. 변경은 `version`이 올라가고 모든 기기가 폴링으로 동기화된다.

---

## 2. 구성 요소 (5개 + 터널)

| # | 구성 요소 | 파일 / 실행 | 역할 | 포트 |
|---|---|---|---|---|
| ① | **웹 대시보드(브라우저)** | `index.html` / `app.js` / `styles.css` | 일정 격자 + 채팅 UI. 입력 전송·피드 수신 | — |
| ② | **브리지 서버** | `server.js` (Node, 의존성 0) | 정적 서빙 + 채팅 인박스/피드/제안/승인 API + 데이터(`schedule.json`) | **8777** |
| ③ | **인바운드 릴레이** | `bridge/fakechat-bridge.js` (Node 22) | 새 채팅 요청을 fakechat 채널로 주입 | — |
| ④ | **fakechat MCP 채널** | `server.ts` (Bun + MCP SDK) | WS 메시지를 MCP 알림으로 Claude 세션에 푸시 | **8787** |
| ⑤ | **Claude Code 세션(두뇌)** | (이 세션) | 채널 메시지 수신 → 데이터 조회 → 리치 응답 게시 | — |
| ⑥ | **cloudflared 터널** | `cloudflared` | 외부 공개 URL(`*.trycloudflare.com`) | — |

---

## 3. 구성도

```
                                 ┌───────────────────────────── 외부(휴대폰/PC) ─────────────────────────────┐
                                 │                                                                          │
                         https://*.trycloudflare.com                                                        │
                                 │                                                                          │
                          ⑥ cloudflared 터널                                                                 │
                                 │                                                                          │
   ┌─────────────────────────────┼──────────────────────────────────────────────────────────────────────┐ │
   │ localhost                    ▼                                                                        │ │
   │                    ① 웹 대시보드(브라우저)                                                              │ │
   │                    · 일정 격자 + 채팅 UI                                                                │ │
   │            ┌──────────────┬───────────────────────────┐                                              │ │
   │   ① 전송   │ POST         │            ④ 수신          │ GET /api/stream(SSE)                          │ │
   │   /api/chat│              │            /api/feed(폴링 2.5s, +version)                                  │ │
   │            ▼              │                            ▲                                              │ │
   │   ┌──────────────────────┴────────────────────────────┴──────────┐                                  │ │
   │   │ ② 브리지 서버 (server.js, :8777)                               │                                  │ │
   │   │   · inbox(요청 큐)  · feed(메시지)  · schedule.json(+version)   │                                  │ │
   │   │   · /api/inbox-wait(롱폴)  · /api/agent  · /api/approve         │                                  │ │
   │   └─────────────┬───────────────────────────────▲──────────────────┘                                │ │
   │                 │ ② GET /api/inbox-wait (롱폴)    │ ⑤ POST /api/agent (리치 응답: 텍스트/제안)          │ │
   │                 ▼                                │                                                   │ │
   │   ┌──────────────────────────────┐              │                                                   │ │
   │   │ ③ 인바운드 릴레이              │              │                                                   │ │
   │   │   fakechat-bridge.js          │              │                                                   │ │
   │   │   ws.send({id:"sched-N",text})│              │                                                   │ │
   │   └──────────────┬───────────────┘              │                                                   │ │
   │                  │ ③ WebSocket (ws://…:8787/ws)  │                                                   │ │
   │                  ▼                              │                                                   │ │
   │   ┌──────────────────────────────┐              │                                                   │ │
   │   │ ④ fakechat MCP 채널 (:8787)    │              │                                                   │ │
   │   │   deliver() → mcp.notification│              │                                                   │ │
   │   └──────────────┬───────────────┘              │                                                   │ │
   │                  │ ④ notifications/claude/channel (MCP, stdio)                                       │ │
   │                  ▼                              │                                                   │ │
   │   ┌──────────────────────────────────────────────┴──────────────┐                                  │ │
   │   │ ⑤ Claude Code 세션 (두뇌)                                      │                                  │ │
   │   │   <channel source="fakechat" message_id="sched-N"> 수신       │                                  │ │
   │   │   → GET /api/schedule 조회 → 작업 → POST /api/agent 로 응답     │                                  │ │
   │   └──────────────────────────────────────────────────────────────┘                                  │ │
   └───────────────────────────────────────────────────────────────────────────────────────────────────┘ │
                                                                                                            │
   ※ 인바운드(①→⑤)만 채널 경유, 아웃바운드(⑤→①)는 서버 API 경유 → 제안/승인 같은 리치 UX 유지              │
   └────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 메시지 왕복 흐름 (시퀀스)

### 조회 — 예: "오늘 일정은?"
1. 브라우저 → `POST /api/chat {text}` → 서버가 **요청 큐(inbox, status:new)** 에 추가 + 피드에 user 메시지 저장 + `wakeInbox()`로 대기 중인 롱폴 즉시 응답.
2. 릴레이가 `GET /api/inbox-wait`(롱폴)로 새 요청 수신 → `ws.send({id:"sched-N", text:"[가족계획표 #N] 오늘 일정은?"})` → fakechat WS.
3. fakechat 서버 `websocket.message` → `deliver()` → `mcp.notification("notifications/claude/channel")` → **Claude 세션에 `<channel source="fakechat" message_id="sched-N">` 도착**.
4. Claude가 `GET /api/schedule`로 데이터 읽고 답 작성 → `POST /api/agent {reqId:N, text:"오늘은 …"}`.
5. 서버가 피드에 assistant 메시지 추가 → 브라우저가 **SSE/폴링**으로 받아 화면 표시.

### 변경 — 예: "민준 목요일 7시 영어학원 추가"
3단계까지 동일. 4단계에서 Claude가 **diff 제안**을 보냄:
- `POST /api/agent {reqId:N, diff:{add:[{person:"minjun",day:"thu",start:"19:00",title:"영어학원",…}]}, text:"이렇게 추가할까요?"}`
- 브라우저에 **전/후 미리보기 + 승인/거절 카드** 표시.
- 사용자가 승인 → `POST /api/approve {msgId, decision:"approve"}` → 서버가 `applyDiff()` 적용 + **`version++`** → 모든 접속 기기가 폴링으로 자동 반영.

---

## 5. 기술 스택

| 계층 | 기술 |
|---|---|
| **프론트엔드** | 바닐라 JS / HTML / CSS (프레임워크 0), Pretendard 폰트, **EventSource(SSE)** + `fetch` 폴링, **Web Speech API**(음성 입력), **VisualViewport**(모바일 키보드 맞춤), `localStorage` |
| **브리지 서버** | **Node.js 내장 모듈만**(`http`/`fs`/`path`) — 의존성 0. 롱폴(long-poll)·SSE·JSON 파일 저장 |
| **인바운드 릴레이** | **Node.js 22** 전역 `fetch` + 전역 `WebSocket`(의존성 0), 롱폴 + 재접속 + 중복방지 Set |
| **채널** | **fakechat** = **Bun** + `@modelcontextprotocol/sdk`, WebSocket 서버, **MCP stdio transport** |
| **연결 프로토콜** | **MCP(Model Context Protocol)** — `notifications/claude/channel` 알림으로 세션에 푸시, `reply` 툴로 응답(이 앱은 응답을 서버 API로 보냄) |
| **데이터** | JSON 파일 — `data/schedule.json`(+version), `bridge/feed.json`(메시지·요청 큐) |
| **공개** | **cloudflared** 퀵터널(임시 URL) |

---

## 6. 핵심 설계 결정 (요지)

1. **인바운드만 릴레이, 응답은 `/api/agent`** — 채널은 푸시 배달만, 리치 응답(제안/승인)은 서버 API로.
2. **version 기반 폴링 동기화** — 상태 변경마다 `version++`, 프론트는 `/api/feed`의 version으로 데이터 변화를 감지해 재요청 → 모든 기기 동기화. (완료 체크도 서버 저장 → 공유)
3. **SSE + 폴링 병행** — cloudflared 등 터널이 `text/event-stream`을 버퍼링할 수 있어 **2.5초 폴링을 항상 함께** 가동, 수신부는 메시지 id로 중복 무시.
4. **채널 주입은 UI echo 없음** — 릴레이의 user 주입은 fakechat UI로 되울리지 않아 중복이 안 생김.

---

## 7. 동작 전제 / 한계

- **항상 떠 있어야 하는 것**: ② 서버(:8777) · ③ 릴레이 · ④ fakechat(:8787) · ⑤ Claude 세션 (+공개 시 ⑥ 터널). 하나라도 꺼지면 채팅 응답이 끊긴다.
- **세션 의존**: 자동 응답은 이 Claude 세션이 살아 있는 동안만.
- **단일 채팅방·발신자 미구분**: 모든 접속자가 같은 피드를 공유, 메시지에 누가 보냈는지 구분 없음.
- **무인증 + 동시수정 last-write-wins**: URL을 알면 접근 가능(필요 시 비밀번호 게이트), 잠금 없음.
- **터널 URL 임시**: 무료 퀵터널은 재시작 시 주소 변경(고정은 named tunnel 필요).

---

_관련 파일: `server.js`(브리지), `bridge/fakechat-bridge.js`(릴레이), `app.js`(프론트 수신/렌더), fakechat 플러그인 `server.ts`(채널). 이 문서는 현재 실제 배포 구성 기준._
