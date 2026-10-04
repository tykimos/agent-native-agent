# 변경 기록

ANA의 주요 변경 사항입니다. 버전은 `.claude-plugin/plugin.json`의 Claude Code 플러그인 버전을 따릅니다.
[English](CHANGELOG.md) · **한국어**

이미 쓰고 있는 ANA에 이 변경을 반영하려면 [`ana-update`](skills/ana-update/SKILL.md) 스킬을 쓰세요. 그 ANA를 이 저장소와 기능 단위로 비교하고, 고른 것만 이식합니다.

## [0.4.1] — 미출시

모든 ANA에 같은 이름 규칙을 씁니다. 폴더가 이름을 정하고, 이름이 tmux 세션을 정합니다.

### 변경

- **폴더 → ANA 이름.** 모든 ANA는 `~/ana/<xxx>-ana`(또는 `/ana/<xxx>-ana`)에 설치하고, 폴더명이 ANA의 이름입니다. `<xxx>`에는 하이픈이 들어가도 됩니다. 이 저장소의 샘플은 `base-ana`이며 `~/ana/base-ana`에 설치합니다. 폴더명이 `-ana`로 끝나지 않으면 `base-ana`로 보고, `ANA_NAME`으로 덮어쓸 수 있습니다.
- **기본 tmux 세션이 `<이름>-claude`입니다**(이전 `ana`). 예: `base-ana-claude`. `TMUX_SESSION`은 그대로 우선하므로 기존 배포는 세션이 바뀌지 않습니다.
- **채팅의 세션 목록에는 이 ANA의 세션만 보입니다:** `<xxx>-ana-<yyy>`, `yyy`는 에이전트 라벨(`claude`, `codex`, 하이픈이 들어간 아무 라벨). 지금 연결된 세션과 기본 세션은 항상 남습니다. `ANA_TMUX_ALL=1`이면 모든 tmux 세션을 보여 줍니다. `/api/config`와 `/api/health`가 `ana`를 알려 줍니다.
- **설치 스크립트.** `install.sh`와 `install-wsl.ps1`은 `~/ana/base-ana`로 clone합니다. `run.sh`와 `check-env.sh`는 폴더에서 세션 이름을 정하고, `run.sh`의 서버 세션은 `srv-<세션>`이라 채팅 목록에 뜨지 않습니다. `<세션>-server`로 떠 있는 기존 서버는 그대로 이어 씁니다.
- `channel-core.js`가 `anaNameOf`, `defaultSession`, `isAnaSession`을 내보냅니다.
- README, `install` 스킬, `ana` 스킬을 새 경로·세션 이름으로 고치고 짧은 "이름 규칙" 절을 넣었습니다.

## [0.4.0] — 2026-10-02

base가 코딩 에이전트와 함께 운영하는 1인 업무 보드가 되었습니다. 화면은 세 영역으로 나뉘고, 채팅은 Claude 앱과 같은 모습입니다. 이미 있는 ANA에도 이 기능들을 가져갈 수 있는 스킬이 함께 들어갑니다.

### 추가

- **세 영역.** 휴대폰은 하단 메뉴, PC는 로고 옆 전환 버튼입니다.
  - **Workspace:** Tasks · Calendar · Notes와 워크스페이스 콤보
  - **Collaborate:** Evolve · Approvals · Requests. 배지는 나를 기다리는 것의 수입니다.
  - **System:** Stats · Relations · Reliability · Safety · Security. 배지는 위험 점검의 수입니다.
- **NodeRel 관계.** 메모·할일·일정을 `SPAWNED`, `SCHEDULED_AS`, `REFERS_TO`로 잇고, `DUE_ON` / `ON` 날짜 관계는 자동으로 만들어집니다.
  - 항목마다 관계 칩이 붙고, 누르면 그 항목으로 이동합니다.
  - **System › Relations**에서 흐름 그래프와 흐름이 끊긴 곳을 보여 줍니다.
  - 새 API: `/api/graph`, `/api/graph/neighbors`, `/api/graph/trace`, `/api/graph/schema`, `/api/link`
  - 진실원천은 그대로 `state.json`이고, `graph.sqlite`는 다시 만들어지는 인덱스입니다.
- **협업.**
  - **진화 제안:** 기능, 데이터, 사용 로그를 근거로 앱이 어떻게 진화하면 좋을지 제안합니다.
  - **승인 요청:** 대기 중인 데이터 변경(diff)과 `approval`, `decision`, `access` 요청
  - **작업 요청:** `action`, `info` 요청
  - 탭마다 "에이전트에게 요청" 버튼이 있습니다. 요청 종류에 `approval`이 새로 생겼습니다.
