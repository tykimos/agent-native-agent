# fakechat 채널 연결 진단 가이드

앱에서 메시지를 보냈는데 **세션이 반응하지 않을 때** 쓰는 절단점(斷點) 진단서. 추측하지 말고 **경로를 따라 내려가며 어디서 끊겼는지 특정**한다.

> 이 문서는 실제 fakechat 플러그인(`~/.claude/plugins/cache/claude-plugins-official/fakechat/<ver>/server.ts`) 동작을 근거로 한다.

## 목차
1. [먼저 이해할 것 — 연결은 4개 구간이다](#1-먼저-이해할-것--연결은-4개-구간이다)
2. [30초 진단 (순서대로)](#2-30초-진단-순서대로)
3. [구간별 정밀 점검](#3-구간별-정밀-점검)
4. [증상별 원인 표](#4-증상별-원인-표)
5. [포트 격리와 다중 세션](#5-포트-격리와-다중-세션)
6. [복구 절차 (안전 재기동)](#6-복구-절차-안전-재기동)

---

## 1. 먼저 이해할 것 — 연결은 4개 구간이다

```
[앱 브라우저] ①→ [앱 서버 /api/chat → inbox] ②→ [브리지 /api/inbox-wait 롱폴]
   ③→ [fakechat 서버 :8787 WS/HTTP] ④→ [Claude 세션(채널 연결됨)]
```

**끊기는 지점은 거의 항상 ③ 아니면 ④다.** ①②는 앱 내부라 로그로 바로 보이지만, ③④는 **조용히 실패**한다 — 에러도 로그도 없이 메시지가 사라진다. 그래서 진단이 필요하다.

| 구간 | 무엇 | 실패 시 증상 |
|---|---|---|
| ① 앱 → 앱서버 | `POST /api/chat` | 화면에 내 말풍선조차 안 뜸 |
| ② 앱서버 → 브리지 | `GET /api/inbox-wait` 롱폴 | 내 말풍선은 뜨는데 아무 일 없음 |
| ③ 브리지 → fakechat | WS `{id, text}` 주입 | 브리지 로그엔 "전송함", 세션은 무응답 |
| ④ fakechat → 세션 | MCP `notifications/claude/channel` | 서버는 받았는데 세션에 안 뜸 |

---

## 2. 30초 진단 (순서대로)

각 명령의 **기대값**과 다르면 그 구간이 범인이다.

```bash
# ① 앱 서버가 살아 있고 inbox에 쌓이는가
curl -s localhost:8777/api/state | head -c 120        # 기대: JSON
curl -s -X POST localhost:8777/api/chat \
  -H 'Content-Type: application/json' -d '{"text":"ping"}'   # 기대: {"ok":true,...}

# ② 브리지가 그 요청을 집어가는가 (롱폴이 즉시 반환되면 대기 중인 요청 있음)
curl -s --max-time 3 localhost:8777/api/inbox-wait | head -c 200
#   → {"requests":[...]} 인데 브리지가 안 가져갔다면 브리지 미실행

# ③ fakechat 서버가 그 포트에 떠 있는가
lsof -iTCP:8787 -sTCP:LISTEN -n -P                    # 기대: bun ... 127.0.0.1:8787
curl -s -o /dev/null -w '%{http_code}\n' localhost:8787/   # 기대: 200 (UI HTML)

# ③' 채널에 직접 주입해 본다 (브리지를 건너뛰고 테스트)
curl -s -X POST localhost:8787/ -F 'id=diag-1' -F 'text=진단 테스트'   # 기대: 204
#   → 이걸로 세션에 뜨면 ③까지는 정상 = 범인은 브리지(②③ 사이)
#   → 이래도 안 뜨면 ④ = 세션이 채널에 연결돼 있지 않다
```

> **핵심 팁:** `curl -F 'id=... -F text=...'` 로 fakechat에 **직접 쏘는 것**이 가장 빠른 이분 탐색이다. 여기서 뜨면 앱/브리지 문제, 안 뜨면 세션/채널 문제.

---

## 3. 구간별 정밀 점검

### ③ 브리지 → fakechat — 페이로드는 반드시 `{id, text}`

플러그인 서버의 WS 핸들러는 이렇게 생겼다:

```ts
const { id, text } = JSON.parse(String(raw))
if (id && text?.trim()) deliver(id, text.trim())   // ← id 가 falsy 면 아무 일도 안 일어난다
```

HTTP 경로도 동일하게 `if (!id) return 400`이다. 즉 **`id` 없으면 조용히 버려진다.**

```js
ws.send(JSON.stringify({ type:'user', text }));          // ❌ id 없음 → 드롭 → 무응답
ws.send(JSON.stringify({ id:'app-'+(++seq), text }));    // ✅
```

브리지가 **연결은 됐는지**도 본다 — WS는 서버가 죽어 있어도 `send()`가 조용히 실패할 수 있다. 제공 브리지는 `wsReady` 플래그로 막고 2초 재접속을 돈다. 로그에 `fakechat 연결됨`이 찍히는지 확인한다.

### ④ fakechat → 세션 — 세션이 채널을 물고 떠 있어야 한다

플러그인은 MCP **stdio** 서버다. 즉 **세션이 그 플러그인을 채널로 붙여 기동한 경우에만** `mcp.notification`이 도달한다. 이미 떠 있는 세션에 나중에 붙일 수 없다 — **재기동이 필요**하다.

```bash
claude --channels plugin:fakechat@claude-plugins-official
```

- 여러 채널은 **하나의 `--channels`에 공백으로 나열**한다. 플래그를 두 번 주면 뒤가 앞을 덮어써 앞 채널이 사라진다.
- 설치가 안 돼 있으면 로컬 터미널에서 `/plugin install fakechat@claude-plugins-official`.
- 세션에 도착하는 형태:
  `<channel source="fakechat" chat_id="web" message_id="app-N">`
  (플러그인이 `meta`에 `chat_id:"web"`·`message_id`를 실어 보낸다.)

### 앱 화면에 답이 안 보이는 경우 (반대 방향)

세션은 받았는데 **화면에 안 뜨는 것**은 연결 문제가 아니라 아웃바운드 문제다. 세션이 그냥 텍스트로 답하면 **미러 훅**이 `/api/activity`로 올려야 보인다. 훅 미배선이면 세션은 정상 동작하는데 사용자만 모른다.

- fakechat `reply` 툴로 답하면 broadcast → 브리지가 `/api/agent`로 전달.
- 플러그인 instructions는 "transcript 출력은 UI에 안 간다"고 명시한다 — **채널 UI 기준**의 말이며, 우리 앱은 미러 훅으로 이를 우회한다.

---

## 4. 증상별 원인 표

| 증상 | 유력 원인 | 확인 | 조치 |
|---|---|---|---|
| 내 말풍선도 안 뜸 | 앱 서버 미기동 / `/api/chat` 실패 | `curl /api/state` | 서버 기동 |
| 말풍선은 뜨는데 무반응 | 브리지 미실행 | `/api/inbox-wait`에 요청이 남아 있음 | `node fakechat-bridge.js` (또는 `npm run all`) |
| 브리지 로그 "전송함"인데 무응답 | **`id` 누락** 또는 **세션 채널 미연결** | `curl -F id=... :8787` 직접 주입 | 페이로드 `{id,text}` 수정 / 세션 재기동 |
| 직접 주입도 무응답 | **세션이 채널 없이 떠 있음** | 세션 기동 명령 확인 | `--channels`로 재기동 |
| 다른 비서 세션이 대신 받음 | **포트 공유** (둘 다 8787) | `lsof -iTCP:8787` | 세션별 포트 분리(§5) |
| 답이 두 번 올라옴 | 미러 훅 + reply 둘 다 게시 | 피드 중복 확인 | 한쪽만 사용(권장: 미러 훅) |
| 다른 프로젝트 대화가 섞임 | 미러 훅 **소유권 가드** 없음 | 훅의 cwd 가드 | `OWN_DIR_RE` 설정 |
| 서버 재기동 후 피드 멈춤 | 프론트가 옛 `lastMsg`로 폴링 | `sync` epoch 변화 | 프론트가 epoch 변경 시 피드 초기화 |

---

## 5. 포트 격리와 다중 세션

fakechat 서버는 `127.0.0.1:${FAKECHAT_PORT ?? 8787}`에 바인딩한다. **여러 비서/프로젝트가 각자 채널을 쓰면 포트를 반드시 분리**한다. 안 그러면 먼저 뜬 세션이 모든 메시지를 가져간다(둘째는 포트 충돌로 아예 못 뜨거나).

```bash
lsof -iTCP:8787 -sTCP:LISTEN -n -P     # 누가 쓰고 있는지
FAKECHAT_PORT=8798 …                    # 세션별로 다른 포트
```

브리지도 같은 포트를 보게 맞춘다: `FAKECHAT_WS=ws://127.0.0.1:8798/ws`.

> 플러그인 `.mcp.json`에는 env가 없으므로, 포트를 바꾸려면 **세션 기동 환경**에 `FAKECHAT_PORT`를 넣어야 한다. 바꾼 뒤에는 브리지의 `FAKECHAT_WS`도 함께 바꾼다 — 한쪽만 바꾸면 조용히 끊긴다(가장 흔한 재발 원인).

---

## 6. 복구 절차 (안전 재기동)

순서를 지킨다. 거꾸로 하면 고아 프로세스가 포트를 잡고 있어 다시 실패한다.

1. **정리** — `lsof -ti tcp:<fakechat포트> | xargs kill -9` (필요 시 앱 서버·브리지도)
2. **앱 서버** 기동 → `curl /api/state` 로 확인
3. **브리지** 기동 → 로그에 `fakechat 연결됨` 확인
4. **세션** 을 `--channels`로 재기동 (채널은 기동 시점에만 붙는다)
5. **검증** — 앱에서 한 줄 전송 → 세션 도착 → 세션이 평소처럼 답 → 앱 피드에 답·도구활동·`처리 중…` 표시

> 라이브 운영 중인 앱이라면 **재기동 전에 릴레이·터널 배선을 함께 확인**한다. 서버만 살리고 브리지를 빠뜨리는 실수가 잦다.
