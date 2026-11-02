<div align="center">

<img src="docs/assets/ana-logo.png" width="92" alt="ANA logo" />

# ANA — Agent‑Native Agent

### 보면서 대화하는 것만으로 운영하는 앱을 만드세요.

> **두 에디션.** **Agent-Native Agent**(이 저장소, AGPL)는 간소한 판입니다. 코딩 에이전트와의 채팅과 탭 여섯 — PRD, Work(할일·캘린더·메모와 그 연결), Knowledge, Requests, Evolve, Update가 있습니다. **Agent-Native Agent Pro**(상용)는 여기에 일에서 쌓이는 지식 층(분석, 지식그래프, 규칙이 있는 온톨로지), Graph 화면, 관리자·실무자 역할이 있는 System 범위와 Roadmap·Health, 여러 워크스페이스, 세션별 Claude 계정, 오프라인판을 더합니다. Pro 문의: [COMMERCIAL.ko.md](COMMERCIAL.ko.md).

[![Stars](https://img.shields.io/github/stars/tykimos/agent-native-agent?style=for-the-badge&logo=github&color=CC785C)](https://github.com/tykimos/agent-native-agent/stargazers)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-1f6feb?style=for-the-badge)](LICENSE)
[![Built for Claude Code](https://img.shields.io/badge/built%20for-Claude%20Code-CC785C?style=for-the-badge)](https://claude.com/claude-code)
[![Zero-dependency runtime](https://img.shields.io/badge/runtime_dependencies-0-111?style=for-the-badge)](channel-core.js)
[![Last commit](https://img.shields.io/github/last-commit/tykimos/agent-native-agent?style=for-the-badge&color=64748b)](https://github.com/tykimos/agent-native-agent/commits/main)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-22c55e?style=for-the-badge)](#contributing)

[English](README.md) · **한국어**

<br/>

![ANA — 대시보드를 보며 대화하면 앱이 진화한다](docs/assets/dashboard-ana.webp)

</div>

---

## 요약(TL;DR)

**ANA는 _Agent‑Native Lifestyle_(ANL)을 위한 _Agent‑Native Agent_입니다.** 실시간 대시보드를 **보면서(watch)**, 런타임 역할을 하는 코딩 에이전트와 **대화하는(converse)** 것만으로 운영하는 셀프‑호스팅 앱입니다. 새로운 동작이 필요하신가요? 한 번 말하기만 하면 됩니다 — ANA가 변경안을 제안하고, 승인 시 적용하며, 런타임에서 앱을 진화시킵니다. PR도, 배포 단계도 없습니다 — 실행 중인 에이전트가 앱을 즉석에서 다시 쓰고 대시보드가 새로고침됩니다.

> 사용 = 제작. 그것이 핵심의 전부입니다.

---

## 어시스턴트가 아니라 에이전트인 이유

어시스턴트는 지시를 기다립니다. 에이전트는 판단하고, 실행하며, 당신의 업무를 둘러싼 도구를 스스로 개선합니다. 오늘날 모든 도구는 여전히 **사용하기**와 **만들기** 사이의 절충을 강요합니다 — ANA는 그 간극을 없앱니다.

|  | SaaS / 앱 | No‑code | 챗봇 | 코딩 에이전트 | **ANA** |
|---|:---:|:---:|:---:|:---:|:---:|
| 즉시 사용 | ✅ | ✅ | ✅ | ❌ | ✅ |
| *무엇이든* 변경 | ❌ | ⚠️ 정해진 범위 내 | ❌ | ✅ | ✅ |
| 실시간 데이터를 봄 | ✅ | ✅ | ⚠️ | ⚠️ | ✅ |
| **사용하면서 바로 변경 — 같은 대화에서** | ❌ | ❌ | ❌ | ⚠️ | ✅ |
| 완전한 소유(셀프‑호스팅) | ❌ | ❌ | ❌ | ✅ | ✅ |

SaaS는 *즉시 쓸 수 있지만 고정*되어 있습니다. 코딩 에이전트는 *무한히 유연하지만 빌드 타임 전용* — 만든 뒤에 씁니다. **ANA는 앱을 사용하는 행위(말하기)를 곧 만드는 행위(동작 변경)와 동일하게 만듭니다.** 에이전트가 런타임에 네이티브로 존재하기 때문입니다.

---

## 세 가지 원칙

1. **Watch + Converse** — 시각적 상태와 대화가 *하나의* 화면 안에 함께 있습니다. 고정된 UI를 클릭하는 대신, 보고 말하는 것으로 운영합니다.
2. **Agent as Runtime** — 에이전트가 당신의 데이터를 읽고, 행동하며, 요청 시 **앱 자체의 코드를 다시 씁니다**. 추론(inference)이 곧 런타임입니다.
3. **Own Your Harness** — 의존성 없이, 셀프‑호스팅으로, 영원히 당신의 것입니다. 당신과 함께 계속 진화합니다.

이 원칙들은 이 하네스로 만든 모든 ANA의 수용 기준이기도 합니다.

---

## 작동 방식

```mermaid
flowchart TB
  subgraph UX["Watch + Converse (브라우저)"]
    direction LR
    U["사용자"] <--> D["대시보드"]
  end

  subgraph RT["ANA 런타임 — 한 파일: channel-core.js"]
    direction LR
    S["서버"] -->|"paste-buffer + Enter"| A["코딩 에이전트 · tmux"]
    A -->|"capture-pane · 300ms"| S
  end

  D -->|"POST /api/chat"| S
  S -->|"SSE /api/stream + 제안"| D
```

**브리지도 MCP도 없습니다.** 브라우저가 서버로 보내면, 서버가 그 텍스트를 tmux 페인에 곧바로 주입하고, 300ms `capture-pane` 루프가 세션을 append-only 원장으로 되비춰 SSE로 내보냅니다. 리치 응답의 경우 에이전트가 **제안**(전/후 + 승인 카드)을 올리고, 승인하면 서버가 diff를 적용한 뒤 `version`을 올려 모든 기기가 다시 동기화됩니다. 에이전트가 구조화된 기록을 남기면(Claude Code, Codex) 채팅은 화면 대신 그 기록으로 그려서, 응답과 도구 실행이 정확하게 보입니다. **코딩 에이전트가 곧 백엔드입니다** — 말하는 것으로 앱을 키웁니다.

---

## 설치 없이 시작 — GitHub Codespaces

PC에 WSL·Node·tmux를 설치하지 않고 브라우저에서 ANA를 실행합니다. GitHub 계정과 Claude Code 사용 권한이 필요하며, 최초 한 번 Claude에 로그인합니다.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/tykimos/agent-native-agent?ref=main)

**[브라우저 시작 매뉴얼](docs/codespaces.ko.md)** — 환경 자동 설치 → Ports의 **ANA / 8809** 열기 → ANA 채팅에서 Claude 초기 설정. 포트는 **Private**으로 유지합니다. Codespaces 사용량은 Claude 이용료와 별도로 계산되며, Codespace가 중지되면 ANA도 멈춥니다.

## 빠른 시작 — 베이스 실행 (2분)

**사전 요구사항:** Node ≥ 24, tmux, 그리고 코딩 에이전트 CLI(예: [Claude Code](https://claude.com/claude-code)). 런타임(`channel-core.js`)은 의존성이 없고, 베이스 앱은 [NodeRel](https://github.com/tykimos/NodeRel) 하나를 `npm install`로 GitHub에서 받습니다.

### `install` 스킬로 설치·실행 (권장)

**[`install` 스킬](skills/install/SKILL.md)** 하나로 빈 머신에서 대시보드가 뜨는 데까지 갑니다. 먼저 환경을 분석하고, 빠진 것(Node ≥ 24, tmux, git, curl, Claude Code)과 npm 의존성만 설치한 뒤, 에이전트와 서버를 tmux로 띄우고 응답을 확인합니다. 모든 스크립트는 여러 번 실행해도 안전합니다.

```bash
git clone https://github.com/tykimos/agent-native-agent ~/ana/base-ana && cd ~/ana/base-ana
bash skills/install/scripts/check-env.sh   # 1) 환경 분석 — 보고만 하고 아무것도 바꾸지 않음
bash skills/install/scripts/install.sh     # 2) 빠진 것만 설치 (brew / apt / dnf / pacman …)
bash skills/install/scripts/run.sh         # 3) tmux "base-ana-claude"(에이전트) + "srv-base-ana-claude"(서버) → URL 출력
bash skills/install/scripts/run.sh status  #    이후: status | stop | restart
```

| 스크립트 | 역할 |
|---|---|
| `check-env.sh` | macOS / Linux / WSL / Git Bash를 판별하고 node·tmux·git·curl·claude·저장소 위치·포트를 점검. 마지막 줄에 `ANA_ENV … ready=yes\|no` |
| `install.sh` | 빠진 것만 설치(macOS는 Homebrew, Linux/WSL은 시스템 패키지 관리자 + NodeSource)하고 Claude Code CLI 설치, 저장소 밖에서 실행하면 clone까지 |
| `run.sh` | tmux 세션을 띄우거나 재사용, 8809가 사용 중이면 빈 포트를 고르고 응답 확인. `ANA_NAME`·`TMUX_SESSION`·`PORT`·`AGENT_CMD`로 변경 가능 |
| `install-wsl.ps1` | **Windows:** tmux는 WSL 안에서만 동작합니다. WSL + Ubuntu를 설치(재부팅 후 다시 실행)한 뒤 WSL 안에서 ANA를 설치·실행. Windows 브라우저에서 `http://localhost:8809`로 접속 |

```powershell
# Windows (PowerShell, 첫 실행만 관리자 권한)
powershell -ExecutionPolicy Bypass -File skills\install\scripts\install-wsl.ps1
```

Claude Code에 스킬이 설치돼 있으면(이 저장소는 플러그인입니다) *"ANA 설치해줘"* 라고만 하면 됩니다. 에이전트가 같은 단계를 수행하고, 최초 1회 Claude 로그인(`tmux attach -t base-ana-claude` → `Ctrl-b d`로 빠져나오기)이 필요할 때 알려 줍니다.

### 수동 실행

```bash
git clone https://github.com/tykimos/agent-native-agent ~/ana/base-ana
cd ~/ana/base-ana

# 1) tmux 안에서 코딩 에이전트를 먼저 띄웁니다
tmux new -s base-ana-claude   # 세션 안에서 실행:  claude   (또는 아무 에이전트 CLI)

# 2) 다른 터미널에서 ANA 서버를 띄웁니다
node server.js           # → http://localhost:8809
```

**http://localhost:8809**을 열고 채팅 버튼을 누르세요. 서버는 **별도 실행 스크립트가 필요 없습니다**(`run.sh`는 편의용). 연결할 때 tmux 페인을 스스로 설정합니다(스크롤백 보존). 런타임 상태는 `.ana/`에 저장됩니다(git 제외). 처음 실행하면 작은 예제 흐름 두 개가 들어 있습니다(`ANA_SEED=0`이면 빈 보드로 시작).

### 이름 규칙

- **폴더 → ANA 이름.** 모든 ANA는 `~/ana/<xxx>-ana`(또는 `/ana/<xxx>-ana`)에 설치하고, 그 폴더명이 ANA의 이름입니다. `<xxx>`에는 하이픈이 들어가도 됩니다(`~/ana/sales-team-ana` → `sales-team-ana`). 샘플은 `~/ana/base-ana`이고, 폴더명이 `-ana`로 끝나지 않으면 `base-ana`로 간주합니다.
- **tmux → `<xxx>-ana-<yyy>`.** 에이전트 세션은 ANA 이름 뒤에 에이전트 라벨을 붙입니다: `base-ana-claude`, `base-ana-codex`, 또는 하이픈이 들어간 아무 라벨(`base-ana-review-2`). 기본 세션은 `<xxx>-ana-claude`입니다.
- **채팅의 세션 목록.** 채팅의 세션 선택 목록에는 이 ANA의 `<xxx>-ana-<yyy>` 세션(과 지금 연결된 세션)만 보입니다. `run.sh`의 서버 세션은 `srv-…`로 이름 지어 목록에 뜨지 않습니다.
- **덮어쓰기.** `ANA_NAME`은 이름을, `TMUX_SESSION`은 기본 세션을 지정하고(기존 배포는 그대로 동작), `ANA_TMUX_ALL=1`이면 모든 tmux 세션을 보여 줍니다.

---

## base에 들어 있는 것

베이스는 **비어 있는 채로** 시작합니다. 채팅으로 무슨 일을 하는지 말하거나 대충 그려 보내면, 에이전트가 PRD를 쓰고 화면을 함께 만듭니다. 쓰는 것이 곧 만드는 것입니다. 워크스페이스는 하나이고, 탭은 여섯입니다(휴대폰에서는 아래 메뉴).

| 탭 | 하위 탭 | 내용 |
|---|---|---|
| **PRD** | Current · History | 이 ANA가 무엇을 하는 앱인지 — 목적, 사용자, 일, 손그림, 지식, 에이전트가 하는 일. **새 ANA에는 PRD가 없습니다. 이 탭에서 열리고, 대화로 시작합니다.** 채팅으로 무슨 일을 하는지 말하면(예시를 고르거나 화면을 그려 보내도 됨) 에이전트가 필요한 것만 묻고, 같은 대화에서 PRD를 쓰고 첫 Work 화면을 만듭니다. 언제든 고칠 수 있고, 저장할 때마다 새 판이 되어 옛 판을 보거나 되돌릴 수 있습니다 |
| **Work** | — | 내 일을 위한 화면. **처음엔 비어 있고,** 대화하면서 에이전트가 만듭니다(일의 종류가 여럿이면 하위 탭과 함께) |
| **Knowledge** | Ontology · Graph · Documents | 내 일이 무엇에 관한 것인지: 사물의 종류와 그 관계(온톨로지), 실제 사물과 그 사이의 사실 — 각각 나온 항목이 붙음(그래프). 처음엔 비어 있고, *Ask the agent*를 누르면 에이전트가 일을 읽고 채우며, 틀린 것은 지울 수 있습니다. *Documents*에는 에이전트가 알아야 할 파일(명세서, 가격표, 매뉴얼 — 파일당 25MB까지)을 올립니다. 에이전트가 읽고, 사실의 근거로 그 문서를 가리킵니다 |
| **Requests** | Waiting · In progress · Done | 에이전트가 나에게 필요한 것: 에이전트가 제안한 데이터 변경(승인하기 전에는 아무것도 바뀌지 않음), 승인, 결정, 접근 권한, 나만 할 수 있는 일, 모자란 정보 |
| **Evolve** | Waiting · In progress · Done | 지금 할 일과 ANA가 바뀔 방향을 세 거리로 — **tidy**(어긋난 것 정리), **improve**(이 일을 더 낫게), **reimagine**(새로운 일하는 방식). 본 것, 사람에게 달라지는 것, 다른 곳의 사례(링크)가 붙습니다. *Do it*을 누르면 에이전트가 맡습니다 |
| **Update** | Waiting · In progress · Done | [agent-native-agent](https://github.com/tykimos/agent-native-agent)에 새로 나왔지만 여기에는 아직 없는 기능. *Check for updates*가 최신 업스트림과 기능 단위로 비교하고, *Bring it in*을 누르면 에이전트가 그 기능의 스킬로 옮겨 옵니다 |

**Sketch a screen**(PRD·Work 탭)을 누르면 빈 그림판이 열립니다 — 펜, 상자, 글자, 지우개. 그린 것은 그림으로 채팅에 붙고, 에이전트가 그걸 보고 화면을 만들며 PRD의 *Sketches*에 남깁니다.

Requests와 Evolve의 카드는 같은 질문에 사람 말로 답합니다 — **무슨 일인지(What's going on) · 무엇을 해 달라는지(What is asked) · 하면 무엇이 달라지는지(What it changes) · 안 하면(If not)**. Evolve 제안이나 업데이트로 앱이 하는 일이 바뀌면 에이전트가 PRD도 고칩니다.

### 채팅 — Claude 앱처럼

- 화면을 긁지 않고 **에이전트 자신의 기록으로 그립니다.** Claude Code 기록(`~/.claude/projects/…`)이나 Codex 기록(`~/.codex/sessions/…`)을 씁니다. 그래서 내 말풍선, 마크다운 응답, 접히는 `Ran 3 commands ›` 묶음, 이미지 썸네일이 정확하게 나옵니다. 기록이 없는 에이전트는 화면 미러로 그립니다.
- **세션 콤보:** tmux 세션(Claude Code 또는 Codex)을 고릅니다. 세션마다 대화가 따로 있고, 사람마다 마지막에 고른 세션을 기억합니다.
- **입력창:** ＋ 파일 첨부, **모델 알약**(실제 모델명, 예: `Opus 5.5`, `GPT-6 Astra`), **5시간·주간 사용량 링**(누르면 %와 초기화 시각), 🎤 받아쓰기, 보내기·중지 버튼이 있습니다. 모델 알약을 누르면 모델과 추론 강도를 고르는 시트가 열립니다.
- 입력창은 떠 있고 ↓ 버튼으로 맨 아래로 갑니다. 휴대폰 키보드 바로 위에 붙습니다.
- **에이전트의 질문**(AskUserQuestion, 권한 메뉴)은 선택지 버튼이 있는 카드로 나오고, 서버가 클릭을 알맞은 키 입력으로 바꿔 보냅니다.

### 화면을 짚어서 말하기

오른쪽 위 **Chip**을 켜고 화면의 항목(할일, 카드, 지표)을 누르면, 다음 메시지에 컨텍스트 칩으로 붙습니다. ⟳는 새로 생긴 종류의 요소를 칩 대상으로 등록합니다. ✎를 누르면 보드 위에 캔버스가 깔립니다. 빨강·마젠타·파랑으로 짚고 싶은 곳에 동그라미를 치고 *Add to chat*을 누르면, 표시가 합성된 화면 캡처와 표시 아래 항목들의 칩이 함께 붙습니다. 캡처는 [modern-screenshot](https://github.com/qq15725/modern-screenshot)을 `/vendor/`에서 로컬로 제공해 씁니다.

### 업무 사이의 연결

메모, 할일, 일정은 서로 이어지고, [NodeRel](https://github.com/tykimos/NodeRel)로 색인됩니다(`graph-index.js` → `graph-index.sqlite`, 데이터가 바뀌면 다시 만듦). 그래서 에이전트가 연결을 따라갈 수 있습니다.

```
Note ─SPAWNED──────▶ Task | Event     할일·일정이 나온 메모                (명시)
Task ─SCHEDULED_AS─▶ Event            할일을 하려고 잡아 둔 시간            (명시)
Note|Task|Event ─REFERS_TO─▶ Note|Task|Event   수동 참조                    (명시)
Task ─DUE_ON─▶ Day,  Event ─ON─▶ Day           due / date에서 계산          (규칙)
```

종류는 `work-ontology.js`에 있습니다. 화면에서 연결을 만드는 방법:
- 메모에서 한 줄을 고르고 **→ Task**나 **→ Event**를 누릅니다.
- 할일의 캘린더 버튼으로 그 할일을 할 시간을 잡습니다.
- **＋ Link**로 아무 두 항목이나 잇습니다.

연결은 양쪽 끝에 칩으로 보이고, 누르면 그 항목으로 갑니다. 새 연결 종류(`BLOCKS`)도 그대로 남깁니다.

| 엔드포인트 | 용도 |
|---|---|
| `GET /api/state` → `graph.links` | 연결(NodeRel에서) |
| `POST /api/todo {title, due?, from?}` · `POST /api/event {action:'add', …, from?}` | 만들면서 출처와 바로 연결(`from`이 메모면 `SPAWNED`, 할일이면 `SCHEDULED_AS`) |
| `POST /api/link {action:'add'\|'remove', from, to, type}` | 연결 추가·삭제 |
| `GET /api/graph/neighbors?id=` · `GET /api/graph/trace?id=&depth=&direction=&types=` | 이어진 것 / 닿는 모든 것 |
| `GET /api/graph/schema` | NodeRel의 AI용 스키마와 뜻. 에이전트에게 주세요 |
| `GET /api/stats` → `graph` | 종류별 개수와 흐름이 끊긴 곳(`gaps`) |

### Requests, Evolve, PRD — API

*Ask the agent*를 누르면 에이전트가 목록을 채웁니다. 에이전트는 `POST /api/requests {requests:[{kind, title, why, ask, effect, ifNot, options?, ref?}]}`로 항목을 올리고(`ref` = 링크로 보일 할일·일정·메모 id), 데이터 변경은 `POST /api/agent {text, diff, why, effect}`로 올립니다. 내 답은 채팅으로 바로 에이전트에게 갑니다. *Resolved* / *Not now*도 알려 줍니다(`POST /api/request-act {id, action: answer|done|dismiss|reopen}`). Evolve 제안은 `POST /api/evolve`로 들어오고 `POST /api/evolve-act {id, action: do|done|fail|ignore|reopen}`로 처리합니다. 문서는 `GET /api/documents`, `POST /api/documents {name, type, data(base64), note?}` 또는 `{action:'remove', id}`, `GET /api/documents/<id>/file`입니다. Knowledge는 `GET /api/knowledge`와 `POST /api/knowledge {classes?, relations?, entities?, facts?}`(같은 id는 고침) 또는 `{action:'remove', kind, id}`입니다. PRD는 `GET /api/prd`(지금 판 + 이력)와 `POST /api/prd {md, note, source}`(새 판) 또는 `{action:'restore', v}`입니다. 업데이트는 `GET /api/updates`, `POST /api/update/check`, `POST /api/update-act {id, action}`입니다.

### 여러 사람과 함께 쓰기 (선택)

ANA에는 **자체 로그인이 없습니다.** 혼자 자체 호스팅할 때는 그게 오히려 요점입니다 — 루프백에 묶어두면 그것으로 끝입니다. 여러 사람이 같은 보드를 봐야 한다면, 인증을 처리하는 앞단(리버스 프록시·SSO 게이트웨이·Zero Trust 터널)을 두고 사용자 식별자를 요청 헤더로 넘기게 하세요.

```bash
ANA_IDENTITY_HEADER=x-forwarded-email \
ANA_LOGOUT_URL=/your-gateway/logout \
node server.js
```

헤더가 잡히면 항목에 작성자가 남고, 자기가 만든 것만 수정·삭제할 수 있습니다. 지정하지 않으면(기본값) 전부 단일 사용자로 동작합니다.

**사람별 코딩 에이전트 세션.** 채팅 상단의 세션 콤보로 tmux 세션을 고릅니다. 세션마다 대화 이력이 따로 있어서 바꾸면 채팅이 그 세션의 대화로 통째로 바뀝니다. 고른 세션은 **사람별로** 기억되어, 다음에 접속하면 각자 자기가 마지막에 쓴 세션이 선택됩니다. 목록에는 세션마다 누가 골랐는지(지금 보고 있으면 ●)가 표시됩니다. 에이전트가 `curl`로 응답을 올릴 때는 `x-ana-target: <세션>` 헤더로 자기 세션을 지정할 수 있습니다.

> 이 헤더는 그대로 신뢰합니다. 따라서 앞단이 실제로 붙여줄 때만 의미가 있습니다. 서버는 루프백이나 그 프록시 뒤에 두세요. 이 옵션을 켠 채 `0.0.0.0`으로 열면 누구나 헤더를 위조해 남의 이름으로 쓸 수 있습니다.

---

## 기존 서비스에 ANA 붙이기 (아주 간단)

**런타임 전체가 의존성 없는 한 파일 [`channel-core.js`](channel-core.js)** 입니다. 넣고 마운트하기만 하면 됩니다:

```js
const path = require('node:path');
const core = require('./channel-core.js');
const app = core.createChannelServer({
  PORT: 8809, BIND: '127.0.0.1',
  SESSION: core.defaultSession(__dirname, process.env),   // TMUX_SESSION || <ANA 이름>-claude
  SOCKET: process.env.TMUX_SOCKET || '',
  TARGET: core.resolveTarget(__dirname, process.env),
  FEED_FILE: path.join(__dirname, '.ana', 'transcript.jsonl'),
  SERVABLE: new Set(['index.html']),   // 당신의 대시보드 파일(들)
  defaultDoc: 'index.html',
  autoConfigPane: true,
});
app.listen(() => console.log('ANA → http://localhost:8809'));
```

그리고 페이지에서: `POST /api/chat {text, force:true}` 로 보내고 `GET /api/stream`(SSE)으로 받습니다. 이게 통합의 전부입니다. 단계별 설명과 엔드포인트 레퍼런스는 **[`ana` 스킬](skills/ana/SKILL.md)**에 있습니다. 플러그인을 설치해 두면([스킬](#스킬) 참고) Claude Code에 *"내 앱에 ANA 붙여줘"*라고만 하면 됩니다.

---

## 스킬

이 저장소는 **Claude Code 플러그인**입니다. 머신마다 한 번 설치해 두면 어느 ANA의 에이전트든 스킬을 쓸 수 있고, 업데이트도 같은 방법으로 합니다.

```bash
claude plugin marketplace add tykimos/agent-native-agent
claude plugin install ana@agent-native-agent          # 이후: claude plugin update ana@agent-native-agent
```

| 스킬 | 용도 |
|---|---|
| [`install`](skills/install/SKILL.md) | 빈 머신에서 대시보드가 뜨는 데까지(환경 분석, 설치, tmux 실행, Windows WSL) |
| [`ana`](skills/ana/SKILL.md) | 내 서비스에 ANA 런타임 붙이기 |
| [`ana-update`](skills/ana-update/SKILL.md) | 이미 쓰고 있는 ANA를 기능 단위로 최신화 |
| [`chat-window`](skills/chat-window/SKILL.md) | Claude 앱 같은 채팅: 세션 콤보, 기록 기반 표시, 모델 시트, 사용량 링, 음성, 첨부, Codex |
| [`context-chips`](skills/context-chips/SKILL.md) | 칩 모드, ✎ 화면 그리기, ⟳ 새 요소 등록 |
| [`app-shell`](skills/app-shell/SKILL.md) | 여섯 탭(PRD · Work · Knowledge · Requests · Evolve · Update), 하위 탭, 휴대폰의 하단 메뉴 |
| [`agent-requests`](skills/agent-requests/SKILL.md) | Requests, Evolve, PRD, Knowledge |

### 기존 ANA 업데이트

이 base는 초기 셋팅용이고, 사람마다의 ANA는 각자 도메인 코드로 자랍니다. 그래서 업데이트할 때 저장소를 통째로 덮어쓰지 않습니다. 그 ANA의 에이전트에게 이렇게 말하세요.

> *"https://github.com/tykimos/agent-native-agent 최신 내용으로 업데이트해"*

**[`ana-update` 스킬](skills/ana-update/SKILL.md)**이 `ana-diff.mjs`로 다음을 보고합니다.
- 기능마다 ✓ 있음 · ◐ 일부 · ✗ 없음
- 오래된 모듈
- 공유 `channel-core.js`가 다른지

그중 가져올 것을 고르면, 기능별 스킬로 그 ANA의 파일에 이식합니다. 동기화한 커밋은 `.ana-sync.json`에 남기므로, 다음 업데이트 때는 그 뒤에 새로 생긴 것만 보여 줍니다. 비교 기준(기능별 앵커)은 [`features.json`](features.json)에 있습니다.

```bash
node skills/ana-update/scripts/ana-diff.mjs --target ~/ana/my-ana            # 보고만 (읽기 전용)
node skills/ana-update/scripts/ana-diff.mjs --target ~/ana/my-ana --record   # 이식한 뒤 기록
```

---

## 저장소 구성

```
channel-core.js     ★ ANA 런타임 전부 — tmux 주입 / capture-pane 미러 / 세션별 원장 (의존성 0)
server.js             베이스 앱: channel-core + dashboard-api 마운트, dashboard.html 제공
dashboard-api.js      베이스 API: 할일 · 일정 · 메모 · 관계 · 지식 · 요청 · 승인 · 진화 · PRD · 업데이트
dashboard.html        레퍼런스 UI: PRD · Work · Knowledge · Requests · Evolve · Update, Claude 앱 같은 채팅, 칩 모드 + 그리기, 관계 칩
agent-log.js          에이전트 자체 JSONL 기록으로 채팅 표시(Claude Code + Codex): 응답·도구·모델·한도
codex-settings.js     Codex 모델·추론 강도 목록, Codex 자체 메뉴로 전환
graph-index.js        연결의 NodeRel 색인(파생 graph-index.sqlite)
work-ontology.js      업무 항목과 연결의 종류(클래스, 관계, 계산 규칙). graph-index.js가 읽는다
prd-template.md       에이전트가 첫 PRD를 쓸 때 따르는 절 구성
CLAUDE.md · AGENTS.md 에이전트가 여기서 하는 일(대화로 시작, 한 번에 PRD와 첫 화면, PRD를 늘 맞게)
features.json         기능 목록: 기능별 앵커 + 담당 스킬 (ana-update가 비교 기준으로 사용)
package.json          의존성: @tykimos/noderel (github:tykimos/NodeRel), modern-screenshot
test.cjs              단위 + 통합 테스트(npm test), mock_agent.py = 테스트용 결정적 TUI
skills/               install · ana · ana-update · chat-window · context-chips · app-shell · agent-requests · cloud-setting
.claude-plugin/       플러그인 + 마켓플레이스 매니페스트
CHANGELOG.ko.md       버전별 변경 기록 (영문: CHANGELOG.md)
```

`channel-core.js`는 재사용 가능한 코어이고, `dashboard-api.js` / `dashboard.html`은 복사해서 당신의 것으로 교체하는 **예시**입니다.

---

## ANA와 ANL

| 이름 | 읽는 법 | 의미 | 역할 |
|---|---|---|---|
| **ANA** | 아나 | Agent‑Native Agent | 앱을 이해하고, 행동하며, 개선하는 자율 에이전트. |
| **ANL** | 아넬 | Agent‑Native Lifestyle | 에이전트와 함께 일하고, 배우고, 창작하고, 일상 루틴을 꾸리는 새로운 방식. |

**ANA가 ANL을 가능하게 합니다.** 실제 ANL 사례 — ANA로 만든 라이프스타일 — 는 동반 저장소인 **[agent‑native‑lifestyle](https://github.com/tykimos/agent-native-lifestyle)**에 있습니다.

---

## Star History

<a href="https://www.star-history.com/#tykimos/agent-native-agent&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=tykimos/agent-native-agent&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=tykimos/agent-native-agent&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=tykimos/agent-native-agent&type=Date" />
  </picture>
</a>

---

## 기여하기(Contributing)

ANA는 **소유하고 진화시키기** 위한 것입니다 — 이 저장소도 마찬가지입니다. 이슈, 아이디어, PR 모두 환영합니다. 런타임이나 예제 대시보드를 개선하는 방법은 [CONTRIBUTING.md](CONTRIBUTING.md)를 참고하세요.

ANA로 무언가를 만들었다면, **[agent‑native‑lifestyle](https://github.com/tykimos/agent-native-lifestyle)** 갤러리에 추가해 ANL이 실제 사용 사례로 계속 드러나도록 해주세요.

ANA가 앱에 대한 당신의 생각을 바꿨다면, 다른 사람들도 찾을 수 있도록 **⭐ 저장소에 스타**를 눌러주세요.

---

## 라이선스(License)

[AGPL-3.0](LICENSE) © [tykimos](https://github.com/tykimos) · 주식회사 인공지능팩토리

자유롭게 사용·수정·셀프호스팅할 수 있습니다. 다만 수정본을 네트워크 서비스로 제공하면 AGPL 제13조에 따라 소스를 공개해야 합니다. 비공개 제품이나 호스팅 서비스로 쓰시려면 **[상용 라이선스](COMMERCIAL.ko.md)**를 문의해 주세요.
