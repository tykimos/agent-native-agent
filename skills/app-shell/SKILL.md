---
name: app-shell
description: Port ANA's app shell — one workspace, six tabs in a menu under the ANA logo (PRD with Current / History, Work with a sub-tab per kind of work, Knowledge with Ontology / Graph, Requests · Evolve · Update with Waiting / In progress / Done), the bottom menu on phones, sub-tabs, badges, right-aligned profile, "New version available" reload pill, and the remembered tab. Use when the user says "하단 메뉴", "탭 구조", "모바일 네비게이션", "워크 탭", "서브탭", or when ana-update reports app-tabs missing.
---

# app-shell — where things live

One workspace, six tabs, in this order:

| Tab | Sub-tabs | What |
|---|---|---|
| **PRD** | Current · History | what this ANA is and does (see agent-requests) |
| **Work** | none at first; one per kind of work once built | empty until the agent builds it from the PRD (*Build Work from the PRD*) into `#workArea` |
| **Knowledge** | Ontology · Graph · Documents | one graph of everything here — kinds and relations, items, things, documents and their links (see agent-requests) |
| **Requests** | Waiting · In progress · Done | what the agent needs from you (see agent-requests) |
| **Evolve** | Waiting · In progress · Done | proposals for the work and the app (see agent-requests) |
| **Update** | Waiting · In progress · Done | features from upstream not yet here (see ana-update) |

## UX spec

```
Mobile (≤768px)                                        Desktop
┌───────────────────────────────────┐                  [logo ANA]  PRD  Work  Knowledge  Requests•3  Evolve•1  Update•2   (Chip)(✎)(⟳)(A)
│[logo]                  (Chip)(A)  │                  ─────────────────────────────────────────
│ Tasks  Calendar  Notes            │  ← sub-tabs      Tasks  Calendar  Notes
│ …                                  │
│                        (chat FAB)  │  FAB sits above the bottom nav
├───────────────────────────────────┤
│ PRD Work Knowl. Requests Evolve Upd│
└───────────────────────────────────┘
```

- The profile avatar is **always the rightmost** item in the header; on phones the top tab strip is hidden (the bottom menu does its job) and the Chip switch group sits at the right (`#modeToggle { margin-left: auto }`).
- The **last tab** is remembered (`localStorage ana-tab`), and each tab's sub-tab too (`ana-subtabs`).
- **Work sub-tabs switch screens:** each Work screen (`todoView`, `scheduleView`, `memoView`) carries the same `<nav class="subtabs" data-sub="work">`; picking one shows that screen. A domain ANA replaces them with its own kinds of work.
- **Status sub-tabs** (Requests, Evolve, Update): Waiting · In progress · Done (`STATUS_TABS`). Done also holds failed and cancelled items; each card still shows its own state and actions. Waiting and In progress show a count.
- Sub-tabs and `.toolbar` never wrap on phones (they scroll sideways). Views get bottom padding so the nav never covers content. The chat FAB moves up (`bottom: 74px + safe-area`).
- **Badges** on Requests, Evolve and Update count what is waiting (`setBadge('data-reqbadge' | 'data-evobadge' | 'data-updbadge', n)`).
- **New version pill:** when `/api/health.build` changes, "New version available — tap to reload" appears **under the header**. Its `onclick` must reload.

## Anchors / code (upstream `dashboard.html`)

The tabs live in a dropdown (`#tabMenu`; *System* sits below a separator — status and Restart server / Restart agent, `refreshSystem`, `GET /api/system`, `POST /api/system/restart {what}`) that the ANA logo (`#brandBtn`) opens — `openTabMenu(on)`; the logo shows the current tab (`#brandCur`) and the sum of the Requests · Evolve · Update badges (`#brandBadge`); choosing, clicking outside or Esc closes it, ↑/↓ move. The tabs and the bottom-menu buttons carry `data-view` = `prd | work | knowledge | requests | evolve | update`. `TABS`, `WORK_VIEWS`, `VIEWS` list them. Functions: `selectTab(b)` (the one place that switches tabs; for Work it shows `curSub('work')`), `showTab(v)` (any screen, including a Work screen → picks that sub-tab), `syncBottomNav(tab)`, `setBadge`. Sub-tabs: `SUBTABS`, `renderSubtabs` (renders every `.subtabs[data-sub=v]`, toggles `[data-subsec]`, and puts the open tab's sub-tabs into the top bar `#topSub` — the `.subtabs` rows inside views stay as placeholders and are hidden), `openSub`, `curSub`, `setSubCount`, `RENDER_SUB` (re-renders a status list when its sub-tab changes), `REFRESH_TAB` (loads a tab's data when it opens).

## Porting

1. Decide the target's Work sub-tabs with the user (its own kinds of work). Put the Work `<nav class="subtabs" data-sub="work">` at the top of each Work screen and list them in `SUBTABS.work` and `WORK_VIEWS`.
2. Copy the top tab strip, the `<nav class="bottomnav">` block, their CSS, and the JS block from `/* ================= 탭 전환` through the first `setTimeout(() => selectTab(…), 0)`, plus the sub-tab block. Replace the target's tab click handlers with `selectTab` / `showTab`.
3. Never call `button.click()` inside a click handler to switch tabs (re-entrant clicks are dropped). Call `selectTab` or `showTab`.

## Verify (390px and 1280px)

- Six tabs on desktop and in the bottom menu on phones, in the order PRD · Work · Knowledge · Requests · Evolve · Update; the app opens on Work. No horizontal scroll.
- Work: each sub-tab opens its screen; a relation chip that points to an event opens Work › Calendar.
- Requests / Evolve / Update: Waiting · In progress · Done each show their items; badges count Waiting.
- Reload returns to the same tab and sub-tab. An instruction card's *Open* goes to its tab and sub-tab.
