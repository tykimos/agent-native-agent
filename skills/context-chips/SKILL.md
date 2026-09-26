---
name: context-chips
description: Port or rebuild ANA's context chips — the Chip mode toggle that lets the user tap any on-screen item to attach it to the next chat message, the ✎ draw button that lets them circle things on the screen and send an annotated screenshot plus the items under the marks, and the ⟳ rescan button that registers newly added UI elements as chip targets. Use when the user says "컨텍스트 칩", "칩 모드", "그리기 버튼", "화면에 표시해서 보내기", "annotation", "요소 추가", "새로고침 버튼으로 칩 등록", or when ana-update reports context-chips / context-draw missing.
---

# context-chips — point at the screen instead of describing it

The user shouldn't have to type "the second task on the Tasks tab". They switch on **Chip**, tap the thing, and it rides along with the next message. Or they draw on the screen.

## UX spec

```
[logo] [Workspace ▾]          ( ◉ Chip ) (✎) (⟳) (A)
                                          │    │    └ profile, always right-aligned
                                          │    └ rescan: register new on-screen elements as chip targets
                                          └ draw: only shown while Chip is on, placed BEFORE ⟳
```

- **Chip toggle:** a switch. While on, chip-able items get a subtle affordance (outline on hover/tap target). Tapping an item adds a chip above the chat input: `[Task] Book the venue ✕`. Tapping it again removes the chip. Chips are sent as a `Context:` block (`- [Kind] text`), and the chat log view turns them back into chips on the user's bubble.
- **Screen chip:** there's always one chip describing the view: workspace, tab, scroll position, viewport size.
- **✎ Draw (annotation):** covers the page with a canvas. The bar at the bottom has pen colors **red `#FF0000`, magenta `#FF00FF`, blue `#0000FF`**: pure hues the model recognizes reliably. Strokes are 5px color over a 9px white outline so they read on any background. Buttons: **Undo / Cancel / Add to chat**. Mostly used to circle things, like annotating a slide.
- **Add to chat:**
  1. Captures the page (`modern-screenshot`, served locally at `/vendor/modern-screenshot.mjs`) and composites the strokes on top.
  2. Uploads the result as `annotation-<tab>-<ts>.png` (JPEG if > 8 MB).
  3. Adds chips for the items under the marks (`drawTargetsUnder`), with the draw layer set to `pointer-events: none` while probing with `elementFromPoint`.
  4. The Screen chip says "red marks … annotated screenshot attached — look for the red pen marks (white-outlined)".
  5. **On mobile the chat opens immediately.**
  6. If capture fails, it falls back to the chips plus an error line; never a silent failure.
- **⟳ Rescan:** the chip target list (`CAP`) is hand-written, so UI added later isn't chip-able. Rescan walks every `#main section.view` and finds "unit-looking" elements not covered by `CAP` (not containers, not control-only). It registers class-based selectors (`selectorFor`), so they survive re-renders, and stores them in `localStorage['ana-chip-extra']`. It then flashes the new ones (`.chip-new`) and toasts "N new element types".

## Anchors / code (upstream `dashboard.html`)

| What | Anchors |
|---|---|
| Toggle + buttons | `#modeToggle`, `#drawBtn`, `#chipScanBtn`, `function setMode` |
| Chip state & message | `contextChips`, `function renderChips`, `function addChip`, `function clearChips`, `function buildMessage` |
| Targets | `const CAP = [...]` (selector, kind, text getter), `function applyChipAffordance`, `function scanChipTargets`, `function registerChipTarget`, `function loadChipExtra`, `function selectorFor`, `function isControlOnly`, `function coveredByCap` |
| Draw | `#drawLayer`, `#drawCanvas`, `#drawUndo #drawCancel #drawDone`, `function openDraw`, `function closeDraw`, `function drawRepaint`, `function drawTargets`, `function drawTargetsUnder` |
| Server | `/vendor/modern-screenshot.mjs` route (serves `node_modules/modern-screenshot/dist/index.mjs`), npm dep `modern-screenshot` |

## Porting into an existing ANA

1. `npm i modern-screenshot`, then add the `/vendor/modern-screenshot.mjs` route to the extraApi module. Uploads need `/api/upload`; port `chat-attachments` from chat-window first if it's missing.
2. Copy the header buttons (`#modeToggle`, `#drawBtn`, `#chipScanBtn`) into the target's header, before its profile button. Copy the CSS for `.mode-toggle`, `.chip*`, `.draw-layer`, `.draw-bar`, `.chip-new`.
3. **Rewrite `CAP` for the target's own domain.** das-ana has disks/volumes, not tasks. List the target's unit elements (cards, rows, KPIs) with a kind and a short text getter. This is the only part that is not copy-paste.
4. Copy the JS blocks listed above. `buildMessage()` must prepend the `Context:` block exactly as upstream, because the chat log view parses it back into chips.
5. Mobile header spacing: the Chip switch, ✎, ⟳, and profile keep 8px gaps. Their group sits at the right (`margin-left: auto` on the toggle when there's no workspace combo).

## Verify

- Chip on → tap 3 different item kinds → 3 chips → send → the agent receives a `Context:` block. The bubble shows the chips.
- ✎ → circle an item in red → Add to chat → at 390px the chat opens, the thumbnail shows the red circle, and the chip for that item exists.
- Add a new kind of card to a view → ⟳ → toast says 1 new type → tapping it in Chip mode makes a chip, and it survives a reload.
- Chip off hides ✎, and ⟳ remains.
