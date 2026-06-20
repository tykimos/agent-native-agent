# ai-solopreneur-skills

AI 솔로프리너(1인 창업가)를 위한 **Claude / Agent Skills** 모음.
혼자서 제품을 빠르게 만들고 운영하는 데 바로 쓰는 재사용 스킬들입니다.

각 스킬은 [Anthropic Agent Skills](https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills) 형식(`SKILL.md` + 참고 파일)을 따릅니다. Claude Code의 플러그인/스킬 디렉터리에 넣거나, 내용을 그대로 프롬프트로 활용할 수 있습니다.

## 수록 스킬

| 스킬 | 설명 |
|---|---|
| [`uxui-design-system`](skills/uxui-design-system/) | 의존성 0으로 **토스 스타일의 일관된 UX/UI 디자인 시스템**(토큰·컴포넌트·반응형·다크모드·접근성)을 설계·구현 |
| [`fakechat-dashboard-agent`](skills/fakechat-dashboard-agent/) | **fakechat 채널 + 웹 대시보드**를 결합한 "대시보드 에이전트" 구축. 채팅만으로 원격 조종하는 대신 **주요 대시보드를 눈으로 보면서 대화**한다 |

## 왜 "대시보드 에이전트"인가

순수 채팅 원격 조종(remote control)은 상태를 글로만 주고받습니다. 솔로프리너의 실제 운영(일정·지표·주문·작업 큐)은 **한눈에 보이는 화면**이 필요합니다. `fakechat-dashboard-agent`는 외부 웹 대시보드에 채팅을 붙여, **시각적 맥락 + 대화**를 한 화면에서 제공합니다.

## 사용법

```bash
# 스킬 디렉터리를 Claude Code 스킬 경로에 복사하거나 심볼릭 링크
cp -r skills/uxui-design-system ~/.claude/skills/
cp -r skills/fakechat-dashboard-agent ~/.claude/skills/
```

또는 각 `SKILL.md`를 읽고 그 절차를 따라 작업을 진행하면 됩니다.

## 라이선스

[MIT](LICENSE) © tykimos
