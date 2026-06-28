---
name: agent-native-app-harness
description: "Agent Native Agent (ANA) harness — build and evolve agent-native agents for Agent-Native Lifestyle (ANL), operated by WATCHING a dashboard and CONVERSING with a coding agent that serves as the runtime. Use when the user wants to create an 'agent native agent', 'agent native app', 'ANA', 'ANL', '에이전트 네이티브 에이전트', '에이전트 네이티브 라이프스타일', a 'watch + converse' operating tool, a self-hosted personal/solopreneur operations app (schedule/metrics/orders/work-queue), a dashboard-agent they can grow by talking, or asks to scaffold/extend/evolve such an agent/app. Also triggers on follow-ups: '다시 만들어', '대시보드 추가', '이 앱에 기능 추가', '말로 키운다', 'agent native app 하네스', 'agent native agent 하네스'. Orchestrates the building-block skills uxui-design-system + fakechat-dashboard-agent under one harness."
---

# Agent Native Agent (ANA) — Harness

**ANA(아나)** 는 **ANL(아넬, Agent-Native Lifestyle)** 을 위한 **agent-native agent**다. 코딩 에이전트를 **운영의 런타임(코어)** 으로 삼아, 사용자가 **대시보드를 보면서(watch) 대화로(converse) 운영**하고, 필요하면 **앱 자체를 그 자리에서 바꿔** 나가는 자율형 에이전트를 짓고 진화시키는 하네스다.

이 하네스는 revfactory/harness의 메타-팩토리 패턴(에이전트+스킬을 생성·조율하는 상위 계층)을 따르되, 산출물을 **Agent-Native Lifestyle을 위한 Agent Native Agent** 로 특화한다. 하네스 일반론·에이전트 팀 설계·스킬 작성 규약은 `harness` 메타 스킬(github.com/revfactory/harness)을 상위 참조로 삼는다.

> 개념 슬라이드 원본: `docs/ana-concept.md`. 아키텍처/구성도 상세: `references/ana-architecture.md`. 단계별 구축 절차: `references/build-workflow.md`.

## 무엇이 ANA인가 (정의)

> **Agent Native Agent** = Agent-Native Lifestyle을 위해, 코딩 에이전트(Claude Code)를 운영의 런타임으로 삼아, 사용자가 대시보드를 보면서 대화로 운영하고, 필요하면 앱 코드까지 그 자리에서 바꾸는 자율형 에이전트.

- 에이전트는 '부가 기능'이 아니라 **앱을 움직이고 진화시키는 엔진**이다.
- 운영자는 **본다(watch) + 말한다(converse)**. 나머지는 에이전트가 한다.
- **앱이 나에게 맞춰 자란다** — 개발 사이클이 아니라 대화 한 번으로.

`Assistant`는 수동적 비서에 가깝다. ANA는 스스로 판단하고, 실행하고, 피드백을 받아 반복적으로 개선하는 **Agent**를 전제로 한다.

전통 SaaS·순수 챗봇·노코드와의 차이: 셋 다 "내가 앱에 맞추는" 구조다. ANA만이 시각 맥락(내 대시보드) + 자연어 운영 + **그 자리에서 코드 변경** + 완전한 소유(셀프호스팅)를 동시에 만족한다.

## 3원칙 (모든 ANA가 지켜야 한다)

1. **보면서 대화한다 (Watch + Converse)** — 시각적 상태(대시보드)와 자연어 대화를 **한 화면**에서. 채팅으로만 눈 감고 명령하지 않는다.
2. **에이전트가 런타임이다 (Agent as Runtime)** — 에이전트가 데이터를 읽고 → 행동하고 → **앱 코드까지** 고친다. 변경은 전/후 미리보기 + 승인 카드로.
3. **내 하네스를 소유한다 (Own Your Harness)** — 의존성 0 · 셀프호스팅 · 내 삶에 맞춰 계속 진화하는 나만의 운영 도구.

이 원칙은 곧 검수 기준이다. 산출물이 셋 중 하나라도 어기면 ANA가 아니다(§검수 체크리스트).

## 빌딩블록 스킬 (이 하네스가 조율한다)

이 하네스는 두 개의 재사용 스킬을 조립해 ANA를 짓는다. 각 스킬은 "어떻게 하는가"를 담고, 이 하네스는 "무엇을·어떤 순서로 엮는가"를 담는다.

| 스킬 | 역할 | 무엇을 만드나 |
|---|---|---|
| **`uxui-design-system`** | ANA의 **얼굴** | 의존성 0 토스 스타일 디자인 시스템 — 토큰·컴포넌트·하단 액션 바·바텀시트. 대시보드가 "한눈에 보이는" 시각 맥락을 책임진다. |
| **`fakechat-dashboard-agent`** | ANA의 **신경계** | 대시보드 서버 + 인바운드 릴레이 + fakechat 채널 + Claude 세션(두뇌). "보면서 대화"의 watch+converse 배선을 책임진다. |

