---
name: content-studio
description: "Build the CONTENT/DOCUMENT form of an ANA — a document studio where the user WATCHES a rendered document (HTML) in a viewer, PICKS elements to turn them into chips, and CONVERSES so the Claude Code session actually edits the source (md / layout guide / renderer) and calls /api/rerender. Use when the user asks for a '문서 스튜디오', 'content studio', '교재/문서 부분 수정', '요소 집어서 고쳐', '콘텐츠형 ANA', '보면서 문서 편집', '문서 보면서 대화로 고치기', element picking + chips, 영역 캡처, or partial edits to a long document instead of a dashboard. Also triggers on follow-ups: '스튜디오 다시 띄워', '스튜디오 재실행/보완/개선', '칩 상세 더 자세히', '캡처가 안 돼', '재렌더가 안 붙어', '두 번 전송돼', '한글 입력 이상해'. Combine with realtime-mirror-channel (실시간·미러) + uxui-design-system (얼굴)."
---

# 콘텐츠 스튜디오 — 콘텐츠형 ANA (문서를 보면서 대화로 고친다)

대시보드형 ANA(`fakechat-dashboard-agent`)가 **지표를 보면서 운영**한다면, 이 빌딩블록은 **문서를 보면서 부분 수정**한다. 같은 3원칙(watch + converse · agent as runtime · own your harness)을 **콘텐츠 편집**에 적용한 형태다.

- **Watch** = 렌더된 문서(HTML) 뷰어. 왼쪽 전체화면 iframe + 쪽맞춤/폭맞춤/줌.
- **Converse** = 요소를 탭해 만든 **칩** + 채팅(PC 오른쪽 도킹 / 모바일 FAB 팝업).
- **Runtime** = Claude 세션이 **원본(md·조판 가이드·렌더러)을 실제로 수정**하고 `POST /api/rerender` 로 뷰어를 갱신한다.

> 뷰어는 원본을 절대 직접 편집하지 않는다. 화면은 "지목 장치"일 뿐, 편집 권한은 세션에만 있다.

## 언제 쓰나

- 긴 문서(교재·매뉴얼·보고서·제안서·랜딩페이지)를 **부분적으로** 고쳐야 할 때 — "이 표 3행만", "이 문단 어투만".
- 사용자가 **어디를 말하는지 글로 설명하기 어려울 때**(페이지·요소가 많은 문서). 칩이 좌표·selector·앞뒤 문맥을 대신 실어 보낸다.
- 대시보드(지표·큐)가 아니라 **콘텐츠 자체가 상태**일 때. 지표 운영이면 `fakechat-dashboard-agent`를 쓴다.

## 핵심 개념

### 1) 요소 피킹 → 칩
iframe 내부 요소에 hover 아웃라인 → 탭하면 **칩** 생성. 칩은 세션에 전달되는 "정밀 지목 패킷"이다.

```
chip = { page, section, component, text, detail }
detail = { selector: ".page[12] section:nth-of-type(2) > p:nth-of-type(3).body",
           label: "Q3", prev: "앞 요소 요약", next: "뒤 요소 요약", context: "문맥 400자", tag: "p.body" }
```

**Why**: 세션이 "3페이지 두 번째 문단"을 추측하면 오편집한다. selector + 앞/뒤 + 문맥 400자를 함께 주면 **추측 없이** 원본에서 해당 위치를 찾는다.

### 2) 다중 선택 · 영역 캡처
- 클릭 = 단일(기존 선택 비움) · **Shift+클릭 = 다중 토글** · **Option(⌥)+클릭 = 영역 캡처 첨부**.
- 모바일엔 키가 없다 → 입력창 옆 **＋ 토글**(다중) · **칩의 카메라 버튼**(캡처)으로 대체한다. 반드시 둘 다 제공하라.
- 캡처는 헤드리스 Chrome(CDP)이 문서좌표 clip으로 찍어 `att/`에 저장 → 칩 위에 썸네일, 클릭 시 라이트박스.

### 3) 맞춤 · 줌
쪽맞춤(한 쪽이 높이에 맞음) · 폭맞춤 · 100% · ±확대. **원본은 불변**, iframe에 `transform: scale()`만 건다.
- 페이지 **고정폭**을 기준으로 스케일을 계산하라. `scrollWidth`/`offsetLeft`은 뷰포트·가운데정렬에 되먹임돼 "여러 번 눌러야 맞는" 수렴 버그를 만든다.
- **스크롤 앵커링**: 재맞춤/리사이즈 때 상단에 걸린 페이지를 기억·복원해 화면이 튀지 않게 한다.
- iframe 내부 스크롤은 CSS 주입으로 끈다(이중 스크롤 방지).

