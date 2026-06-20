---
name: fakechat-dashboard-agent
description: Build a "dashboard agent" — a web dashboard the user watches while chatting to a Claude Code session, with chat routed through the fakechat channel. Unlike pure chat remote-control, the user sees key live data (schedule, metrics, orders, queues) on screen AND converses in the same view; Claude reads the dashboard's data API and replies with rich proposals the user approves. Use when the user wants a visual dashboard plus chat, a "fakechat dashboard", an agent that controls/answers about a web app, or "채팅만 말고 화면 보면서" operating an app.
---

# fakechat 대시보드 에이전트 스킬

순수 채팅 원격 조종(remote control)은 상태를 **글로만** 주고받는다. 이 스킬은 **외부 웹 대시보드 + 채팅**을 결합해, 사용자가 **주요 지표/일정을 눈으로 보면서** Claude Code 세션과 대화하게 만든다. fakechat 채널을 "확실한 푸시 배달부"로 쓰고, 대시보드는 시각적 맥락과 리치 응답(제안→승인)을 담당한다.

## 왜 이게 더 나은가 (핵심 가치)
- **시각 맥락 + 대화 동시**: "오늘 일정 보여줘" 대신, 화면에 일정이 보이고 그 위에서 "민준 7시 영어 추가"라고 말한다.
- **리치 응답**: 변경은 채팅 텍스트가 아니라 대시보드의 **전/후 미리보기 + 승인 카드**로 받는다.
- **확실한 인바운드**: fakechat 채널이 메시지를 Claude 세션에 **자동 푸시**(폴링 루프/수동 호출 불필요).

## 아키텍처 (4요소)
```
[웹 대시보드 :PORT]  ──사용자 채팅──►  /api/chat ──► inbox(요청 큐)
        ▲                                              │
        │ /api/stream(SSE)+폴링                        │ 인바운드 릴레이가 /api/inbox-wait 롱폴
        │ (대시보드 데이터+피드)                         │ → ws.send → fakechat 채널
        │                                              ▼
        │                                    fakechat WS :8787 ──notification──► Claude 세션(두뇌)
        └──────── POST /api/agent (리치 응답: 텍스트/제안) ◄───────── 답변/제안
```
1. **대시보드 서버** (`references/server.js`): 정적 대시보드 서빙 + 채팅 브리지 API(인박스/피드/제안/승인) + 데이터 상태(JSON 파일). 의존성 0(Node 내장).
2. **인바운드 릴레이** (`references/fakechat-bridge.js`): 대시보드의 새 채팅 요청을 fakechat WS로 밀어넣어 Claude 세션에 자동 도착시킴. (의존성 0, Node 22 전역 `fetch`/`WebSocket`.)
3. **fakechat 채널**: 메시지를 Claude 세션에 `<channel source="fakechat">`로 푸시, Claude는 `reply` 또는(권장) 대시보드 API로 응답.
4. **Claude 세션(두뇌)**: 채널 메시지를 받아 데이터 API를 읽고, `POST /api/agent`로 **리치 응답**(텍스트 또는 diff 제안)을 보낸다 → 대시보드에 표시.

> 설계 포인트: **인바운드만 릴레이**로 보내고 **응답은 항상 `/api/agent`**로 보낸다. 그래야 제안/승인 카드 같은 리치 UX가 유지되고 채널은 "푸시 배달"만 담당한다. fakechat의 user 주입은 채널 UI로 echo되지 않아 중복도 없다.

## 데이터 동기화 (여러 기기/탭)
- 상태 파일에 **`version`**을 두고 변경마다 +1.
- 대시보드는 `/api/feed`(또는 별도 엔드포인트) 응답에 `version`을 함께 받아, **2.5초 폴링**으로 버전 변화 감지 시 데이터 재요청. → 모든 접속자 자동 동기화.
- 완료/토글 등 사용자 액션은 **localStorage가 아니라 서버에 저장**해야 전원에게 반영된다.
- SSE는 저지연이지만 **cloudflared 등 터널이 `text/event-stream`을 버퍼링**하므로, **폴링을 항상 함께 가동**한다(SSE만 믿지 말 것). 수신부는 메시지 id로 중복 무시.

## 구축 절차
1. **데이터 모델 결정**: 대시보드가 보여줄 핵심 엔티티 + `version` 필드. JSON 파일로 시작.
2. **서버**: `references/server.js`를 복사해 데이터 스키마/엔드포인트를 맞춘다. 핵심 API:
   - `GET /api/state` (대시보드 데이터), `GET /api/feed?since=` (채팅 피드 + version)
   - `POST /api/chat` (사용자 요청 → inbox), `GET /api/inbox-wait` (릴레이 롱폴)
   - `POST /api/agent` (Claude의 리치 응답), `POST /api/approve` (제안 승인/거절)
   - 데이터 변경 엔드포인트(예: `POST /api/apply`, `POST /api/done`) — version++ 필수
3. **대시보드 프론트**: 데이터 카드/표 + 하단 채팅(피드 표시, SSE+폴링 수신, version 동기화). 음성 입력·키보드 맞춤은 `uxui-design-system` 스킬 참고.
4. **릴레이 실행**: `node fakechat-bridge.js` (백그라운드). fakechat MCP(채널)가 이 Claude 세션에 붙어 있어야 함.
5. **두뇌 역할(런타임)**: 채널로 들어온 요청을 읽고 → 데이터 API 조회 → `POST /api/agent`로 응답/제안. 변경은 사용자가 승인하면 서버가 적용(version++).
6. **외부 공개(선택)**: `cloudflared tunnel --url http://localhost:PORT`로 임시 URL. 무인증이므로 가족/팀 외 공유 주의(필요시 비밀번호 게이트).

## 운영 시 알아둘 점
- **세션 의존**: 자동 응답은 Claude 세션 + 릴레이 + 서버 + (공개 시) 터널이 모두 떠 있을 때만.
- **단일 채팅방**: 모든 접속자가 같은 피드를 공유하고 메시지에 발신자 구분이 없다 → 필요하면 이름 입력/세션 분리 추가.
- **동시 수정**: 잠금 없음(last-write-wins). 소규모 팀엔 충분, 충돌 드묾.
- **터널 URL은 임시**: 무료 퀵터널은 재시작마다 주소 변경. 고정 필요 시 named tunnel.

## 참고 파일
- [`references/server.js`](references/server.js) — 대시보드+브리지 서버 템플릿(의존성 0)
- [`references/fakechat-bridge.js`](references/fakechat-bridge.js) — 인바운드 릴레이 템플릿
- [`references/architecture.md`](references/architecture.md) — 구성요소·기술스택·MCP채널·데이터 흐름·시퀀스 상세
- [`references/example-deployment.md`](references/example-deployment.md) — 실제 적용 사례(가족 주간 계획표): 구성도·기술스택·왕복 흐름