두 스킬은 같은 repo의 `skills/uxui-design-system/`, `skills/fakechat-dashboard-agent/`에 있다. 구축 시 두 스킬의 SKILL.md를 읽고 그 절차를 따른다. 새 빌딩블록(예: 인증, 알림, 배포 터널)이 반복되면 같은 패턴으로 `skills/`에 추가한다.

## 워크플로우 (요약)

전체 단계는 `references/build-workflow.md`에 있다. 핵심 흐름:

### Phase 0: 컨텍스트 확인 (초기/후속/부분 재실행 판별)
- 대상 디렉터리에 기존 ANA 산출물(`server.js`, 상태 JSON, 대시보드)이 있는지 확인한다.
- **없음** → 신규 구축(Phase 1~5 전체).
- **있음 + 부분 수정 요청** ("음성 입력 추가", "30분 단위로") → 해당 부분만 대화로 변경(Phase 4 진화 루프로 직행).
- **있음 + 새 도메인** → 새 ANA로 분기(기존 보존).

### Phase 1: 도메인 1화면 정의 (Watch)
매일 봐야 할 **핵심 상태 1개**를 정한다 — 일정/지표/주문/작업 큐 등. "이 화면 하나를 매일 본다"가 명확해질 때까지 좁힌다. 데이터 모델 = 핵심 엔티티 + `version` 필드(동기화용).

### Phase 2: 얼굴 입히기 (`uxui-design-system`)
`uxui-design-system` 스킬로 디자인 토큰·대시보드 레이아웃·하단 `[액션][대화하기]` 바를 구성한다. 핵심 지표는 크고 굵게, 부드러운 면, 모바일 우선.

### Phase 3: 신경계 배선 (`fakechat-dashboard-agent`)
`fakechat-dashboard-agent` 스킬로 대시보드 서버 + 인바운드 릴레이 + fakechat 채널 + Claude 세션을 연결한다. **인바운드는 채널로 자동 푸시, 응답은 항상 `/api/agent`(제안→승인 카드)**. 다기기 동기화는 `version` 폴링(2.5초) 병행.

### Phase 4: 말로 키운다 (Agent as Runtime — 진화 루프)
앱을 쓰는 도중 **요청만으로** 기능을 키운다. 변경은 항상 **전/후 미리보기 + 승인 카드**로 제시하고, 승인 시 코드/데이터에 반영한 뒤 모든 기기에 동기화한다.
예: "음성으로 입력되게" → Web Speech 마이크 추가 / "이전 5일·앞으로 5일" → 롤링 윈도우 / "하단에 버튼" → 액션 바 신설.

### Phase 5: 소유·공개 (Own Your Harness)
셀프호스팅을 유지하고, 외부 공개는 고정 주소 터널(cloudflared 등)로. 의존성 0 원칙을 깨지 않는다(터널이 `text/event-stream`을 버퍼링하므로 SSE만 믿지 말고 폴링 병행).

## 검수 체크리스트 (산출물이 ANA인지 확인)

- [ ] **Watch** — 핵심 상태가 대시보드 1화면에 한눈에 보인다(채팅 로그가 아니라 시각 대시보드).
- [ ] **Converse** — 같은 화면에서 자연어로 운영하고, 변경은 전/후 미리보기 + 승인 카드로 받는다.
- [ ] **Agent as Runtime** — 에이전트가 데이터를 읽고 행동하며, "말로 기능 추가"가 실제로 동작한다(앱 코드 변경 경로 존재).
- [ ] **인바운드 자동 푸시** — fakechat 채널로 메시지가 Claude 세션에 자동 도착(폴링 루프/수동 호출 불필요).
- [ ] **다기기 동기화** — 상태에 `version`, 폴링으로 모든 접속자 자동 동기화(완료/토글은 서버 저장, localStorage 금지).
- [ ] **Own** — 의존성 0 · 셀프호스팅 · 이식 가능 · 종속 없음.
- [ ] **디자인 일관성** — `uxui-design-system` 토큰만 참조, 하드코딩 색/라운드 없음(다크모드 자동 대응).

## 진화 (하네스는 정적이지 않다)

ANA의 본질은 "쓰면서 자란다"이다. 사용자가 반복적으로 같은 요청을 하거나 수동으로 우회하는 패턴이 보이면 빌딩블록 스킬 자체를 보강해 제안한다. 빌딩블록·이 하네스의 변경은 repo의 README 또는 `docs/`에 이력으로 남긴다. 새 도메인을 ANA로 만들 때마다 같은 3원칙·같은 빌딩블록으로 복제 가능해야 한다 — "하나의 하네스, 여러 도메인".

## 참고

- 개념/철학(슬라이드): `docs/ana-concept.md`
- 아키텍처·구성도 상세: `references/ana-architecture.md`
- 단계별 구축 절차(전문): `references/build-workflow.md`
- 빌딩블록: `skills/uxui-design-system/SKILL.md`, `skills/fakechat-dashboard-agent/SKILL.md`
- ANL 예시: `examples/`
- 상위 하네스 패턴(메타-팩토리): github.com/revfactory/harness
