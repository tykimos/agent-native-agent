# fakechat 채널 실시간 연동 — 문제 정리와 해결

> ana(`/ana`) ↔ Azure VM의 Claude Code 세션을 실시간 양방향으로 잇는 과정에서 겪은 문제와 해결책.
> 환경: Ubuntu 24.04 (Azure B2as_v2) · Claude Code 2.1.233 · bun 1.3.14 · fakechat 플러그인 0.0.1
> 작성: 2026-08-17 · 갱신: 2026-08-17 (상태 UI 개편 + 만료 표기 오류 수정)

---

## 0. 최종 상태 (해결됨)

ana 채팅 헤더에 **항상 두 줄**로 뜬다(접히지 않는다 — 문제 11).
```
🟢 앱  🟢 세션  🟢 fakechat  🟢 브리지  🟢 채널  🟢 미러
세션 4% ↺1:10pm · 주간 6% · Fable 0% · 24분 전 · 재로그인 26일
```
두 줄을 누르면 왼쪽 **상태 탭**(모듈별 역할·마지막 활동·조치 문구, 사용량 바, 인증·플랜)이 열린다.

검증된 왕복:
```
[user]      ana에서 보냅니다. ls로 파일 개수를 세어 알려주세요.
[activity]  실행: Count files in working directory      ← 툴 활동 미러링
[assistant] 최상위 일반 항목: 31개 (숨김 포함 52개)      ← AI 응답 미러링
```

---

## 1. 아키텍처 (4구간)

```
[ana 브라우저] ①→ [앱서버 /api/ana/chat → inbox] ②→ [브리지 /api/ana/inbox-wait 롱폴]
   ③→ [fakechat 서버 :8798 WS·HTTP] ④→ [Claude 세션(채널 연결됨)]
                                          │
   [ana 피드] ◄── /api/ana/activity ──────┘ (미러 훅: 입력·툴활동·응답·상태)
```

**끊기는 곳은 거의 항상 ③ 또는 ④이고, 둘 다 에러 없이 조용히 실패한다.**

---

## 2. 겪은 문제와 해결 (시간순)

### 문제 1. fakechat MCP가 아예 기동 안 됨 — `CONNECTION_CLOSED`

**증상:** `/mcp`에서 `plugin:fakechat:fakechat · ✘ failed`. 다른 MCP(Gmail·Slack 등)는 정상.

**원인:** VM에 **bun 미설치**. fakechat은 `.mcp.json`에서 `bun`으로 실행된다.
```json
{ "command": "bun", "args": ["run", "--cwd", "${CLAUDE_PLUGIN_ROOT}", "--shell=bun", "--silent", "start"] }
```

**해결:**
```bash
sudo apt-get install -y unzip          # bun 설치 스크립트가 unzip을 요구
curl -fsSL https://bun.sh/install | bash
sudo ln -sf ~/.bun/bin/bun /usr/local/bin/bun   # MCP는 최소 PATH로 spawn → 시스템 경로에 링크
```

> **교훈:** MCP 서버는 로그인 셸의 PATH를 물려받지 않는다. 인터프리터는 `/usr/local/bin` 같은 표준 경로에 두거나 절대경로로 지정한다.

---

### 문제 2. 온보딩 화면이 매번 반복돼 세션이 안 뜸

**증상:** tmux로 세션을 띄울 때마다 테마 선택 → 로그인 방식 선택 화면에서 멈춤.

**원인:** `~/.claude.json`에 온보딩 완료 플래그가 저장되지 않음(헤드리스/PTY 환경).

**해결:**
```python
d['theme'] = 'dark'; d['hasCompletedOnboarding'] = True
```

---

### 문제 3. 인증 토큰이 잘려 저장됨

**증상:** `claude setup-token`으로 받은 토큰을 저장했는데 `401 OAuth access token is invalid`.

**원인:** PTY 로그에서 토큰을 추출할 때 **터미널 줄바꿈으로 분리**돼 107자 중 79자만 잡힘. 개행을 제거하면 이번엔 뒤 문구(`Storethistokensecurely`)까지 붙어 130자.

