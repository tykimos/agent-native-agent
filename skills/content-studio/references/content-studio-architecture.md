# 콘텐츠 스튜디오 — 아키텍처 상세

Claude Code 세션을 **런타임(두뇌)** 으로 삼아, 문서(HTML)를 **보면서(watch)** 요소를 집어 **대화로(converse)** 고치는 agent-native 운영 화면.

## 1. 큰 그림

```
 [사용자 브라우저 :8791]  ── 요소 탭=칩 + 채팅 ──►  /api/chat → inbox
     ▲ 폴링(피드·버전·상태 2.5~3s)                    │ bridge 롱폴(/api/inbox-wait)
     │                                                ▼
  ANA 채팅(PC 오른쪽 도킹 / 모바일 팝업)        fakechat 채널(격리 포트) ──► [Claude 세션(두뇌)]
     ▲ 미러(사용자입력·도구활동·응답)                         │  md/조판가이드/렌더 실제 수정
     │                                                       ▼
   /api/activity ◄──── 미러 훅 ──── 세션 활동            /api/rerender (문서 리로드)
```

- **Watch**: 왼쪽에 문서 HTML 전체를 iframe으로 띄우고 폭/쪽맞춤·줌으로 본다.
- **Converse**: 요소를 탭해 '칩'으로 집고, 오른쪽(PC)·팝업(모바일) 채팅으로 수정을 지시한다.
- **Runtime**: 실제 수정은 Claude 세션이 소스(md·조판 가이드·렌더러)를 고쳐 반영한다.
- **Mirror**: 세션에서 일어나는 모든 것(입력·도구·응답)이 채팅에 실시간으로 뜬다(미러 훅).

## 2. 구성요소

| 파일 | 포트 | 역할 |
|---|---|---|
| `studio-server.mjs` | 8791 | 뷰어 서빙 + 채팅 브리지 API + 이미지(`/att`) + 캡처 스폰. 의존성 0(Node 내장). 상태 `studio-state.json`(version·bookVersion·messages·inbox·proposals·status). |
| `studio.html` + `studio.js` | — | 프론트. 요소 피킹·칩·맞춤/줌 툴바·ANA 채팅·이미지 썸네일·라이트박스. |
| `studio-capture.mjs` | — | 요소 영역을 헤드리스 Chrome(CDP)으로 clip 캡처해 `att/`에 저장(서버가 `/api/capture`로 스폰). |
| `run-studio.sh` | — | 서버 + 브리지 상시 구동(LaunchAgent가 호출). `STUDIO_TOKEN`을 `secrets.env`에서 주입. |
| `studio-bridge.mjs` | — | 인바운드/아웃바운드 릴레이(스튜디오 ↔ fakechat). **→ `realtime-mirror-channel` 빌딩블록 제공(여기 중복 없음).** |
| 미러 훅 `mirror-hook.mjs` | — | UserPromptSubmit / PostToolUse / Stop → `/api/activity`. **→ `realtime-mirror-channel` 제공.** |
| `content-studio.plist` | — | LaunchAgent(KeepAlive·RunAtLoad). |
| `studio-tunnel-run.sh` | — | 스튜디오 포트 전용 Cloudflare quick tunnel(외부 접속). |

### 기술 스택
| 계층 | 기술 |
|---|---|
| 프론트 | 바닐라 JS/HTML/CSS(프레임워크 0), iframe + `transform:scale`, `fetch` 폴링, 초경량 마크다운 렌더러 |
| 서버 | Node.js 내장 모듈만(`http`/`fs`/`path`/`child_process`) — 의존성 0, long-poll, JSON 파일 상태 |
| 캡처 | Node 22 전역 `fetch`/`WebSocket`으로 CDP 구동 → 헤드리스 Chrome `Page.captureScreenshot`(clip) |
| 인바운드 | fakechat WS 채널(격리 포트) — `realtime-mirror-channel` |
| 공개 | cloudflared 퀵터널 + `STUDIO_TOKEN` 게이트 |

## 3. 프론트엔드 기능 상세

### 3.1 요소 피킹 → 칩
- iframe 내부 요소에 hover 아웃라인 → 탭하면 칩 생성. 칩 = `{page, section, component, text, detail}`.
- **선택 모드**: 클릭 = 단일(기존 비움) · **Shift+클릭 = 다중 토글** · **Option(⌥)+클릭 = 영역 캡처 첨부**.
  모바일은 키가 없으므로 입력창 옆 **＋ 토글**(다중), **칩의 카메라 버튼**(캡처)으로 대체.
- **칩 상세(ⓘ)**: `component` · 라벨(ANCHOR_RE로 뽑은 근처 앵커) · 선택 텍스트 · 앞/뒤 요소 요약 · 문맥 400자 · DOM selector(`.page[n] … > tag:nth-of-type(k).class`)를 수집·표시 → 세션이 대상을 정밀 지목.
- 선택 영역은 iframe에 `.sel` 클래스로 지속 하이라이트. 칩은 **채팅 입력부에만** 표시(본문 오버레이 없음 → 문서 가림 방지).
- 피킹 대상은 `.page` 하위의 `SECTION/DIV/LI/P/TR/TABLE/SPAN/H1~4` 중 텍스트가 있는 요소로 좁힌다(최대 6단계 상향 탐색).

