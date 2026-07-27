---
name: realtime-mirror-channel
description: "Wire TRUE two-way realtime between an ANA app and a Claude Code session — inbound relay (app chat → fakechat channel → session) PLUS session-activity mirroring (hooks → app feed), so the user sees the agent's replies, tool activity and status live on screen without any special reply tool. Use when the user wants '실시간 채팅', '세션 활동 미러', 'fakechat 실시간', '양방향 연결', '미러 훅', live activity feed, typing/status indicator, or reports that '대화가 화면에 안 떠', '앱에서 보낸 메시지에 세션이 반응을 안 해', '답변이 두 번 올라와', '다른 프로젝트 대화가 섞여'. Also triggers on follow-ups: '실시간 다시 붙여줘', '미러 훅 재실행', '실시간 보완/개선', '포트 겹쳐', '채널 두 개 붙여줘'. Extends the fakechat-dashboard-agent building block."
---

# 실시간 미러 채널 스킬 (realtime-mirror-channel)

`fakechat-dashboard-agent`가 깔아둔 기본 배선(대시보드 서버 + 인바운드 릴레이 + fakechat 채널)에 **실시간성과 가시성**을 얹는 빌딩블록이다. 두 가지를 보장한다:

1. **인바운드 릴레이** — 앱 채팅이 fakechat WS로 주입되어 Claude 세션에 **자동 도착**한다.
2. **세션 활동 미러링** — 세션이 무엇을 하고 있는지(사용자 입력·도구 활동·어시스턴트 답변·처리 상태)가 **훅으로 앱 피드에 실시간 게시**된다.

## 왜 이게 필요한가 (핵심 가치)

- **답이 화면에 뜬다**: 기본 배선만으로는 세션이 `reply` 도구를 써야만 앱에 답이 보인다. 미러 훅을 붙이면 세션이 **평소처럼 텍스트로 답만 해도** 앱에 그대로 나타난다.
- **진행 상황이 보인다**: `처리 중…`, `읽음: server.js`, `수정함: app.js` 같은 활동 한 줄이 흘러 사용자가 "멈춘 건가?"를 의심하지 않는다.
- **한 화면 = 한 대화**: 로컬 터미널·모바일·앱 어디서 말을 걸어도 **같은 피드**에 모인다.

## 언제 쓰나

- ANA 앱을 만들었는데 **앱에서 보낸 메시지에 세션이 반응하지 않을 때**(대개 `{id}` 누락 — §치명 함정).
- 세션은 일하는데 **앱 화면이 조용할 때**(미러 훅 미설치).
- 같은 답변이 **여러 번 올라오거나**, **다른 프로젝트 대화가 섞일 때**(dedup·소유권 가드 미적용).
- 여러 세션을 동시에 돌려 **fakechat 포트가 충돌**할 때.

## `fakechat-dashboard-agent`와의 관계 (확장 관계)

| | `fakechat-dashboard-agent` | **`realtime-mirror-channel` (이 스킬)** |
|---|---|---|
| 담당 | 기본 배선 — 서버 API(`/api/chat`·`/api/agent`·`/api/approve`), 대시보드, 릴레이 골격 | 실시간·미러 강화 — WS 주입 포맷, 활동 미러 훅, 포트 격리, 채널 활성 |
| 아웃바운드 | `POST /api/agent`(제안/승인 카드 등 리치 응답) | 그 위에 **텍스트 답변·도구 활동·상태**까지 자동 미러 |
| 없으면 | 앱이 아예 동작 안 함 | 앱은 뜨지만 "화면이 조용한" 반쪽 UX |

**먼저 `fakechat-dashboard-agent`로 배선하고, 그 다음 이 스킬로 실시간을 얹는다.** 이 스킬의 `references/studio-bridge.mjs`는 그 스킬의 `fakechat-bridge.js`를 대체하는 강화판(아웃바운드 broadcast 미러 포함)이다.

## 아키텍처 (요약)