### 4) 버전 동기화 — `bookVersion` vs `version`
| 필드 | 증가 시점 | 프론트 반응 |
|---|---|---|
| `version` | 모든 상태 변경(메시지·제안 포함) | 피드 폴링 동기화 |
| `bookVersion` | **세션이 `/api/rerender` 호출 시에만** | 문서 iframe 리로드 |

**Why**: 채팅 한 줄마다 iframe을 다시 로드하면 본문이 껌뻑이고 스크롤이 튄다. **문서가 실제로 바뀐 순간에만** 리로드하라.

### 5) 안정성 3종 (빼먹으면 반드시 버그가 난다)
- **IME**: 한글 조합 확정 Enter(`isComposing` / `keyCode 229`)는 전송에서 제외 → 두 번 전송 방지.
- **dedup**: 서버가 직전 user 메시지와 동일 텍스트를 3초 내면 무시(연타·릴레이 재전송 방어).
- **sync epoch**: 서버 부팅 시각을 `/api/feed`의 `sync`로 내려보내고, 값이 바뀌면 클라가 피드를 초기화한 뒤 `since=0`부터 다시 받는다(스테일 `since`로 새 메시지를 영영 놓치는 문제 방지).

## API 계약

| Endpoint | Method | Body/Query | 용도 |
|---|---|---|---|
| `/` `/studio.html` `/studio.js` `/document.html` | GET | — | 정적(토큰 불요) |
| `/att/<file>` | GET | — | 캡처·첨부 이미지 서빙 |
| `/api/state` | GET | — | `{version, bookVersion, book, page}` |
| `/api/feed` | GET | `?since=<id>` | `{version, sync, messages[], proposals[], status}` (2.5초 폴링) |
| `/api/chat` | POST | `{text, chips[]}` | 사용자 입력 → 피드 + inbox(3초 dedup) |
| `/api/inbox-wait` | GET | — | 브리지 롱폴(≤25s) |
| `/api/agent` | POST | `{text, proposal?}` | 세션의 리치 응답(텍스트/제안 카드) |
| `/api/activity` | POST | `{role, kind, text}` | **미러 게시**(kind: `text`/`activity`) |
| `/api/status` | POST | `{text}` | 상단 '작성 중…'(60s TTL) |
| `/api/approve` | POST | `{id, decision, reason}` | 제안 승인/반려 → inbox(decision) |
| `/api/capture` | POST | `{x, y, w, h}` | 문서좌표 영역 캡처 → `{url}` |
| `/api/rerender` | POST | — | `bookVersion++` → 뷰어 리로드 |
| `/api/page` | POST | `{page}` | 페이지 동기화 |

`STUDIO_TOKEN`이 설정되면 `/api/*`는 `Authorization: Bearer` 또는 `?token=`을 요구한다(정적·`/att`는 불요).

## 세션(두뇌)이 하는 일 — 5단계

fakechat으로 `[스튜디오] [칩…] 메시지`가 도착하면:

1. **정확히 지목한다** — 칩의 `selector`·`label`·`prev`/`next`·`context`로 원본의 위치를 특정. 추측 금지, 애매하면 되묻는다.
2. **원본을 고친다** — 렌더 결과(HTML)가 아니라 **소스**(md 본문 · 조판/스타일 가이드 · 렌더러 코드)를 수정한다. 렌더 산출물만 고치면 다음 렌더에서 되돌아간다.
3. **큰 수정은 제안 먼저** — `POST /api/agent {proposal:{title,summary,before,after,diff,chips}}` → 승인 카드 → `/api/approve` decision이 inbox로 오면 적용.
4. **재렌더 후 `POST /api/rerender`** — 문서 HTML이 실제로 바뀐 경우에만. 채팅만으로는 절대 호출하지 않는다.
5. **평소처럼 답한다** — 미러 훅이 입력·도구활동·응답을 화면에 그대로 띄운다(별도 응답 도구 불필요).

## 설치 · 구동 (요약)

