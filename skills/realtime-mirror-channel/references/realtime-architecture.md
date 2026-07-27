# 실시간 미러 채널 — 아키텍처 상세

ANA 앱의 채팅 패널과 Claude Code 세션을 **fakechat 채널**로 잇는 **양방향 실시간** 구조. 이 문서는 그 실시간 경로의 상세와 함정을 다룬다.

> ⚠️ 이 빌딩블록에는 **텔레그램·외부 자격증명이 전혀 없다.** fakechat은 로컬 WS(예 `:8798`)로만 동작하며 별도 인증이 필요 없다. 앱 토큰(`APP_TOKEN`)은 실행 시 `secrets.env`에서 읽고 코드엔 값이 없다.

---

## 1. 전체 흐름 (양방향)

```
 [ANA 앱 브라우저 :8791]
   │ 사용자가 채팅 전송
   ▼
 POST /api/chat {text, chips}  ── 앱 서버: 피드에 user 추가 + inbox.push
   │
   ▼ (studio-bridge 롱폴)
 GET /api/inbox-wait  ──►  bridge  ──ws.send({id, text})──►  [fakechat 서버 :8798 /ws]
                                                                  │ deliver → MCP notification
                                                                  ▼
                                                    [Claude 세션]  <channel source="plugin:fakechat:fakechat">
                                                                  │ 두뇌가 작업 수행 + 응답
                            ┌──────────────── 아웃바운드(두 경로 중 하나) ───────────────┐
                            │ (a) 그냥 텍스트로 답 → 미러 훅이 /api/activity 로 게시       │
                            │ (b) fakechat reply 도구 → 서버가 broadcast → bridge가 미러  │
                            ▼                                                            ▼
                     mirror-hook.mjs                                        studio-bridge ws.onmessage
                     (UserPromptSubmit/PostToolUse/Stop)                    ({type:'msg',from:'assistant'})
                            │                                                            │
                            └────────────► POST /api/activity ◄───────── POST /api/agent ┘
                                                   │
                                                   ▼
                                        [앱 피드 폴링 → 화면 표시]
```

> 포트(`:8791` 앱, `:8798` fakechat)는 **예시**다. 세션마다 다른 fakechat 포트를 쓴다(§4).

---

## 2. 인바운드 (앱 → 세션)

1. 프론트가 `POST /api/chat {text, chips}` → 앱 서버가 피드에 `role:user` 추가하고 `inbox`에 push.
2. `studio-bridge.mjs`가 `GET /api/inbox-wait`(≤25s 롱폴)로 새 인바운드 1건을 받는다.
3. 브리지가 fakechat WS(`ws://127.0.0.1:<FAKECHAT_WS>/ws`)로 주입한다.

### ★ 치명 포인트 — fakechat WS 입력 포맷은 반드시 `{id, text}`

fakechat 서버의 WS 메시지 핸들러는 사실상 이렇다:

```js
const { id, text } = JSON.parse(raw);
if (id && text?.trim()) deliver(id, text);
```

즉 **`id`가 없으면(falsy) 메시지를 조용히 버린다.** 에러도, 로그도 없다.

- 잘못된 예(전형적 초기 버그): `ws.send({ type:'user', text, tag })` → `id` 없음 → **드롭 → 세션 무응답**.
- 올바른 예: `ws.send(JSON.stringify({ id: 'studio-' + (++seq), text }))` → `deliver` → 세션에 `<channel source="plugin:fakechat:fakechat" message_id="studio-N">` 로 도착.

세션에 도착한 채널 메시지 텍스트에는 칩(어떤 화면/요소를 가리키는지 + 상세 위치정보)과 지시가 담긴다(브리지 `toText()`가 구성). 칩 스키마는 앱 도메인에 맞춰 필드만 바꾸고 구조는 유지한다.

---

## 3. 아웃바운드 (세션 → 앱)

fakechat 서버는 세션이 **reply MCP 도구**로 답하면 `broadcast({type:'msg', id, from:'assistant', text, ts})` 를 연결된 모든 WS 클라이언트(브리지 포함)에 보낸다. 세션이 **일반 텍스트로 답하면** 그건 트랜스크립트의 assistant 텍스트 블록이 될 뿐 앱으로 흘러가지 않는다. 이 둘을 각각 앱으로 되돌리는 두 경로:

### (a) 미러 훅 경로 (권장·범용) — `mirror-hook.mjs`

- **`UserPromptSubmit`**: 사용자 입력(로컬/원격/모바일 등)을 `role:user, kind:text`로 `/api/activity` 게시.
  - **fakechat 인바운드는 스킵** — 이미 `/api/chat`이 피드에 넣었으므로 중복 방지.
  - 채널 래퍼(`<channel …>…</channel>`)면 내부 텍스트만 추출.
  - 첨부 이미지(`image_path="…"`, `@"….png"`)는 `att/`로 복사해 마크다운 이미지로 첨부.
  - 첫 입력 즉시 `/api/status {처리 중…}` → 앱에 "작성 중" 표시.