### 3.2 맞춤 / 줌 툴바
- 쪽맞춤(한 쪽이 높이에 맞음) · 폭맞춤 · 100% · ±확대. `fit()`이 mode별 스케일 + 가로 가운데 정렬.
- 문서 원본 불변, iframe만 `transform: scale(S)`. stage 높이를 `natH * S`로 맞춰 스크롤 길이를 보존.
- **페이지 고정폭 기준**으로 스케일 계산 — `scrollWidth`/`offsetLeft`은 뷰포트·`overflow:hidden`·가운데정렬에 되먹임돼 "여러 번 눌러야 맞는" 수렴 버그를 만든다.
- **스크롤 앵커링**: 재맞춤/리사이즈 시 상단에 걸린 페이지 인덱스 + 페이지 내 비율을 기억·복원.
- iframe 내부 `html,body{overflow:hidden}`을 주입해 이중 스크롤 제거.

### 3.3 ANA 채팅
- 사용자 말풍선 / 어시스턴트 말풍선(마크다운) / 회색 도구활동 카드 / 상단·하단 '작성 중…' 인디케이터.
- **모바일**: 우측하단 원형 FAB → 오버레이 시트(배경 스크롤 위치 보존). **PC**: 오른쪽 도킹(상시). 위치·버전은 사이드바 헤더(`#loc`)에 `문서명 · 섹션 · p현재/전체`.
- 이미지: 칩 캡처·첨부를 칩 위에 칩 너비 썸네일로, 클릭 시 라이트박스. 서버 `/att/` 서빙.
- 도구활동은 연속 항목을 하나의 `act-group`으로 묶어 피드 폭주를 막는다(서버도 최근 400건만 유지).

### 3.4 버전 동기화
- `bookVersion`이 바뀔 때만 문서 iframe 리로드(`DOC_URL?v=bookVersion`). 채팅 메시지의 `version++`로는 리로드하지 않는다 → 본문 껌뻑임 방지.
- 세션이 문서를 실제 편집·재렌더한 뒤 `POST /api/rerender`로 `bookVersion++`.

### 3.5 입력 안정성
- **IME**: 한글 조합 확정 Enter(`isComposing` / `keyCode 229`) 제외 → 두 번 전송 방지. 전송 중 플래그로 연타 차단.
- **dedup**: 서버가 직전 user 메시지와 동일 텍스트를 3초 내면 무시.
- **sync epoch**: 서버 부팅 시각을 `/api/feed.sync`로 내려보내고, 값이 바뀌면 클라가 피드를 비우고 `since=0`부터 재수신.

## 4. API 계약

| Endpoint | Method | Body/Query | 용도 |
|---|---|---|---|
| `/` `/studio.html` `/studio.js` `/document.html` | GET | — | 정적(토큰 불요) |
| `/att/<file>` | GET | — | 이미지 서빙(캡처·첨부) |
| `/api/state` | GET | — | `{version, bookVersion, book, page}` |
| `/api/feed` | GET | `?since=<id>` | `{version, sync, messages[], proposals[], status}` (폴링) |
| `/api/chat` | POST | `{text, chips[]}` | 사용자 입력 → 피드 + inbox(동일텍스트 3초 dedup) |
| `/api/inbox-wait` | GET | — | 브리지 롱폴(≤25s) |
| `/api/agent` | POST | `{text, proposal?}` | 세션 리치 응답(텍스트/제안 카드) |
| `/api/activity` | POST | `{role, kind, text}` | 미러 게시(role: user/assistant/system, kind: text/activity) |
| `/api/status` | POST | `{text}` | 상단 '처리 중…'(60s TTL) |
| `/api/approve` | POST | `{id, decision, reason}` | 제안 승인/반려 → inbox(decision) |
| `/api/capture` | POST | `{x, y, w, h}` | 문서좌표 영역 캡처(studio-capture 스폰) → `{url}` |
| `/api/rerender` | POST | — | `bookVersion++` → 뷰어 문서 리로드 |
| `/api/page` | POST | `{page}` | 페이지 동기화 |

토큰: `STUDIO_TOKEN`(secrets.env)이 설정되면 `/api/*`는 `Authorization: Bearer` 또는 `?token=` 필요(정적·`/att`은 불요).

### 상태 머신
- 제안(proposal): `pending → approved | rejected` → inbox의 `{kind:'decision'}`으로 세션에 전달 → 세션이 실제 적용.
- 메시지(role): `user` | `agent`/`assistant` | `system`, `kind`: `text` | `activity`.

## 5. 세션(두뇌)이 하는 일

fakechat으로 `[스튜디오] [칩…] 메시지`가 오면:

1. 칩(섹션·페이지·컴포넌트·텍스트 + 상세 위치정보 = selector·앞/뒤·문맥)으로 대상을 **정확히 지목**한다(추측 금지).
2. **소스**(md 본문 · 조판/스타일 가이드 · HTML 렌더러)를 실제 수정한다. 승인이 필요한 큰 수정은 `/api/agent`로 before/after·diff proposal → `/api/approve` decision 후 적용.
3. 문서 HTML이 실제로 바뀌면 `POST /api/rerender`로 뷰어 리로드(채팅만으로는 리로드하지 않는다).
4. 반려면 사유를 반영해 재제안한다. 질문·조회는 `/api/agent {text}`로 바로 답한다.
5. 그냥 평소처럼 답하면 미러 훅이 화면에 그대로 표시한다(별도 응답 도구 불필요).

## 6. 문서 렌더 규약 (뷰어가 기대하는 구조)

- 페이지 단위 요소에 **`.page` 클래스**가 있어야 한다 — 페이지 번호 계산 · selector 접두어 · 쪽맞춤이 여기에 의존.
- 페이지 폭은 **고정폭**(예: 148mm ≈ 559px)이 바람직하다(스케일 수렴 안정).
- 요소에 의미 있는 class를 남기면 selector 정밀도와 세션의 원본 매칭률이 올라간다.
