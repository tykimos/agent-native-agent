# ANA 오프라인판 (Windows x64) — 설치와 사용

[English](offline.md) · **한국어**

인터넷, LLM(AI 에이전트), tmux 없이 Windows PC 한 대에서 도는 ANA입니다. Node 실행 파일이 함께 들어 있어서 따로 설치할 것이 없습니다.

## 들어 있는 것 / 빠진 것

| 쓸 수 있음 | 꺼져 있음 (AI 에이전트나 인터넷이 필요) |
|---|---|
| **Workspace**: 할일 · 일정 · 메모, 워크스페이스 여러 개 | 채팅, Chip·그리기 |
| 항목 사이 관계(→ Task / → Event / ＋ Link), 관계 칩 | Relations › Analyze, Open in OntoAir |
| **Workspace**: Knowledge(흐름 그림, 흐름이 끊긴 곳, 지난 분석 결과 보기, .ttl 내려받기), Files(업로드·다운로드) | Health의 에이전트 점검(Security만 보임) |
| **System**: Roadmap(요구사항 적기), Health | Inbox(에이전트 요청), Roadmap의 Check all · Ask the agent · Check for updates |

## 설치

1. `ANA-offline-win-x64-<버전>.zip`을 USB 등으로 대상 PC에 옮깁니다.
2. (선택) 받은 파일이 맞는지 확인합니다. PowerShell에서 `Get-FileHash .\ANA-offline-win-x64-<버전>.zip`을 실행해 함께 준 `.sha256` 값과 같은지 봅니다.
3. zip을 마우스 오른쪽 버튼으로 누르고 **속성**을 엽니다. 아래에 **차단 해제**가 있으면 체크하고 확인을 누릅니다. 인터넷에서 받은 zip이라 표시가 붙어 있으면, 풀었을 때 실행이 막힐 수 있기 때문입니다.
4. 원하는 곳에 압축을 풉니다. 예: `C:\ANA`. 한글이나 공백이 있는 경로도 괜찮습니다. Program Files처럼 쓰기 권한이 없는 곳은 피하세요.

설치 프로그램이나 관리자 권한은 필요 없습니다. 폴더를 지우면 제거됩니다.

## 실행

- **`start.bat`을 더블클릭**하면 검은 창이 뜨고, 잠시 뒤 기본 브라우저에 `http://127.0.0.1:8809/`가 열립니다.
- 처음 실행하면 Windows 방화벽이나 SmartScreen이 물을 수 있습니다.
  - ANA는 이 PC 안(127.0.0.1)에서만 열리므로 외부 네트워크 허용은 필요 없습니다. 방화벽 창은 **취소**해도 됩니다.
  - SmartScreen이 막으면 **추가 정보 → 실행**을 누릅니다. `node\node.exe`는 OpenJS Foundation이 서명한 공식 Node 24 LTS입니다.
- **끄기**: 검은 창을 닫거나 그 창에서 `Ctrl+C`를 누릅니다.
- 처음 실행하면 예시 메모·할일·일정이 들어 있습니다. 빈 상태로 시작하려면 처음 실행 **전에** `start.bat`의 `set ANA_OFFLINE=1` 아래 줄에 `set ANA_SEED=0`을 추가합니다.

## 폴더 구성

```
ANA-offline-win-x64-<버전>\
  start.bat        실행
  node\node.exe    Node 24 LTS (포터블)
  app\             ANA 프로그램 (server.js, dashboard.html, node_modules …)
  data\            내 데이터 — 첫 실행 때 생김 (state.json, analysis.json, graph.sqlite …)
  files\           System › Files에 올린 파일
  INSTALL-KO.txt · INSTALL-EN.txt · VERSION.txt
```

## 백업 · 옮기기 · 업그레이드

- **백업**: ANA를 끈 뒤 `data` 폴더와 `files` 폴더를 복사해 둡니다.
- **다른 PC로 옮기기**: 폴더 전체를 복사합니다.
- **새 버전으로 바꾸기**: ANA를 끄고 새 zip을 다른 곳에 풉니다. 그다음 기존 `data` 폴더와 `files` 폴더를 새 폴더로 옮기고 새 `start.bat`으로 실행합니다.
- `graph.sqlite`는 `state.json`에서 다시 만들어지는 색인이라 지워도 괜찮습니다.

## 자주 묻는 것

- **"포트 8809 이미 사용 중"으로 꺼질 때**: `start.bat`을 메모장으로 열어 `set PORT=8809`를 `8810` 등 다른 숫자로 바꿉니다.
- **브라우저가 자동으로 안 열릴 때**: 직접 `http://127.0.0.1:8809/`를 엽니다. 최신 Edge나 Chrome을 권장합니다.
- **같은 네트워크의 다른 PC에서 쓰고 싶을 때**: `start.bat`의 `set BIND=127.0.0.1`을 `set BIND=0.0.0.0`으로 바꾸면 됩니다. 다만 **로그인 없이 누구나 읽고 쓸 수 있게 되므로** 믿을 수 있는 내부망에서만 쓰세요. System › Security가 위험으로 표시합니다.
- **지난 분석 결과**: 온라인 ANA에서 만든 `data`를 옮겨 오면 Relations에서 온톨로지와 지식그래프를 볼 수 있고 `.ttl`로 내려받을 수 있습니다. 새 분석은 AI 에이전트가 있어야 해서 오프라인판에서는 할 수 없습니다.

## 패키지 만들기 (개발자용)

인터넷이 되는 Mac/Linux에서 저장소 루트에서 실행합니다(`npm install`을 한 상태여야 함).

```bash
node scripts/package-offline.mjs     # → dist/ANA-offline-win-x64-<버전>.zip (+ .sha256)
```

- 스크립트는 nodejs.org에서 Windows용 Node(기본 `v24.22.0`)를 받아 SHA-256을 확인합니다. 그다음 실행에 필요한 파일과 `node_modules`만 담고, `start.bat`과 이 안내서를 넣어 zip으로 묶습니다.
- 버전을 바꾸려면 `NODE_DIST_VERSION=v24.x.y`를 지정합니다.
- 오프라인 모드는 `ANA_OFFLINE=1`로 켭니다. 동작은 이렇습니다.
  - 서버가 페이지에 `data-offline`을 붙여 에이전트 화면을 숨깁니다.
  - tmux 폴링을 멈춥니다.
  - 인터넷이나 에이전트가 필요한 라우트(`/api/limits`, `/api/update/*`, `/api/analysis/start`, `/api/requirements/analyze` 등)는 503으로 거절합니다.