- **`PostToolUse`**: 도구 활동 한 줄(`role:system, kind:activity`) + 직전까지의 새 어시스턴트 텍스트 블록(`role:assistant, kind:text`).
- **`Stop`**: 마지막 어시스턴트 텍스트 flush + status 클리어.
- **안전장치 3종**:
  - **소유권 가드** — `j.cwd`가 이 앱의 디렉터리 패턴(`OWN_DIR_RE`)일 때만 게시. 없으면 다른 폴더 세션 활동이 남의 앱 피드에 섞인다.
  - **턴당 sent 카운트 dedup** — `/tmp` 상태 파일에 `{turnStart, sent}`를 두고 이미 보낸 블록 수만큼 건너뛴다. 없으면 `PostToolUse`마다 같은 텍스트를 재게시한다.
  - **내부 턴 스킵** — 하트비트/크론/시스템 알림 프롬프트는 미러하지 않는다.
- **결과**: 세션이 특별한 도구 없이 **그냥 답만 해도** 앱 화면에 원격조종과 동일하게 보인다.

### (b) 브리지 broadcast 미러 경로 — `studio-bridge.mjs`의 `ws.onmessage`

- fakechat broadcast 중 `{type:'msg', from:'assistant', text}`를 받으면 `POST /api/agent {text}`로 앱 피드에 전달.
- 세션이 fakechat **reply 도구**로 답할 때 이 경로로 앱에 표시된다.

> **이중 게시 걱정 없음**: reply 도구의 텍스트는 assistant *텍스트 블록*이 아니라 *도구 입력*이므로 미러 훅의 수집 대상과 겹치지 않는다. 두 경로를 동시에 켜도 안전하다.
>
> 권장: 세션은 **그냥 텍스트로 답**(미러 훅이 표시). reply 도구는 선택.

---

## 4. 포트 격리

- 이 세션의 fakechat WS 포트는 다른 세션과 **겹치면 안 된다**(예: 이 세션 8798, 다른 비서 세션 8787). 겹치면 메시지가 엉뚱한 세션으로 배달된다.
- 브리지는 `FAKECHAT_WS`, 세션 기동은 `FAKECHAT_PORT`로 지정한다.
- 기동 전 고아 프로세스 정리:
  ```bash
  lsof -iTCP:8798 -sTCP:LISTEN
  ```

## 5. 활성 조건

- 인바운드 수신은 **세션이 fakechat 채널로 떠 있어야** 가능하다:
  ```bash
  claude --channels plugin:fakechat@claude-plugins-official
  ```
- **여러 채널을 동시에 붙이려면 하나의 `--channels`에 공백으로 나열**한다. 플래그를 두 번 주면 **뒤가 앞을 덮어써** 앞 채널이 사라진다.
  ```bash
  claude --channels "plugin:fakechat@claude-plugins-official plugin:other@…"   # ✅
  claude --channels plugin:fakechat@… --channels plugin:other@…                # ❌ 앞이 사라짐
  ```
- fakechat 플러그인 설치는 로컬 터미널에서: `/plugin install fakechat@claude-plugins-official`

## 6. 함정

| 증상 | 원인 | 조치 |
|---|---|---|
| 채팅을 보내도 세션이 아무 반응 없음 | WS 페이로드에 **`id` 누락** → 서버가 조용히 드롭 | `{id, text}` 형식 확인(§2) |
| 브리지 로그는 정상인데 세션 무응답 | **채널 미연결** — 세션이 fakechat 채널 없이 떠 있음 | `--channels`로 세션 재기동(§5) |
| 다른 프로젝트 대화가 앱 피드에 섞임 | 미러 훅 **소유권 가드 없음** | `OWN_DIR_RE`로 cwd 제한 |
| 같은 답변이 여러 번 게시됨 | 미러 훅 **dedup 없음** | 턴당 `sent` 카운트 상태 유지 |
| 앱 서버 재기동 후 피드가 멈춤(스테일) | 프론트가 옛 `lastMsg` id로 폴링 → 새로 낮아진 id를 놓침 | 서버가 부팅 에폭 `sync` 값을 함께 주고, 프론트가 변경 감지 시 `lastMsg` 초기화 |
| 다른 세션이 내 메시지를 받음 | fakechat 포트 충돌 | 세션별 포트 분리(§4) |

## 7. 파일

- `studio-bridge.mjs` — 인바운드 릴레이(`/api/inbox-wait` → fakechat `{id,text}`) + 아웃바운드 미러(broadcast → `/api/agent`). 의존성 0(Node 22 전역 `WebSocket`/`fetch`).
- `mirror-hook.mjs` — 미러 훅(UserPromptSubmit/PostToolUse/Stop → `/api/activity`). 소유권 가드·dedup·내부 스킵·첨부 이미지 `att/` 복사 포함.

> 두 파일 모두 텔레그램·외부 자격증명 없음. 앱 토큰은 `secrets.env`에서 읽으며 코드에 값이 들어가지 않는다.
