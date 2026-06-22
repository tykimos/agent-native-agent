# 컴포넌트 스펙 — 하단 액션 바 & 팝업(바텀시트)

토스 스타일 디자인 시스템의 **하단 고정 액션 버튼**과 **팝업(바텀시트/모달)** 컴포넌트 명세.
모든 값은 [`design-tokens.css`](design-tokens.css)의 토큰을 참조한다(하드코딩 금지 → 다크모드 자동 대응).

---

## A. 하단 액션 바 (Bottom Action Bar)

화면 어디서든 누를 수 있는 **하단 고정 진입점**. 보조/주(主) 두 개의 알약 버튼으로 구성한다. (예: `[스케줄등록]` · `[대화하기]`)

### 원칙
- **무이모지** — 라벨 앞 아이콘은 **2px stroke 라인 아이콘**(Lucide류)만, `currentColor` 상속.
- **주 액션 1개** — 가장 중요한 동작만 채움(filled), 나머지는 외곽선(outline).
- **하단 고정 + 세이프에어리어** — `position: fixed; bottom: 0` + `padding-bottom: calc(… + var(--safe-b))`.
- **글래스 바** — 반투명 + `backdrop-filter: blur` 로 콘텐츠 위에 떠 있는 느낌, 콘텐츠를 가리지 않게.

### 구조
```html
<div class="chat-bar">
  <button class="actbtn secondary"><svg…/><span>스케줄등록</span></button>
  <button class="actbtn primary"><svg…/><span>대화하기</span>
    <span class="chat-badge on">3</span>   <!-- 선택: 미확인 배지 -->
  </button>
</div>
```

### CSS
```css
.chat-bar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 41;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
  border-top: 1px solid var(--line);
  padding: 7px 12px calc(7px + var(--safe-b));     /* 세이프에어리어 존중 */
  display: flex; align-items: center; gap: 8px;
  max-width: 1600px; margin: 0 auto;
}
.chat-bar .actbtn {
  flex: 1; min-width: 0; height: 44px; border-radius: 999px;   /* 알약형 + ≥44px 탭영역 */
  display: flex; align-items: center; justify-content: center; gap: 6px;
  font-family: inherit; font-size: 14.5px; font-weight: 800; letter-spacing: -0.02em;
  position: relative;
  transition: transform .1s ease, background .12s ease, border-color .12s ease, color .12s ease;
}
.chat-bar .actbtn svg { width: 18px; height: 18px; flex-shrink: 0; }

/* 주 액션 (filled) */
.chat-bar .actbtn.primary { background: var(--blue); color: #fff; box-shadow: 0 6px 16px rgba(49,130,246,.28); }
.chat-bar .actbtn.primary:hover { background: var(--blue-700); }
/* 보조 (outline) */
.chat-bar .actbtn.secondary { background: var(--surface); color: var(--text); border: 1.5px solid var(--line); }
.chat-bar .actbtn.secondary:hover { border-color: var(--blue); color: var(--blue); }
/* 상태 */
.chat-bar .actbtn:active { transform: scale(.97); }                       /* press */
.chat-bar .actbtn:disabled { background: var(--line); color: var(--text-weak); border-color: var(--line); box-shadow: none; }
.chat-bar .actbtn:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--blue-weak), 0 0 0 5px var(--blue); }  /* 포커스 링 */

/* 미확인 배지(선택) */
.chat-badge {
  position: absolute; top: 4px; right: 12px; min-width: 18px; height: 18px; padding: 0 5px;
  background: #F0507A; color: #fff; border-radius: 999px; font-size: 11px; font-weight: 800;
  display: none; align-items: center; justify-content: center;
}
.chat-badge.on { display: flex; }
```

### 상태 정리
| 상태 | 주(primary) | 보조(secondary) |
|---|---|---|
| 기본 | `--blue` 채움 + 소프트 글로우 | `--surface` + `--line` 외곽선 |
| hover | `--blue-700`(한 단계 진하게) | 외곽선/텍스트 `--blue` |
| press | `scale(.97)` | `scale(.97)` |
| disabled | `--line` 배경, `--text-weak` | 동일 |
| focus | 블루 2겹 포커스 링 | 동일 |

> **변형(잉크/컷아웃 룩)**: 채움색을 `--teal`, 외곽선을 `--border-2 solid var(--ink-900)`, 그림자를 `--shadow-hard`로 바꾸고 press는 `translate(2px,2px)+그림자 제거(press-pop)`. 단 앱 전체 DS와 일관되게 택1.
> **FAB 변형**: 단일 진입점이면 우하단 알약 FAB(`position: fixed; right; bottom: calc(18px + var(--safe-b)); box-shadow: var(--sh-fab)`).

### 콘텐츠 가림 방지
하단 바 높이만큼 메인 영역에 여백을 준다: `main { padding-bottom: 84px; }` 또는 스크롤 컨테이너 `max-height: calc(100dvh - …)`.

---

## B. 팝업 — 바텀시트 / 모달 (Bottom Sheet)

탭하면 아래에서 올라오는 시트. **모바일=바텀시트**, **PC(≥1024)=중앙 모달**로 자동 전환한다. 폼 입력·상세 보기·채팅·요약 등 모든 팝업의 기본 골격.

### 원칙
- **모바일 바텀시트 ↔ PC 중앙 모달** 한 컴포넌트로 전환(브레이크포인트 1024).
- **`dvh` 높이 + `--safe-b`** — 모바일 주소창/홈인디케이터 대응.
- **본문만 스크롤, 머리/발 고정** — flex 컬럼 + 본문 `flex:1; min-height:0`.
- **키보드 맞춤** — 입력이 있는 시트는 `VisualViewport`로 키보드 위에 자동 배치.
- **부드러운 슬라이드** — `cubic-bezier(.32,.72,0,1)`.

