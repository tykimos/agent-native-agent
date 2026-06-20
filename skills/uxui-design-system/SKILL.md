---
name: uxui-design-system
description: Design and implement a cohesive, Toss-style (clean fintech) UX/UI design system for a web app with zero UI dependencies — token taxonomy (color, type, shape, elevation), component patterns, responsive/dark-mode/accessibility rules, and a build workflow. Use when starting a new web UI, unifying an inconsistent UI, or when the user asks for a "design system", "디자인 시스템", design tokens, a Toss-style look, or a polished mobile-first interface.
---

# UX/UI 디자인 시스템 스킬 (토스 스타일, 의존성 0)

깔끔한 핀테크(토스) 감성의 **일관된 디자인 시스템**을 토큰부터 컴포넌트까지 설계·구현하는 절차. 프레임워크/UI 라이브러리 없이 바닐라 CSS 변수로 만들어 어디에나 이식 가능하게 한다.

## 언제 쓰나
- 새 웹 UI를 시작할 때 / 들쭉날쭉한 UI를 통일할 때
- "디자인 시스템", "토스 스타일", "디자인 토큰", "모바일 우선 깔끔한 UI" 요청이 있을 때

## 핵심 원칙 (이 감성을 만든다)
1. **토큰 우선** — 색/타이포/라운드/그림자/간격을 `:root` CSS 변수로 정의하고, 컴포넌트는 토큰만 참조. 하드코딩 금지(다크모드 자동 대응).
2. **큰 숫자 · 굵은 글씨 · 좁은 자간** — 핵심 지표는 크고 굵게(800), 자간 `-0.03~-0.04em`로 단단하게. 브랜드 컬러(블루)로 강조.
3. **부드러운 면** — 흰 카드 + 옅은 배경 + **소프트 섀도우 2겹** + 16~24px 라운드. 경계선은 옅게.
4. **즉각 피드백 · 절제된 모션** — 프레스 `scale(.96)`, 시트 슬라이드 `cubic-bezier(.32,.72,0,1)`. 과한 모션 금지.
5. **모바일 우선** — `dvh`, `env(safe-area-inset-*)`, `VisualViewport`(키보드), 터치 타깃 ≥44px.
6. **친근한 한국어 마이크로카피** — "완료! 잘했어요 🎉" 같은 톤.

## 토큰 분류 (taxonomy)
`references/design-tokens.css`에 바로 쓸 수 있는 토큰 세트가 있다. 카테고리:

- **표면/텍스트**: `--bg --surface --surface-2 --text --text-sub --text-weak --line --line-2`
- **브랜드**: `--blue(#3182F6 Toss Blue) --blue-700 --blue-weak --green`
- **엔티티 컬러**(사람/카테고리/상태별 정체성 색): `--c-*`
- **상태/종류 배지**: 차분한 색 vs 따뜻한 색 쌍 (`--*-bg / --*-fg`)
- **라운드**: `--r-xl:24 --r-lg:20 --r:16 --r-sm:12 --r-xs:10` (+ 밀집 영역은 예외적으로 4~6px)
- **그림자**: `--sh-card`(2겹 소프트) `--sh-fab`(브랜드 글로우) `--sh-sheet`(상단 띄움)
- **레이아웃 상수**: `--header-h`, `--safe-b: env(safe-area-inset-bottom)`
- **다크모드**: `@media (prefers-color-scheme: dark)`에서 토큰만 재정의

## 타이포그래피
- 서체: `Pretendard` + 시스템 폴백(`-apple-system, Apple SD Gothic Neo, system-ui, Roboto`)
- 본문 15px/1.45, 자간 -0.01em, `-webkit-font-smoothing: antialiased`
- 굵기는 **600/700/800 중심**(일반 400 거의 안 씀). 제목/숫자/라벨 = 800.

## 컴포넌트 패턴 (재사용 빌딩블록)
- **헤더**: `position: sticky` + 반투명 + `backdrop-filter: saturate(180%) blur(12px)` 글래스.
- **카드/칸**: `--surface` + `--sh-card` + 라운드. 밀집 격자는 라운드·패딩 축소로 정보 밀도 ↑.
- **칩/배지**: 알약형(`border-radius:999px`) 또는 종류색 좌측 띠. 한 줄(`nowrap`+ellipsis)이 기본.
- **바텀시트**: 모바일=하단 슬라이드업+핸들, PC(≥1024)=중앙 모달로 전환. `dvh`+`--safe-b`.
- **입력/액션**: 48px 원형 전송, 프레스 `scale(.9)`. 비활성은 `--line` 배경.
- **토스트**: 하단 1.7초 알림. **FAB**: 브랜드 글로우 섀도우.
- **진행률**: 큰 % 숫자(블루) + conic-gradient 링.

## 반응형 · 접근성 (필수 체크)
- 브레이크포인트 **1024px**. 모바일 가로 스크롤 / PC 동시 표시.
- 높이는 `vh` 대신 **`dvh`**(모바일 주소창), 입력은 `VisualViewport`로 키보드 위 배치.
- `lang="ko"`, `<meta viewport ... viewport-fit=cover>`, `theme-color`.
- 인터랙티브 요소에 `role/tabindex/aria-label`, 키보드(Enter/Space/Esc), 스킵 링크.
- 터치 타깃 ≥44px, `-webkit-tap-highlight-color: transparent`, 명도 대비 확보, 다크모드 대응.

## 실행 절차 (workflow)
1. **요구 정리**: 핵심 화면 1개와 "한눈에 봐야 할 지표"를 먼저 정의.
2. **토큰 심기**: `references/design-tokens.css`를 복사해 브랜드/엔티티 색만 교체.
3. **레이아웃 골격**: 헤더 + 메인(카드/격자) + 하단 액션(시트/입력)의 3층 구조.
4. **컴포넌트 조립**: 위 패턴에서 필요한 것만. 모든 값은 토큰 참조.
5. **반응형·다크·접근성 패스**: 1024 분기, dvh/safe-area, aria, 대비 점검.
6. **검증**: 실제 모바일 폭(예: 390px)에서 키보드 올렸을 때 입력 가림·오버플로·대비를 좌표로 확인.
7. **문서화**: 토큰 표 + 컴포넌트 스펙을 `DESIGN_SYSTEM.md`로 남겨 일관성 유지.

## 안티패턴 (하지 말 것)
- 색/그림자/라운드 하드코딩(다크모드 깨짐) · `vh`만 사용(모바일 키보드 가림) · 과한 그라데이션/모션 · 얇은 폰트로 지표 표시 · 44px 미만 터치 타깃 · 접근성 속성 누락.

## 산출물
- `styles.css`(토큰+컴포넌트), 화면 골격(HTML), `DESIGN_SYSTEM.md`(토큰·컴포넌트 명세).
- 참고: [`references/design-tokens.css`](references/design-tokens.css) — 즉시 사용 가능한 토큰 세트(라이트+다크).