**해결:** 토큰 추출을 포기하고 **대화형 `/login`** 사용 → Claude Code가 `~/.claude/.credentials.json`을 직접 작성한다.

> **교훈:** 시크릿을 로그에서 파싱하지 마라. 도구가 자격증명 파일을 직접 쓰게 하는 경로를 택한다.

---

### 문제 4. ★ 핵심 — fakechat 서버가 기동 직후 죽음

**증상:**
- 세션 `/status`는 `Channels: Listening for messages from ...` (정상처럼 보임)
- 브리지 로그도 `→ 세션 주입: ...` (전송 성공처럼 보임)
- **그런데 세션에 메시지가 안 뜸.** 트랜스크립트에 user/assistant 메시지 0건
- `pgrep -f "bun server.ts"` → **0개** (포트도 닫힘)

**진단 (결정적):** 같은 명령을 **수동으로, stdin을 유지한 채** 실행하니 완벽히 동작.
```bash
( echo '{"jsonrpc":"2.0","id":1,"method":"initialize",...}'; sleep 45 ) \
  | FAKECHAT_PORT=8798 bun run --cwd <plugin> --shell=bun --silent start
# → 포트 LISTEN, initialize 응답에 "experimental":{"claude/channel":{}} 포함
# → curl -X POST localhost:8798/upload -F 'id=t' -F 'text=t'  →  204
```
즉 **서버·프로토콜은 정상이고, Claude가 spawn할 때만 죽는다.**

**원인 2가지:**
1. `start` 스크립트가 `bun install --no-summary && bun server.ts` — 매 기동마다 install 단계를 거친다.
2. **포트 선점(EADDRINUSE)** — 이전 인스턴스/고아 프로세스가 8798을 쥐고 있으면 `Bun.serve()`가 throw → **MCP stdio 부분까지 통째로 죽는다**.
   (진단 중 만든 중복 MCP 등록이 포트를 뺏어 상황을 악화시켰다.)

**해결 — 래퍼 스크립트:**
```sh
#!/bin/sh
# fakechat-run.sh — 포트 정리 후 server.ts 직접 실행
PORT="${FAKECHAT_PORT:-8798}"
for p in $(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null); do kill -9 "$p" 2>/dev/null; done
exec /usr/local/bin/bun /home/azureuser/.claude/plugins/cache/claude-plugins-official/fakechat/0.0.1/server.ts
```
> ⚠️ **이 kill -9 버전은 폐기했다 — 문제 10 참고.** 정상 점유자(상주 세션)까지 죽여서
> 프로젝트에서 `claude`를 두 번째로 띄우는 순간 채널이 끊긴다. 현재 래퍼는 **다음 빈 포트로 비켜간다.**
플러그인의 `.mcp.json`이 이 래퍼를 가리키게 한다:
```json
{ "mcpServers": { "fakechat": { "command": "/home/azureuser/oyo-web/fakechat-run.sh" } } }
```
효과: `bun install` 제거(기동 지연·stdio 오염 위험 제거) + EADDRINUSE 즉사 방지.

---

### 문제 5. ★ `--channels server:` 는 주입되지 않는다

**증상:** `.mcp.json`으로 등록한 서버를 `--channels server:fakechat`으로 붙이면
- `/status` → `Listening for messages from server:fakechat` (붙은 것처럼 표시)
- `/mcp` → `✔ connected · 2 tools`
- **그런데 주입은 세션에 도달하지 않는다.**

**해결:** **`plugin:` 형식만 실제로 주입된다.**
```bash
claude --channels plugin:fakechat@claude-plugins-official     # ✅ 동작
claude --channels server:fakechat                              # ❌ 표시만 되고 전달 안 됨
```
성공 시 세션에 배너가 뜬다:
```
▎ Channels (experimental) messages from plugin:fakechat@claude-plugins-official
▎ inject directly in this session · restart without --channels to stop
```
그리고 실제 도착 형태:
```
← fakechat · web: 정확히 CHANNEL OK 라고만 답해.
● CHANNEL OK
```

