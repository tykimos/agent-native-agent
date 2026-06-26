# Agent-Native Agent (ANA)

> **Coding-Agent-Native Agent** — 당신이 만나는 서비스는, 그것을 **런타임에서 짓고·돌리고·고쳐 나가는 코딩 에이전트(빌더)에 네이티브**합니다. 대시보드를 **보면서(watch)**, 코딩 에이전트와 **대화하며(converse)** 운영하고, **말 한 번으로 앱 자체가 자랍니다.**

**ANA(Agent-Native Agent)** 하네스는 코딩 에이전트(Claude Code)를 **운영의 런타임이자 빌더**로 삼아, 사용자가 대시보드를 보면서 대화로 운영하고 필요하면 앱 코드까지 그 자리에서 바꾸는 앱을 짓고 진화시키는 하네스입니다.

### 이름에 대하여 — 왜 *Agent*-Native *Agent*인가
이름은 **"Coding-Agent-Native Agent"** 로 읽습니다. 무게중심은 *사용자가 만나는 서비스*가 아니라 **그것을 살아 있게 만드는 코딩 에이전트(빌더)** 에 있습니다.

- **뒤의 `Agent`** = 사용자가 만나는 서비스(앱) 그 자체.
- **앞의 `Agent-Native`** = 그 서비스가 **코딩 에이전트에 네이티브**하다는 선언 — 코딩 에이전트가 런타임에서 *짓고·돌리고·진화*시킨다.
- 즉 ANA의 정체성은 **빌더(코딩 에이전트)** 이며, 이는 아래 3원칙 ②"에이전트가 런타임이다"·③"내 하네스를 소유한다"와 정확히 같은 곳을 가리킵니다.

이 저장소는 [revfactory/harness](https://github.com/revfactory/harness)의 메타-팩토리 패턴을 따르되, 산출물을 **하나의 구체적 앱 형태 — Agent Native App** 으로 특화합니다. 상위에 ANA 하네스 스킬(오케스트레이터)을 두고, 그 아래 재사용 빌딩블록 스킬들을 조립합니다.

> 이 저장소는 `ai-solopreneur-skills`에서 이름을 바꾼 것입니다. 기존 스킬은 ANA를 짓는 빌딩블록으로 편입되었습니다.

## ANA란

> **Agent-Native Agent** = 코딩 에이전트를 운영의 런타임이자 빌더로 삼아, 사용자가 대시보드를 보면서 대화로 운영하고, 필요하면 앱 코드까지 그 자리에서 바꾸는 앱. 정체성은 *서비스*가 아니라 그것을 짓고 살려 나가는 *코딩 에이전트*에 있습니다.

전통 SaaS · 순수 챗봇 · 노코드는 모두 "내가 앱에 맞추는" 구조입니다. ANA만이 **시각 맥락(내 대시보드) + 자연어 운영 + 그 자리에서 코드 변경 + 완전한 소유(셀프호스팅)** 를 동시에 만족합니다.

### 3원칙
1. **보면서 대화한다 (Watch + Converse)** — 시각 상태와 대화를 한 화면에서.
2. **에이전트가 런타임이다 (Agent as Runtime)** — 읽고 → 행동하고 → 앱 코드까지 고친다.
3. **내 하네스를 소유한다 (Own Your Harness)** — 의존성 0 · 셀프호스팅 · 계속 진화.

전체 개념/철학은 [`docs/ana-concept.md`](docs/ana-concept.md)를 참조하세요.

## 구조

```
agent-native-app-harness/
├── .claude-plugin/
│   └── plugin.json
├── docs/
│   └── ana-concept.md                     # 개념 슬라이드 (Marp)
└── skills/
    ├── agent-native-app-harness/          # ★ ANA 하네스 스킬 (오케스트레이터)
    │   ├── SKILL.md
    │   └── references/
    │       ├── ana-architecture.md        # 구성도·데이터 흐름
    │       └── build-workflow.md          # 단계별 구축 절차
    ├── uxui-design-system/                # 빌딩블록 — ANA의 얼굴 (Watch)
    └── fakechat-dashboard-agent/          # 빌딩블록 — ANA의 신경계 (Converse)
```

## 하네스 스킬과 빌딩블록

| 스킬 | 계층 | 역할 |
|---|---|---|
| [`agent-native-app-harness`](skills/agent-native-app-harness/) | **하네스(오케스트레이터)** | "무엇을·어떤 순서로 엮어 ANA를 짓는가"를 정의. 빌딩블록을 조립하고 진화 루프를 운영. |
| [`uxui-design-system`](skills/uxui-design-system/) | 빌딩블록 (얼굴) | 의존성 0 토스 스타일 디자인 시스템 — 대시보드의 시각 맥락. |
| [`fakechat-dashboard-agent`](skills/fakechat-dashboard-agent/) | 빌딩블록 (신경계) | 대시보드 + 채널 + 코딩 에이전트 배선 — watch+converse. |

## 사용법

Claude Code에서 ANA를 만들려면, 스킬을 스킬 경로에 두고 자연어로 요청합니다:

```bash
# 저장소 전체를 Claude Code 스킬 경로에 복사(또는 심볼릭 링크)
cp -r skills/* ~/.claude/skills/
```

```
"우리집 주간 계획표를 agent native app으로 만들어줘"
"이 ANA에 음성 입력 추가해줘"        # 진화: 말 한 번으로 기능 추가
```

`agent-native-app-harness` 하네스 스킬이 트리거되어 도메인 1화면 정의 → 디자인 → 배선 → 진화 루프 순으로 ANA를 구축합니다. 절차 전문은 [`skills/agent-native-app-harness/references/build-workflow.md`](skills/agent-native-app-harness/references/build-workflow.md).

## 사례 — "우리집 주간 계획표"

- **대시보드**: 토스 스타일 격자(시간 × 요일 × 가족 4명), 한눈에 보는 진행률.
- **대화**: 하단 `[대화하기]` → "오늘 일정은?" / "민준 7시 영어 추가".
- **흐름**: 채팅 → 채널 → Claude 세션이 `schedule.json` 읽고 → 전/후 미리보기 + 승인 카드 → 누르면 반영, 모든 기기 동기화.
- **진화**: "음성으로 입력되게" → 마이크 추가. 개발 사이클이 아니라 대화 한 번.

## 라이선스

[MIT](LICENSE) © tykimos