```
[앱 브라우저] ─POST /api/chat─► 앱서버 inbox
                                   │ (studio-bridge 롱폴 /api/inbox-wait)
                                   ▼
                        ws.send({id, text}) ──► fakechat WS :8798 ──► [Claude 세션]
                                                                          │
        ┌──── (a) 미러 훅: 텍스트/도구활동/상태 → POST /api/activity ──────┤ (권장)
        │                                                                 │
        └──── (b) reply 도구 → fakechat broadcast → bridge → /api/agent ──┘ (선택)
                                   │
                                   ▼
                        [앱 피드 폴링 → 화면 표시]
```

전체 흐름도·엔드포인트·시퀀스는 [`references/realtime-architecture.md`](references/realtime-architecture.md) 참조.

## ★ 치명 함정 — fakechat WS 입력은 반드시 `{id, text}`

fakechat 서버의 WS 핸들러는 사실상 이렇다:

```js
const { id, text } = JSON.parse(raw);
if (id && text?.trim()) deliver(id, text);   // ← id 가 falsy 면 조용히 드롭
```

**`id`가 없으면 메시지를 버린다. 에러도 로그도 없다.** 브리지 로그엔 "전송함"이 찍히는데 세션은 영원히 무응답인 상태가 된다.

```js
ws.send(JSON.stringify({ type: 'user', text }));              // ❌ id 없음 → 드롭 → 세션 무응답
ws.send(JSON.stringify({ id: 'studio-' + (++seq), text }));   // ✅ deliver → 세션에 채널 메시지 도착
```

세션 도착 형태: `<channel source="plugin:fakechat:fakechat" message_id="studio-N">`

## 구축 절차

1. **선행 확인**: `fakechat-dashboard-agent` 배선(앱 서버 + `/api/chat`·`/api/inbox-wait`·`/api/agent`)이 있어야 한다. 미러 훅용으로 `POST /api/activity`(role/kind/text)와 `POST /api/status`(text) 엔드포인트를 추가한다.
2. **브리지 교체·실행**: `references/studio-bridge.mjs`를 앱에 복사하고 상단 설정 블록(`APP_URL`·`FAKECHAT_WS`·`TAG`·`ID_PREFIX`·`APP_ROOT`)을 맞춘 뒤 백그라운드 실행.
   ```bash
   FAKECHAT_WS=ws://127.0.0.1:8798/ws APP_URL=http://127.0.0.1:8791 node studio-bridge.mjs &
   ```
   칩(`chips`) 스키마는 앱 도메인에 맞춰 필드만 바꾸고 구조는 유지한다.
3. **미러 훅 설치**: `references/mirror-hook.mjs`를 복사하고 상단 설정(`APP_URL`·`APP_ROOT`·`OWN_DIR_RE`·`MIRROR_STATE`)을 맞춘다. **`OWN_DIR_RE`(소유권 가드)를 반드시 이 앱 디렉터리로 지정**한다.
4. **훅 등록** — `.claude/settings.json`:
   ```json
   {
     "hooks": {
       "UserPromptSubmit": [
         { "hooks": [{ "type": "command", "command": "node /ABS/PATH/mirror-hook.mjs" }] }
       ],
       "PostToolUse": [
         { "matcher": "*", "hooks": [{ "type": "command", "command": "node /ABS/PATH/mirror-hook.mjs" }] }
       ],
       "Stop": [
         { "hooks": [{ "type": "command", "command": "node /ABS/PATH/mirror-hook.mjs" }] }
       ]
     }
   }
   ```
   훅은 **항상 exit 0**이어야 세션을 막지 않는다(제공 파일이 그렇게 되어 있다).
5. **포트 격리**: 세션마다 fakechat 포트를 다르게 준다(예: 이 세션 8798, 다른 비서 8787). 기동 전 `lsof -iTCP:8798 -sTCP:LISTEN`로 고아 프로세스 정리.
6. **채널 붙여 세션 기동**:
   ```bash
   claude --channels plugin:fakechat@claude-plugins-official
   ```
   **여러 채널은 하나의 `--channels`에 공백으로 나열**한다. 플래그를 두 번 주면 뒤가 앞을 덮어써 앞 채널이 사라진다.