> **판별법:** `/status`의 "Listening" 문구만으로 정상이라고 믿지 마라. **배너 유무**와 **실제 도착 여부**로 확인한다.

---

### 문제 6. 스킬 문서의 진단 명령이 현행 버전과 불일치

**문서:** `curl -s -X POST localhost:8787/ -F 'id=diag-1' -F 'text=진단'` → **204 기대**

**실제 (`server.ts` 0.0.1):**
| 경로 | 동작 |
|---|---|
| `POST /upload` | `deliver()` 호출 → **204** ← 진짜 주입 엔드포인트 |
| `GET/POST /` | UI HTML 반환 → **200** |
| `/ws` | WebSocket 업그레이드 (브리지가 쓰는 경로) |

→ 문서대로 `/`에 쏘면 **200이 나와서 "정상"으로 오독**하게 된다. 이 때문에 진단이 크게 지연됐다.

**올바른 진단:**
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8798/upload -F 'id=d1' -F 'text=진단'
# 204 → 서버까지 정상. 세션에 뜨면 ④까지 정상, 안 뜨면 채널 미부착(=plugin: 형식으로 재기동)
```

---

### 문제 7. 응답이 두 번 표시됨

**증상:** 같은 답변이 피드에 중복 게시.

**원인:** 아웃바운드 경로가 **둘 다** 활성화됨.
1. 미러 훅: 세션의 assistant 텍스트 → `/api/ana/activity`
2. `reply` 도구: fakechat broadcast → 브리지 → `/api/ana/agent`

브리지가 세션에 보내는 안내문이 *"평소처럼 답하면 미러훅이 표시하고, reply 도구로 답하면 브리지가 미러링합니다"* 라고 **두 방법을 모두 안내**해 세션이 둘 다 수행했다.

**해결:**
1. 브리지 안내문 수정 → **"답변은 텍스트로만. `reply` 도구는 쓰지 말 것(중복 게시됨)"**
2. 서버에 방어적 dedup: 같은 role·같은 text가 20초 내 재게시되면 무시

---

### 문제 8. 모바일에서 UI 갱신이 안 됨

**원인:** `/ana`에는 `no-store`를 줬지만 **`/ana.js`·`/ana.css`에 캐시 헤더가 없어** 모바일 브라우저가 옛 버전을 계속 사용.

**해결:** 정적 자산에도 `Cache-Control: no-store, must-revalidate` 추가.

---

### 문제 9. 모바일 입력창 탭 시 확대되어 전송버튼 가림

**원인:** iOS는 입력 요소의 `font-size`가 **16px 미만이면 포커스 시 자동 확대**한다.

**해결:**
```css
@media(max-width:900px){
  .crow textarea{ font-size:16px }                 /* 자동 확대 방지 */
  .right{ height:100dvh }                          /* 키보드 대응 */
  .composer{ padding-bottom:calc(12px + env(safe-area-inset-bottom)) }
}
```

---

### 문제 10. ★ 프로젝트 안에서 `claude`를 두 번 띄우면 채널이 끊긴다 — 래퍼의 `kill -9`

**증상:** 잘 돌던 채널이 갑자기 죽는다. 아무도 건드리지 않았는데 다음 상태가 된다.
```
🟢 앱 서버 · 🟢 Claude 세션 · 🔴 fakechat MCP(포트 닫힘) · 🟢 브리지 · 🔴 채널 주입 · 🟢 미러 훅
[bridge] fakechat 끊김 — 3s 후 재연결        ← 무한 반복
```
세션의 MCP 도구 목록에서 `reply`가 사라지고, ana 입력창으로 보낸 메시지가 세션에 도달하지 않는다.
**단 미러 훅은 앱에 직접 POST하므로 아웃바운드는 정상이다 — 화면이 살아 있어 정상으로 오해하기 쉽다.**

**원인:** 문제 4에서 넣은 래퍼가 포트를 쥔 프로세스를 무조건 죽인다.
```sh
for p in $(lsof -tiTCP:$PORT -sTCP:LISTEN 2>/dev/null); do kill -9 "$p" 2>/dev/null; done
```
프로젝트 디렉터리에서 `claude`를 새로 띄우면 `.claude/settings.json`의 `enabledPlugins`에 따라
fakechat 플러그인 MCP가 함께 뜨고 → 래퍼가 **상주 세션의 fakechat 서버를 kill -9** →
새 프로세스가 끝나면 자기 서버도 죽어 **포트가 텅 빈다.** 상주 세션의 MCP 연결은 복구되지 않는다.

실제 사고 경로: ana 사용량 패널이 공식 수치를 얻기 위해 `claude -p /usage`를 **프로젝트 cwd에서**
1시간마다 실행하도록 붙였고, 그 첫 실행이 채널을 끊었다.
같은 사고는 다른 터미널에서 `claude`를 한 번 열거나, `claude -p` 스크립트를 돌리거나,
별도 프로세스를 띄우는 자동화 어디서나 재현된다.

**해결 1 — 래퍼가 죽이지 말고 비켜간다** (`fakechat-run.sh`)
```sh
PORT="${FAKECHAT_PORT:-8798}"
p="$PORT"
while lsof -tiTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; do p=$((p + 1)); done
exec env FAKECHAT_PORT="$p" /usr/local/bin/bun <plugin>/server.ts
```
브리지는 8798만 보므로 상주 세션이 8798을 유지하고, 두 번째 인스턴스는 8799로 밀려 무해하다.
검증: 8798·8799를 점유한 상태에서 래퍼는 8800을 고르고, 해제하면 다시 8798을 고른다.
고아 프로세스 정리는 수동으로 분리한다 — `lsof -tiTCP:8798 -sTCP:LISTEN | xargs -r kill`.

**해결 2 — 프로젝트 밖 + MCP 비활성으로 claude를 호출한다** (자동화·서브프로세스 공통 규칙)
```js
execFile(claude, ['-p', '/usage', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'],
         { cwd: homedir(), timeout: 150000 })
```
`cwd`를 프로젝트 밖으로 두면 프로젝트 settings의 플러그인·훅이 로드되지 않아 포트를 건드리지 않고,
미러 훅도 걸리지 않아 피드에 조회 노이즈가 남지 않는다.

> **교훈:** 상주 세션이 쥔 자원을 자동화가 **선점(preempt)** 하게 만들지 마라.
> "고아 정리"용 `kill -9`는 정상 점유자와 고아를 구분하지 못한다. 비켜가기(다음 포트)가 안전하다.
> 그리고 **채널 복구에는 세션 재기동이 필요하다** — 채널은 기동 시점에만 붙기 때문이다(문제 5).

---

### 문제 11. 상태 표시를 버튼 뒤에 접어두면, 정작 장애 때 보이지 않는다

**증상:** 헤더에 `전체 연결됨` pill 버튼 하나만 있고, 모듈별 상태·사용량은 그 버튼을 눌러야 펼쳐지는
스트립(`#rmeta`)에 있었다. 그래서 (ㄱ) 정상일 때는 정보가 0에 가깝고, (ㄴ) 문제가 생겨도
`연결 미완 · 브리지(릴레이)` 한 줄뿐이어서 **무엇을 해야 하는지**는 또 한 번 클릭해야 알 수 있었다.
문제 10 같은 사고는 "아웃바운드는 살아 있어 화면이 정상처럼 보이는" 형태로 오니, 접힌 상태창은 특히 나쁘다.

**해결:** 토글을 없애고 정보를 **항상 보이는 2줄 + 전용 상태 탭**으로 재배치했다.

| 위치 | 내용 |
|---|---|
| 헤더 1행 | 6모듈 점+짧은 라벨 전부 (초록/빨강). hover 시 `label — detail` |
| 헤더 2행 | 세션% ↺리셋 · 주간% · 모델% · 기준시각 · 재로그인 기한 |
| 상태 탭 | 요약 카드 4장 → 모듈 상세(역할·마지막 활동·**조치 문구**) → 사용량 진행바 → 인증·플랜 |

이를 위해 `/api/ana/health`의 각 모듈에 필드를 추가했다 — 상태만 주는 API로는 "그래서 뭘 하지"에 답할 수 없다.
```js
{ key, label, ok, detail,
  role: '이 앱 ↔ 세션 사이를 롱폴로 잇는다',        // 이 조각이 무엇인지
  at:   1786960207905,                             // 마지막 활동 시각 → '11초 전'
  fix:  'node ana-bridge.mjs 재기동' }              // 빨강일 때만 화면에 노출
```

> **교훈:** 상태 UI의 가치는 **장애 순간에 클릭 없이 읽히는 양**으로 정해진다.
> 정상일 때 깔끔한 것보다, 고장났을 때 다음 행동이 그 자리에 적혀 있는 게 낫다.

---

### 문제 12. ★ "로그인 만료 7시간 3분" — 실제로는 만료가 아니었다

**증상:** 상태줄이 매일 `로그인 만료 7시간 3분`처럼 표시. 며칠째 재로그인한 적이 없는데도
숫자가 계속 한 자리 시간대라 **곧 끊길 것처럼 보였다.** (게다가 임박 경고 임계값이 6시간이라
매일 몇 시간씩 빨간 경고가 켜졌다.)

**원인:** `~/.claude/.credentials.json`에는 만료 타임스탬프가 **두 개** 있는데, 짧은 쪽을 읽고 있었다.

| 필드 | 뜻 | 주기 | 사람이 할 일 |
|---|---|---|---|
| `claudeAiOauth.expiresAt` | **액세스 토큰** 만료 | 8~12시간 | **없음** — CLI가 리프레시 토큰으로 자동 갱신 |
| `claudeAiOauth.refreshTokenExpiresAt` | **리프레시 토큰** 만료 | 수십 일 | 이 시점에 `claude /login` 필요 |

실측(2026-08-17 09:5x): `expiresAt` = 16:48 (6시간 59분 뒤), `refreshTokenExpiresAt` = **09-13 03:11 (26일 17시간 뒤)**.
즉 화면의 "만료"는 무해한 내부 갱신 시각이었고, 진짜 재로그인 기한은 한 달 가까이 남아 있었다.

**해결:** 필드를 뜻대로 분리하고 이름도 바꿨다(`authExpiresIn`/`authSoon` 폐기).
```js
out.token = { in: fmtDur(o.expiresAt - now), at: o.expiresAt };                       // 자동 갱신
out.login = { in: fmtDur(o.refreshTokenExpiresAt - now), at: …, soon: left < 3*86400e3 }; // 재로그인
out.plan  = o.subscriptionType + ' · ' + o.rateLimitTier.replace(/^default_claude_/, '');
```
- 헤더에는 `재로그인 26일`만 쓴다. 액세스 토큰은 상태 탭에서 *"만료되면 CLI가 스스로 갱신 — 사람이 할 일 없음"* 문구와 함께만 보여준다.
- 임박 경고 임계값 6시간 → **3일**.
- `fmtDur`가 시간까지만 지원해 26일이 `641시간 30분`으로 나오던 것도 일(day) 단위로 확장.

> **교훈:** 자격증명 파일의 타임스탬프는 **무엇의 만료인지**를 확인하고 쓴다.
> 특히 OAuth는 "짧게 만료되는 액세스 토큰 + 길게 사는 리프레시 토큰"이 기본이라,
> 짧은 쪽을 사용자에게 "만료"로 보여주면 **매일 오지 않는 마감을 알리는 상태창**이 된다.
> 상태 지표의 이름은 *"사람이 그때 무엇을 해야 하는가"* 를 기준으로 붙여야 한다.

---

## 3. 30초 진단 절차 (정리판)

**0단계는 이제 화면이다.** `/ana` → **상태 탭**. 빨간 모듈의 `조치 문구`가 곧 다음 명령이고,
`마지막 활동`이 끊긴 시각을 준다(문제 10의 "언제 claude를 띄웠나" 추적에 쓴다).
그 다음에야 아래 CLI로 내려간다.


```bash
# ① 앱 서버
curl -s localhost/api/ana/health           # 모듈별 상태 JSON

# ② 브리지 생존
pgrep -f ana-bridge                        # 없으면 릴레이 미기동
tail -3 /tmp/ana-bridge.log                # "fakechat 연결" 있어야 함

# ③ fakechat 서버 (★ 경로 주의)
lsof -nP -iTCP:8798 -sTCP:LISTEN           # bun 프로세스가 떠 있어야 함
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST localhost:8798/upload -F 'id=d1' -F 'text=진단'   # 기대 204

# ④ 세션 채널 부착
tmux capture-pane -t ana -p -S -200 | grep -i channel
#   "Channels (experimental) ... inject directly" 배너가 있어야 진짜 부착
```

**이분 탐색:** ③에서 204가 나오는데 세션에 안 뜨면 → ④(채널 미부착) → `plugin:` 형식으로 **재기동**(채널은 기동 시점에만 붙는다).

**아웃바운드만 살아 있는 상태를 구분하라.** 미러 훅은 fakechat을 거치지 않고 앱에 직접 POST하므로,
③이 죽어도 ana 화면에는 세션 활동이 계속 표시된다. `/api/ana/health`에서 `미러 훅`은 초록인데
`fakechat MCP`·`채널 주입`이 빨강이면 **인바운드(ana 입력창 → 세션)만 끊긴 것**이다. 이때는
`채널 주입`의 `detail`(마지막 성공 시각)이 언제 끊겼는지 알려준다 → 그 시각 전후에 프로젝트에서
`claude`를 띄운 일이 있었는지 확인한다(문제 10).

---

## 4. 최종 구성 (재현용)

```bash
# 1) 사전 요구
sudo apt-get install -y unzip lsof
curl -fsSL https://bun.sh/install | bash
sudo ln -sf ~/.bun/bin/bun /usr/local/bin/bun

# 2) 래퍼 (포트 정리 + server.ts 직접 실행)
~/oyo-web/fakechat-run.sh          # 위 스크립트, chmod +x

# 3) 플러그인이 래퍼를 쓰게
~/.claude/plugins/cache/claude-plugins-official/fakechat/0.0.1/.mcp.json
  → { "mcpServers": { "fakechat": { "command": "/home/azureuser/oyo-web/fakechat-run.sh" } } }
# ※ 프로젝트 .mcp.json에 중복 정의 두지 말 것 (포트 경쟁 → 즉사)

# 4) 세션 (plugin: 형식 필수)
tmux new-session -d -s ana -c ~/oyo-web \
  "FAKECHAT_PORT=8798 claude --dangerously-skip-permissions \
   --channels plugin:fakechat@claude-plugins-official"

# 5) 브리지
cd ~/oyo-web && nohup node ana-bridge.mjs > /tmp/ana-bridge.log 2>&1 &
```

**고친 코드를 적용하는 법** (헷갈려서 두 번 헛돌았다):
```bash
# ana.html / ana.css / ana.js  → 정적 파일 + no-store → 브라우저 새로고침만 하면 끝
# ana.mjs (API·헬스·사용량)     → 앱 서버 프로세스 안에 있으므로 재시작 필요
sudo systemctl restart oyo-web.service && systemctl is-active oyo-web.service
```
재시작은 채널을 끊지 않는다(세션·브리지·fakechat은 별도 프로세스, 브리지는 롱폴을 다시 붙인다).
단 **피드는 인메모리라 재시작 시 대화가 사라진다**(§6 과제). `lastMirrorAt` 등 헬스 지표는 파일로 보존된다.

인증이 걸린 API를 curl로 확인할 때:
```bash
curl -s -c /tmp/c.txt -X POST -H 'Content-Type: application/json' \
     -d '{"password":"<ANA_PASSWORD>"}' localhost/api/ana/login
curl -s -b /tmp/c.txt localhost/api/ana/usage | python3 -m json.tool
# ↑ 쿠키 없이 부르면 그냥 {"error":"unauthorized"} — 서버 고장으로 오독하기 쉽다
```

설정 파일:
- `~/.config/ana/secrets.env` — `APP_URL=http://127.0.0.1`, `FAKECHAT_WS=ws://127.0.0.1:8798/ws`, `OWN_DIR_RE=oyo-web(/|$)`
- `~/oyo-web/.claude/settings.json` — 미러 훅(UserPromptSubmit·PostToolUse·Stop) + `permissions.deny: ["AskUserQuestion"]`
  (AskUser는 ana 화면에 렌더되지 않아 세션이 멈추므로 비활성화)

---

## 5. 핵심 교훈

1. **"연결됨" 표시를 믿지 마라.** `/status`의 Listening, `/mcp`의 ✔ connected, 브리지의 "주입함" 로그가 모두 정상인데도 메시지는 사라질 수 있다. **끝점에서 실제 도착을 확인**해야 한다.
2. **모듈별 상태 패널을 먼저 만들어라.** ana에 6모듈 헬스체크(`/api/ana/health`)를 붙인 뒤에야 어느 구간이 죽었는지 즉시 보였다. 이게 원인 규명의 결정타였다.
   단 **접어두지 마라**(문제 11). 그리고 상태값 옆에 **역할·마지막 활동·조치**를 같이 실어야 판단까지 한 화면에서 끝난다.
3. **stdio MCP는 포트 충돌에 통째로 죽는다.** HTTP 서버를 겸하는 MCP는 EADDRINUSE 하나로 프로토콜 레이어까지 잃는다. 래퍼로 방어하라.
4. **문서와 구현의 드리프트를 의심하라.** 진단 명령의 엔드포인트(`/` vs `/upload`)가 달라 오진이 길어졌다.
5. **채널 형식은 `plugin:`만 실동작한다** (이 버전 기준). `server:`는 표시만 된다.
6. **지표 이름은 "사람이 뭘 해야 하는가"로 붙여라.** 액세스 토큰 만료를 "로그인 만료"로 부른 탓에
   매일 가짜 마감이 떴다(문제 12). 사람이 할 일이 없는 값은 경고로 쓰지 말고, 쓰더라도 그렇게 적어라.

---

## 6. 남은 개선 과제

- [ ] 세션·브리지를 **systemd 유닛**으로 등록해 재부팅 자동 복구
- [ ] `/ana` 비밀번호 강화(현재 단순 값) + 로그인 시도 제한
- [ ] `채널 주입` 지표를 미러훅 유입 기준으로 더 정확히 판정
- [ ] 상류 스킬 문서(`realtime-mirror-channel`)에 `/upload` 경로·`plugin:` 형식 반영 제안
- [ ] 미러 훅에 디버그 스위치 — 지금은 `post()`가 모든 실패를 삼키고 항상 `exit 0` 이라
      `secrets.env` 로딩 실패 시 무증상으로 아무 데도 안 보낸다(기본값 `APP_URL=…:8791`, `OWN_DIR_RE=ana-app`)
- [ ] 피드를 sqlite에 영속화 — 현재 `feed`가 인메모리라 **서버 코드를 고쳐 재시작할 때마다 사용자 대화가 사라진다**
- [ ] `refreshTokenExpiresAt`이 자동 갱신 때 함께 밀리는지 확인 — 밀린다면 "재로그인 기한"은 사실상 무기한이고,
      고정이라면 09-13 전에 `claude /login` 알림이 필요하다(현재 3일 전 빨강 경고만 있음)
- [ ] 상태 탭에 최근 이벤트 타임라인(주입·미러·재기동 시각) 추가 — 지금은 모듈별 "마지막 활동" 한 점만 보인다
- [ ] 프로세스 판별에서 `pgrep -f` 제거 — 같은 문자열을 포함한 셸 명령까지 잡아 유령 프로세스로 오진된다.
      포트(`ss -ltnp`)나 systemd 유닛 상태로 판별할 것 (앱 서버는 이미 `oyo-web.service`)
