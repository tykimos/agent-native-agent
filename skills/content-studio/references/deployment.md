# 콘텐츠 스튜디오 — 설치 · 상시구동 · 외부공개

## 1. 파일 배치

```
<project>/
  studio/
    studio-server.mjs        ← references/
    studio.html              ← references/
    studio.js                ← references/
    studio-capture.mjs       ← references/
    run-studio.sh            ← references/  (chmod +x)
    studio-state.json        ← references/studio-state.template.json 복사
    studio-bridge.mjs        ← skills/realtime-mirror-channel/references/studio-bridge.mjs
    att/                     ← 캡처·첨부 저장(자동 생성, 커밋 금지)
  docs/document.html         ← 렌더된 문서(경로는 STUDIO_DOC 로 지정)

~/.config/content-studio/    ← STUDIO_CONFIG_DIR
  secrets.env                ← STUDIO_TOKEN=...   (권한 600, 커밋 금지)
  mirror-hook.mjs            ← skills/realtime-mirror-channel/references/mirror-hook.mjs
  studio.log · studio-tunnel.log · studio-url.txt · studio-link.txt
~/Library/LaunchAgents/
  local.content-studio.plist        ← references/content-studio.plist
  local.content-studio-tunnel.plist ← 아래 터널용(선택)
```

> `studio-bridge.mjs`(인바운드 릴레이)와 `mirror-hook.mjs`(세션 활동 미러)는 **`realtime-mirror-channel` 빌딩블록의 파일**이다. 이 스킬에 중복 배치하지 말고 그 스킬에서 가져와 배선한다.

## 2. 프로젝트별 설정 치환

각 파일 상단 `▼▼ 프로젝트별 설정 ▼▼` 블록만 바꾸면 된다. 로직은 손대지 않는다.

| 파일 | 바꿀 값 |
|---|---|
| `studio-server.mjs` | `DOC_FILE`(= `STUDIO_DOC`) · `DOC_ROUTE` · `DOC_NAME` |
| `studio.js` | `DOC_URL`(= `DOC_ROUTE`) · `DOC_NAME` · `ANCHOR_RE` · `sectionOf()` · `componentOf()` |
| `studio.html` | `<title>` · iframe `src`(= `DOC_ROUTE`) · 헤더 라벨 |
| `studio-capture.mjs` | `STUDIO_DOC_ROUTE` · `CHROME_BIN` · `STUDIO_CAP_W/H`(문서 페이지 폭보다 넉넉히) |
| `run-studio.sh` | `STUDIO_PORT` · `FAKECHAT_WS` · `STUDIO_DOC` · `STUDIO_CONFIG_DIR` · `NODE_BIN` |
| `content-studio.plist` | `Label` · `__USER__` · `__PROJECT__` |
| `studio-tunnel-run.sh` | `STUDIO_CONFIG_DIR` · `STUDIO_PORT` |

## 3. 토큰

```bash
mkdir -p ~/.config/content-studio
printf 'STUDIO_TOKEN=%s\n' "$(openssl rand -hex 16)" >> ~/.config/content-studio/secrets.env
chmod 600 ~/.config/content-studio/secrets.env
```

- 토큰이 설정되면 `/api/*`는 `Authorization: Bearer <token>` 또는 `?token=<token>`을 요구한다. 정적 파일·`/att`은 무인증(문서 자체는 이미 링크를 아는 사람만 본다는 전제 — 민감 문서면 정적도 게이트하도록 서버를 확장하라).
- **저장소에는 토큰 값을 절대 두지 않는다.** `secrets.env`, `studio-link.txt`, `studio-state.json`, `att/`는 `.gitignore`.

## 4. 상시 구동 (LaunchAgent)

`references/content-studio.plist`의 `__USER__` / `__PROJECT__`를 치환해 배치한 뒤:

```bash
cp references/content-studio.plist ~/Library/LaunchAgents/local.content-studio.plist
launchctl unload ~/Library/LaunchAgents/local.content-studio.plist 2>/dev/null
launchctl load  ~/Library/LaunchAgents/local.content-studio.plist
tail -f ~/.config/content-studio/studio.log
```

`KeepAlive=true`이므로 죽으면 자동 재기동한다(`ThrottleInterval=10`). 수동 실행은 `zsh studio/run-studio.sh`.

## 5. 외부 공개 (Cloudflare quick tunnel)

`references/studio-tunnel-run.sh`를 `~/.config/content-studio/`에 두고 별도 LaunchAgent로 KeepAlive 구동한다.

- `*.trycloudflare.com` URL을 로그에서 잡아 `studio-url.txt`에, **토큰이 붙은 완전 링크**를 `studio-link.txt`에 저장한다.
- 퀵터널 주소는 **재시작마다 바뀐다**. 고정이 필요하면 named tunnel을 쓴다.
- 터널은 `text/event-stream`을 버퍼링하므로 **폴링을 항상 병행**한다(이 스튜디오는 폴링 전용이라 안전).

플리스트 예(터널용):

```xml
<key>Label</key><string>local.content-studio-tunnel</string>
<key>ProgramArguments</key>
<array><string>/bin/bash</string><string>/Users/__USER__/.config/content-studio/studio-tunnel-run.sh</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
```

## 6. 세션 훅 배선 (미러)

세션 활동을 스튜디오 피드에 띄우려면 훅 3개를 settings에 병합한다. 훅 스크립트 본체는 **`realtime-mirror-channel`**의 `mirror-hook.mjs`다.

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node $HOME/.config/content-studio/mirror-hook.mjs" }] }],
    "PostToolUse":      [{ "matcher": "", "hooks": [{ "type": "command", "command": "node $HOME/.config/content-studio/mirror-hook.mjs" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "node $HOME/.config/content-studio/mirror-hook.mjs" }] }]
  }
}
```

훅이 `POST /api/activity`(+ `/api/status`)로 게시하므로 세션은 별도 응답 도구 없이 평소처럼 답하면 된다.

## 7. 활성화 조건 · 점검

| 증상 | 확인 |
|---|---|
| 화면에서 보낸 메시지에 세션이 무반응 | 세션이 **격리 포트의 fakechat 채널**로 떠 있는지, `studio-bridge.mjs`가 살아 있는지(`/api/inbox-wait` 롱폴) |
| 세션 답변이 화면에 안 뜸 | 미러 훅 3종 배선 · `STUDIO_TOKEN` 일치 여부 |
| 401 | 링크에 `?token=` 누락 |
| 문서가 안 바뀜 | 세션이 `POST /api/rerender`를 호출했는지(`bookVersion` 증가 확인: `GET /api/state`) |
| 캡처 실패 | `CHROME_BIN` 경로 · 디버그 포트 충돌 · 25초 타임아웃 |
| 메시지 두 번 | IME 가드 / 서버 3초 dedup가 살아 있는지 |

## 8. 의도적으로 제외한 것

- 텔레그램·외부 메신저 통지 일체(봇 토큰·chat_id·브로드캐스트 훅).
- 자격증명·`STUDIO_TOKEN` 값·라이브 `studio-state.json`·캡처 이미지. 상태는 빈 템플릿만 배포한다.
