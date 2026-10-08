---
name: app-shell
description: Port ANA's app shell — the Workspace / Collaborate / System split (mobile bottom nav, desktop segmented switch next to the logo), the workspace combo (switch, add, rename, delete, drag-reorder), System badge, right-aligned profile, "New version available" reload pill, and per-area remembered tabs. Use when the user says "하단 메뉴", "워크스페이스와 시스템", "Workspace System 나누기", "탭 구조", "워크스페이스 콤보", "모바일 네비게이션", or when ana-update reports app-areas / workspaces missing.
---

# app-shell — where things live

Three areas, so the user's own work, working with the agent, and running the system don't mix:

- **Workspace:** the domain tabs (base: Tasks · Calendar · Notes). The header shows the **workspace combo**.
- **Collaborate:** Evolve · Approvals · Requests (see agent-requests). Badge = new proposals + things waiting for approval + open work requests.
- **System:** Stats · Relations · Trustworthiness · Safety · Security · Update (see trust-checks, ana-update). Badge = checks at **risk** + updates waiting.
- On phones the System tab bar scrolls. The selected tab scrolls into view (`revealTab`), and the edge fades where more tabs are hidden (`.tabstrip.more-l / .more-r`).

The workspace combo shows only in Workspace.

## UX spec

```
Mobile (≤768px)                                   Desktop
┌───────────────────────────────────┐             [logo ANA] [Workspace|Collaborate•5|System•1]  Tabs…   (Chip)(✎)(⟳)(A)
│[logo][Base Workspace ▾] (Chip)(A) │
│ Tasks  Calendar  Notes            │
│ …                                  │
│                        (chat FAB)  │  FAB sits above the bottom nav
├───────────────────────────────────┤
│ ▦ Workspace  👥 Collaborate•5  ⚙ System•1 │  fixed, blurred, safe-area aware
└───────────────────────────────────┘
```

- The profile avatar is **always the rightmost** item in the header, in every area and with Chip on or off (`margin-left: auto` on the group when the combo is hidden).
- The **last tab per area** is remembered (`localStorage ana-area`, `ana-area-tabs`). Clicking a tab of the other area (e.g. a relation chip that jumps to a task) switches area automatically.
- Views get bottom padding so the nav never covers content. The chat FAB moves up (`bottom: 74px + safe-area`).
- **New version pill:** when `/api/health.build` changes, "New version available — tap to reload" appears **under the header** (never over the composer). Its `onclick` must reload; it once lost its handler during a refactor, so test it.

## Anchors / code (upstream `dashboard.html`)

`.modeseg` + `.bottomnav` buttons use **`data-area`**, not `data-mode`: the theme already sets `data-mode` on `<html>`, and the two selectors collided. Tabs carry `data-group="ws|collab|sys"` (`AREAS`). Functions: `selectTab(b)` (the one place that switches views), `applyArea(mode)`, `setAppMode(mode, view)`, `updateSysBadge()` (sets both `data-collabbadge` and `data-sysbadge`), `showTab(v)`. Workspaces: `#wsCombo`, `renderWorkspaces`, `switchWorkspace`, `saveWsOrder`, `/api/workspaces` (list/add/rename/delete/reorder, state isolated per workspace dir).

## Porting

1. Decide the target's split with the user: which tabs are its "Workspace" (domain), which are "Collaborate" (agent ↔ user), and which are "System" (health, trust, analytics). Add `data-group` to each tab.
2. Copy the `.modeseg` block (after the logo) and the `<nav class="bottomnav">` block (before the toast). Copy the CSS section "영역: Workspace / System" and the JS block from `let appMode` through `setTimeout(() => setAppMode(appMode), 0)`. Replace the target's tab click handlers with `selectTab`.
3. Views list: `selectTab` toggles `<view>View` sections by `data-view`. Make the list match the target's view ids.
4. Never call `button.click()` inside a click handler to switch tabs (re-entrant clicks are dropped). Call `selectTab`.

## Verify (390px and 1280px)

- Workspace / Collaborate / System each show only their tabs. The combo shows only in Workspace. The avatar stays right.
- Reload returns to the same area and tab.
- A relation chip or request link into the other area switches area and tab.
- The Collaborate badge counts open requests + approvals waiting + new proposals. The System badge counts risk checks.
- Bottom nav doesn't cover the last card or the FAB.