1. `references/`의 `studio-server.mjs` · `studio.html` · `studio.js` · `studio-capture.mjs` · `run-studio.sh`를 프로젝트의 `studio/`로 복사하고, `studio-state.template.json`을 `studio-state.json`으로 복사한다.
2. **프로젝트별 설정 블록 4곳만 교체**한다(각 파일 상단 `▼▼ 프로젝트별 설정 ▼▼`):
   - `studio-server.mjs`: `DOC_FILE`(문서 HTML 실제 경로) · `DOC_ROUTE` · `DOC_NAME`
   - `studio.js`: `DOC_URL` · `DOC_NAME` · `ANCHOR_RE` · `sectionOf()` · `componentOf()` — 문서 도메인에 맞는 라벨링
   - `studio.html`: `<title>` · iframe `src`(= `DOC_ROUTE`)
   - `run-studio.sh`: 포트 · `STUDIO_DOC` · `STUDIO_CONFIG_DIR` · `NODE_BIN`
3. 문서 HTML은 **페이지마다 `.page` 요소**를 갖도록 렌더한다(피킹·페이지 계산·selector가 이 구조에 의존).
4. `secrets.env`에 `STUDIO_TOKEN=<랜덤>`을 넣고 `run-studio.sh` 실행. 상시 구동·외부 공개는 `references/deployment.md`.
5. 인바운드 대화 활성 조건: 세션이 **격리 포트의 fakechat 채널**로 떠 있어야 한다 → `realtime-mirror-channel`.

## 토큰 · 자격증명 원칙

- **자격증명 미포함**: 이 스킬의 어떤 파일에도 토큰·봇키·chat_id·실데이터를 넣지 않는다. `STUDIO_TOKEN`은 실행 시 `secrets.env`에서 읽고, 코드엔 이름만 존재한다.
- 상태 파일은 **빈 템플릿**(`studio-state.template.json`)만 배포한다. 라이브 `studio-state.json`(대화·첨부)과 `studio-link.txt`(토큰 포함 링크)는 커밋 금지.
- 무인증 공개는 금지 — 터널로 노출할 땐 토큰 게이트를 반드시 켠다.

## 다른 빌딩블록과의 조합

| 스킬 | 역할 | 이 스킬과의 관계 |
|---|---|---|
| **`realtime-mirror-channel`** | 실시간·미러 | 인바운드 릴레이(`studio-bridge.mjs`)와 미러 훅(`mirror-hook.mjs`)을 **그 스킬이 제공**한다. 여기엔 중복 배치하지 않는다. `/api/chat → inbox → 채널 → 세션`과 `세션 활동 → /api/activity`가 그 스킬의 배선이다. |
| **`uxui-design-system`** | 얼굴 | 채팅 말풍선·칩·바텀시트·FAB·토스트를 토큰으로 통일. 색/라운드 하드코딩 금지, 모바일 키보드는 `VisualViewport`. |
| **`fakechat-dashboard-agent`** | 형제(대시보드형) | 같은 `/api/chat`·`/api/agent`·`/api/approve` 계약을 공유한다. **지표 운영이면 그쪽, 문서 부분수정이면 이쪽.** |

## 안티패턴 (하지 말 것)

- 칩 없이 "3페이지 문단 고쳐줘"만 보내기 → 오편집. 칩을 필수 컨텍스트로 취급하라.
- 렌더된 HTML만 직접 수정 → 다음 렌더에서 소실.
- 채팅 메시지마다 `/api/rerender` 호출 → 본문 껌뻑임·스크롤 튐.
- 뷰어에 편집 UI(contenteditable) 추가 → 원본과 이중 진실. 편집은 세션만.
- SSE만 믿기 → 터널이 `text/event-stream`을 버퍼링한다. 폴링을 항상 병행.
- IME/dedup/sync-epoch 생략 → 이중 전송·메시지 유실.

## 참고 파일

- [`references/content-studio-architecture.md`](references/content-studio-architecture.md) — 큰 그림·구성요소·프론트 기능 상세·API 계약·세션 역할
- [`references/deployment.md`](references/deployment.md) — LaunchAgent·터널·훅 설치 절차
- [`references/studio-server.mjs`](references/studio-server.mjs) — 서버(의존성 0) · [`references/studio.html`](references/studio.html) · [`references/studio.js`](references/studio.js) — 프론트
- [`references/studio-capture.mjs`](references/studio-capture.mjs) — 영역 캡처 · [`references/studio-state.template.json`](references/studio-state.template.json) — 빈 상태 · [`references/run-studio.sh`](references/run-studio.sh) — 구동
- 릴레이/미러: `skills/realtime-mirror-channel/references/studio-bridge.mjs`, `.../mirror-hook.mjs` (여기 중복 없음)