7. **검증**: 앱에서 한 줄 보낸다 → 세션에 채널 메시지 도착 → 세션이 그냥 텍스트로 답 → 앱 피드에 답변 + 도구 활동 + `처리 중…` 상태가 뜬다.

## 아웃바운드 두 경로 (무엇을 쓸까)

- **(a) 미러 훅 (권장·범용)**: 세션이 **평소처럼 답만 하면** 훅이 `/api/activity`로 게시. 도구 활동·상태 표시까지 덤으로 얻는다. 채널 없이 로컬에서 말을 걸어도 앱에 보인다.
- **(b) reply 도구 broadcast 미러 (선택)**: 세션이 fakechat `reply`를 쓰면 서버가 broadcast → 브리지가 `/api/agent`로 전달.
- **이중 게시 걱정 없음**: reply 텍스트는 assistant *텍스트 블록*이 아니라 *도구 입력*이라 미러 훅 수집 대상과 겹치지 않는다. 둘 다 켜도 안전하다.
- 제안/승인 카드 같은 **리치 응답은 여전히 `POST /api/agent`**로 보낸다(미러 훅은 평문 전용).

## 안전장치 3종 (빼면 반드시 사고 난다)

- **소유권 가드** — `hook.cwd`가 이 앱 디렉터리일 때만 게시. 없으면 다른 폴더 세션 활동이 남의 앱 피드에 섞인다.
- **턴당 dedup** — 상태 파일에 `{turnStart, sent}`를 두고 이미 보낸 블록 수만큼 건너뛴다. 없으면 `PostToolUse`마다 같은 답이 재게시된다.
- **내부 턴 스킵** — 하트비트/크론/시스템 알림 프롬프트는 미러하지 않는다.

## 함정 (증상 → 조치)

| 증상 | 원인 | 조치 |
|---|---|---|
| 채팅 보내도 세션 무반응 | WS 페이로드 **`id` 누락** → 조용히 드롭 | `{id, text}` 형식으로 수정 |
| 브리지 로그는 정상인데 무응답 | **채널 미연결** 세션 | `--channels`로 재기동 |
| 다른 프로젝트 대화가 섞임 | 소유권 가드 없음 | `OWN_DIR_RE` 지정 |
| 같은 답이 여러 번 | dedup 없음 | 턴당 `sent` 카운트 유지 |
| 서버 재기동 후 피드 정지 | 프론트가 옛 `lastMsg` id로 폴링 | 서버가 부팅 에폭 `sync` 전달 → 프론트가 `lastMsg` 초기화 |
| 남의 세션이 내 메시지 수신 | fakechat 포트 충돌 | 세션별 포트 분리 |

## 보안·운영

- **자격증명 불필요**: fakechat은 로컬 WS로만 동작한다. 이 빌딩블록에 텔레그램·외부 토큰이 없다.
- 앱 토큰(`APP_TOKEN`)은 `secrets.env`에서 읽고 **코드·저장소에 값을 넣지 않는다**.
- 훅은 세션의 모든 턴에서 돌므로 타임아웃(4초)·`exit 0`·예외 삼킴을 유지한다.

## 참고 파일

- [`references/realtime-architecture.md`](references/realtime-architecture.md) — 양방향 흐름도·인바운드/아웃바운드 상세·포트 격리·활성 조건·함정표
- [`references/studio-bridge.mjs`](references/studio-bridge.mjs) — 인바운드 릴레이 + broadcast 미러(의존성 0, Node 22)
- [`references/mirror-hook.mjs`](references/mirror-hook.mjs) — 활동 미러 훅(소유권 가드·dedup·내부 스킵·첨부 이미지)
- 선행 빌딩블록: `skills/fakechat-dashboard-agent/SKILL.md`
