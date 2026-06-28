# Agent Native Agent (ANA)

**한국어** · [English](README.md)

> **ANA(아나)** 는 **ANL(아넬, Agent-Native Lifestyle)** 을 위한 **agent-native agent**입니다. 사용자의 일상과 업무 방식을 이해하고, 스스로 판단하고 실행하며, 필요한 도구를 반복적으로 개선해 새로운 라이프스타일을 만들어갑니다.

**ANA(Agent Native Agent)** 하네스는 코딩 에이전트(Claude Code)를 **운영의 런타임이자 빌더**로 삼아, 사용자가 대시보드를 보면서 대화로 운영하고 필요하면 앱 코드까지 그 자리에서 바꾸는 자율형 에이전트를 짓고 진화시키는 하네스입니다.

## ANA와 ANL

| 이름 | 읽기 | 의미 | 역할 |
|---|---|---|---|
| **ANA** | 아나 | Agent Native Agent | 사용자의 맥락을 이해하고, 판단하고, 실행하며, 도구를 개선하는 자율형 에이전트 |
| **ANL** | 아넬 | Agent-Native Lifestyle | 에이전트와 함께 일하고, 배우고, 소비하고, 창작하고, 생활 루틴을 운영하는 새로운 방식 |

**ANA is an agent-native agent for Agent-Native Lifestyle.**  
즉, **아나는 에이전트 네이티브 라이프스타일을 위한 에이전트 네이티브 에이전트입니다.**

`Assistant`는 "도와주는 비서"처럼 수동적으로 들립니다. 반면 `Agent`는 스스로 판단하고, 실행하고, 피드백을 받아 반복적으로 개선하는 존재라는 의미가 분명합니다. 그래서 ANA의 중심 단어는 Assistant가 아니라 **Agent**입니다.

ANL은 별도 리포지토리가 아니라, 이 저장소 안에서 ANA로 만든 실제 사례로 보여줍니다. 사례는 [`examples/README.ko.md`](examples/README.ko.md) 아래에 둡니다.

이 저장소는 [revfactory/harness](https://github.com/revfactory/harness)의 메타-팩토리 패턴을 따르되, 산출물을 **Agent-Native Lifestyle을 위한 자율형 에이전트**로 특화합니다. 상위에 ANA 하네스 스킬(오케스트레이터)을 두고, 그 아래 재사용 빌딩블록 스킬들을 조립합니다.

> 이 저장소는 `ai-solopreneur-skills`에서 이름을 바꾼 것입니다. 기존 스킬은 ANA를 짓는 빌딩블록으로 편입되었습니다.

## ANA란

> **Agent Native Agent** = Agent-Native Lifestyle을 위해, 코딩 에이전트를 운영의 런타임이자 빌더로 삼아, 사용자가 대시보드를 보면서 대화로 운영하고, 필요하면 앱 코드까지 그 자리에서 바꾸는 자율형 에이전트.

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

## ANL 예시

ANA로 만든 여러 사례는 이 저장소의 [`examples/README.ko.md`](examples/README.ko.md) 아래에 모읍니다. ANL은 별도 제품이나 별도 리포지토리가 아니라, ANA가 만들어내는 구체적인 라이프스타일 변화입니다. 일하는 방식, 배우는 방식, 소비하는 방식, 창작하는 방식, 생활 루틴이 어떻게 바뀌는지를 사례로 보여줍니다.

- ANA: [Agent Native Agent](https://github.com/tykimos/agent-native-agent)

## 라이선스

[MIT](LICENSE) © tykimos