- **AI 신뢰성 · 안전 · 보안 점검**(`GET /api/trust`). 실제 상태로 계산합니다.
  - **신뢰성:** 에이전트 동작 여부, 구조화된 기록 사용 여부, 도구 실패율, 중단, 요금제 사용량
  - **안전:** 권한 확인을 건너뛰는 실행 옵션, 실제로 실행한 위험 명령
  - **보안:** 바인드 주소, 로그인, CSRF, 토큰 처리, 인증 파일 권한, 메모에 붙여 넣은 비밀값. 비밀값은 값이 아니라 위치만 알립니다.
- **Claude 앱 같은 채팅.**
  - **기록 기반 표시:** 에이전트 자신의 기록(Claude Code 기록, Codex rollout)으로 그립니다(`agent-log.js`). 그래서 말풍선, 마크다운 응답, 접히는 `Ran 3 commands ›` 묶음, 이미지 썸네일이 정확하게 나옵니다.
  - **세션 콤보:** 전체 폭으로 펼쳐지고, 세션마다 대화가 따로 남습니다.
  - **모델 알약:** 실제 모델명을 보여 주고, 누르면 모델·추론 강도 시트가 열립니다. Claude는 `/model`·`/effort`를 보낸 뒤 화면에서 결과를 확인하고, Codex는 Codex 자체 메뉴로 바꿉니다(`codex-settings.js`).
  - **사용량 링:** 5시간·주간. Claude는 로컬 로그인으로 `api/oauth/usage`를 서버에서만 읽고, Codex는 `rate_limits`를 읽습니다.
  - **입력창:** 음성 받아쓰기, 파일 첨부. 떠 있는 입력창에 ↓ 버튼이 있고, iOS 키보드 바로 위에 붙습니다.
- **컨텍스트 칩.** 칩 모드에서 항목을 누르면 다음 메시지에 붙습니다. ✎로 화면에 그리면(빨강·마젠타·파랑) 표시한 캡처가 첨부되고, ⟳는 새 종류의 요소를 칩 대상으로 등록합니다.
- **기존 ANA용 스킬과 업데이트.**
  - 새 스킬: `ana-update`, `chat-window`, `context-chips`, `relations`, `app-shell`, `agent-requests`, `trust-checks`
  - `features.json`에 기능별 앵커가 있습니다. `ana-diff.mjs`가 이를 기준으로 있음/일부/없음, 오래된 모듈, 런타임 차이를 보고하고, 동기화한 커밋을 `.ana-sync.json`에 남깁니다.
  - 플러그인 마켓플레이스: `claude plugin install ana@agent-native-agent`
- `seed.js`: 첫 실행 때 예제 흐름 두 개가 들어갑니다(`ANA_SEED=0`이면 빈 보드로 시작).

### 변경

- Meetings와 Members 탭을 없앴습니다. base는 1인용이고, 로그인은 여전히 게이트웨이 헤더로 할 수 있습니다.
- **Node 24 이상**이 필요합니다(`node:sqlite`).
- README를 세 영역과 스킬 중심으로 다시 쓰고 스크린샷을 새로 넣었습니다(WebP, 합쳐서 약 130KB).

### 수정

- **가짜 질문 카드.** 응답에 "Select model"이나 "Esc to cancel"이 들어 있으면 Claude Code 질문 창으로 오인해 채팅 입력이 막혔습니다. 이제 입력 상자가 보이면 질문 창이 아닌 것으로 보고, 질문 창 표시는 화면 아래 20줄에서 줄 맨 앞에 있을 때만 인정합니다.
- **iOS 끝 당김.** 채팅 끝에서 더 당겨도 채팅창 전체가 밀려 내려가지 않습니다. 키보드가 떠 있을 때만 보이는 영역을 따라가고, 뒤 페이지 스크롤을 막습니다.
- GitHub SSH 키가 없어도 `npm install`이 됩니다(NodeRel을 HTTPS로 받음).
- **전송 상태.** 에이전트가 `[Pasted text]`로 받은 메시지에 "Unconfirmed / Resend"가 뜨던 문제를 고쳤습니다.
- **작은 UI 수정.**
  - 세션 목록에 "You"가 두 번 보이던 문제
  - "New version available" 버튼이 눌리지 않던 문제
  - 세션 팝업이 화면 밖으로 넘치던 문제
  - 처음 열 때 배지 수가 틀리던 문제

## [0.3.0] 이전

`d690eda`까지의 [커밋 기록](https://github.com/tykimos/agent-native-agent/commits/main)을 보세요. 워크스페이스, 칩 모드, install 스킬, 세션별 원장, 구조화된 AskUserQuestion 카드가 들어 있습니다.

[0.4.1]: https://github.com/tykimos/agent-native-agent/compare/v0.4.0...main
[0.4.0]: https://github.com/tykimos/agent-native-agent/compare/d690eda...v0.4.0
[0.3.0]: https://github.com/tykimos/agent-native-agent/commits/d690eda