### 구조
```html
<div class="sheet-backdrop" id="backdrop">
  <div class="sheet chat-sheet" id="sheet" role="dialog" aria-modal="true">
    <div class="handle"></div>
    <div class="sheet-head"><div class="stitle">제목</div><button class="sclose">✕</button></div>
    <div class="sheet-body"><!-- 스크롤 영역 --></div>
    <div class="sheet-foot"><!-- 입력/액션 (선택) --></div>
  </div>
</div>
```

### CSS
```css
.sheet-backdrop {
  position: fixed; inset: 0; z-index: 50; background: rgba(0,0,0,.42);
  opacity: 0; pointer-events: none; transition: opacity .25s ease;
}
.sheet-backdrop.open { opacity: 1; pointer-events: auto; }

.sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 51;
  margin: 0 auto; width: 100%; max-width: 480px;
  background: var(--surface);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  box-shadow: var(--sh-sheet);
  transform: translateY(100%);                              /* 닫힘: 화면 아래 */
  transition: transform .32s cubic-bezier(.32,.72,0,1);
  max-height: 90vh; max-height: 90dvh;                      /* dvh 폴백 */
  display: flex; flex-direction: column;
  padding-bottom: var(--safe-b);
}
.sheet.open { transform: translateY(0); }                  /* 열림: 슬라이드업 */

/* PC: 중앙 모달로 전환 */
@media (min-width: 1024px) {
  .sheet-backdrop.open { display: grid; place-items: center; }
  .sheet { position: relative; bottom: auto; border-radius: var(--r-xl); max-height: 86vh;
           transform: translateY(24px) scale(.98); opacity: 0;
           transition: transform .28s ease, opacity .2s ease; }
  .sheet.open { transform: translateY(0) scale(1); opacity: 1; }
}

.handle { width: 40px; height: 4px; border-radius: 999px; background: var(--line); margin: 10px auto 4px; flex-shrink: 0; }
.sheet-head { padding: 8px 20px 12px; display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.sheet-head .stitle { font-size: 20px; font-weight: 800; letter-spacing: -0.03em; }
.sheet-head .sclose { margin-left: auto; width: 34px; height: 34px; border-radius: 50%;
  background: var(--surface-2); color: var(--text-sub); display: grid; place-items: center; }
.sheet-body { overflow-y: auto; padding: 4px 20px 16px; -webkit-overflow-scrolling: touch; }
.sheet-foot { padding: 12px 20px calc(16px + var(--safe-b)); flex-shrink: 0; border-top: 1px solid var(--line-2); }

/* 본문만 스크롤 + 발(입력) 항상 하단 고정 (래퍼가 있으면 flex 채움 필수) */
.chat-sheet { max-height: 92vh; max-height: 92dvh; height: 88vh; height: 88dvh; }
.chat-sheet-content { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.chat-sheet .sheet-body { flex: 1 1 auto; min-height: 0; }
```

### JS — 열기/닫기 + 키보드 맞춤
```js
function openSheet(content, extraCls) {
  const bd = $("#backdrop"), sheet = $("#sheet");
  sheet.className = "sheet" + (extraCls ? " " + extraCls : "");
  sheet.style.bottom = ""; sheet.style.maxHeight = "";
  sheet.innerHTML = ""; sheet.appendChild(handle()); sheet.appendChild(content);
  bd.classList.add("open");
  requestAnimationFrame(() => { sheet.classList.add("open"); fitSheet(); });
  document.body.style.overflow = "hidden";
  bindViewport();
}
function closeSheet() {
  const bd = $("#backdrop"), sheet = $("#sheet");
  unbindViewport();
  sheet.classList.remove("open"); bd.classList.remove("open");
  document.body.style.overflow = ""; sheet.style.bottom = ""; sheet.style.maxHeight = "";
}
// 모바일 키보드가 올라오면 시트를 보이는 영역(visualViewport)에 맞춤 → 손 조정 불필요
function fitSheet() {
  const vv = window.visualViewport, sheet = $("#sheet");
  if (!vv || !sheet || !sheet.classList.contains("open")) return;
  if (window.innerWidth >= 1024) { sheet.style.bottom = ""; sheet.style.maxHeight = ""; return; }
  const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  sheet.style.bottom = kb + "px";                       // 키보드 위로 올림
  sheet.style.maxHeight = Math.round(vv.height - 6) + "px";
}
function bindViewport()   { window.visualViewport?.addEventListener("resize", fitSheet); window.visualViewport?.addEventListener("scroll", fitSheet); }
function unbindViewport() { window.visualViewport?.removeEventListener("resize", fitSheet); window.visualViewport?.removeEventListener("scroll", fitSheet); }
```

### 접근성
- `role="dialog"` + `aria-modal="true"`, 제목과 연결.
- **Esc로 닫기**, 백드롭 클릭으로 닫기, 열렸을 때 `body { overflow: hidden }`.
- 닫기 버튼 ≥34px(탭 ≥44px 권장), 명도 대비 확인.
- 포커스: 열릴 때 첫 입력에 포커스, 닫을 때 트리거로 복귀(권장).

---

## 체크리스트
- [ ] 모든 색/그림자/라운드는 토큰 참조(다크모드 자동)
- [ ] 하단 바·시트 모두 `--safe-b` 반영
- [ ] 높이는 `vh` 대신 `dvh`(+vh 폴백)
- [ ] 입력 있는 시트는 `VisualViewport` 키보드 맞춤
- [ ] 라벨 아이콘은 라인 아이콘(무이모지), `currentColor`
- [ ] 탭 영역 ≥44px, `:focus-visible` 포커스 링
- [ ] 본문만 스크롤 / 머리·발 고정(flex 채움)
