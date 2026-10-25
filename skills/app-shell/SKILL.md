---
name: app-shell
description: Port ANA's app shell — the two scopes Workspace (members — Work · Knowledge · Files · Inbox) and System (admin — Inbox · Roadmap · Health, dark header band), the bottom menu per scope on phones, the desktop scope switch next to the logo, the workspace combo (switch, add, rename, delete, drag-reorder), Inbox and System badges, right-aligned profile, "New version available" reload pill, and per-scope remembered tabs. Use when the user says "하단 메뉴", "워크스페이스와 시스템", "Workspace System 나누기", "탭 구조", "워크스페이스 콤보", "모바일 네비게이션", "받은함", "로드맵", or when ana-update reports app-areas / workspaces missing.
---

# app-shell — where things live

Two scopes, and the top of the screen always says which one you are in:

- **Workspace** (members): **Work** (the domain tabs; base: Tasks · Calendar · Notes), **Knowledge** (relations + knowledge graph), **Files** (this workspace's folder), **Inbox** (everything waiting on you here — see agent-requests). The header shows the **workspace combo**.
- **System** (admin only): **Inbox** (approval and work requests for the admin), **Roadmap** (requirements → proposals → building → checked, plus upstream updates), **Health** (all checks on one page plus usage — see trust-checks). The header turns into a dark band labelled SYSTEM.

Members never see System: the server refuses admin actions anyway (see agent-requests › Admin and member); the shell just hides the scope.

## UX spec

```
Mobile (≤768px)                                        Desktop
┌───────────────────────────────────┐                  [logo ANA] [Workspace•3|System•4]  Tasks Calendar Notes Knowledge Files Inbox   (Chip)(A)
│[logo][Base Workspace ▾] (Chip)(A) │                  System:  dark band, [SYSTEM · Admin]  Inbox Roadmap Health
│ Tasks  Calendar  Notes            │  ← only while in Work
│ …                                  │
│                        (chat FAB)  │  FAB sits above the bottom nav
├───────────────────────────────────┤
│ Work  Knowledge  Files  Inbox•3  System•4 │  Workspace scope (System only for the admin)
│ Inbox•2  Roadmap•1  Health  ‹ Workspace   │  System scope
└───────────────────────────────────┘
```

- The profile avatar is **always the rightmost** item in the header.
- The **last tab per scope** is remembered (`localStorage ana-area`, `ana-area-tabs`). Jumping to a tab of the other scope (a request card's link, an instruction card's Open) switches scope automatically.
- **One kind per page:** pages with several kinds use sub-tabs (`SUBTABS`, `renderSubtabs`, `openSub`, `curSub`; content in `[data-subsec]`, sub-tab-only buttons in `[data-for]`): Workspace Inbox *Approvals · Work requests · Evolve · Sent*, System Inbox *Approvals · Work requests · Evolve* (Evolve is always in the Inbox — deciding; the Roadmap only follows progress), Knowledge *Links · Knowledge graph · Analysis · Ontology*, Roadmap *Requirements · Updates*, Ontology *Classes · Relations*, Health *Trustworthiness · Safety · Security · Tests · Usage*. Sub-tabs and `.toolbar` never wrap on phones (they scroll sideways).
- Lists inside Inbox, Roadmap and the admin Inbox filter **Open / Done** only (open = waiting + in progress, done = done + failed + cancelled); each card still shows its own state and actions.
- Views get bottom padding so the nav never covers content. The chat FAB moves up (`bottom: 74px + safe-area`).
- **New version pill:** when `/api/health.build` changes, "New version available — tap to reload" appears **under the header**. Its `onclick` must reload.

## Anchors / code (upstream `dashboard.html`)

`.modeseg` buttons use **`data-area`** (`ws|sys`), not `data-mode` (the theme sets `data-mode` on `<html>`). Tabs carry `data-group="ws|sys"` (`AREAS`, `WORK_VIEWS`, `SYS_VIEWS`). Bottom-menu buttons carry `data-go="<area>:<view>"`, `data-nav` and `data-scope`; `syncBottomNav(view)` lights the current one; CSS shows only the buttons of the current scope (`body.sys-mode`). `body.in-work` hides the tab strip on phones outside Tasks · Calendar · Notes. Functions: `selectTab(b)` (the one place that switches views), `applyArea(mode)` (members can't enter `sys`), `setAppMode(mode, view)`, `updateSysBadge()` (`data-inboxbadge`, `data-sysbadge`, `data-admbadge`, `data-roadbadge`, `data-healthbadge`), `showTab(v)`, `usableTab(b)`. Workspaces: `#wsCombo`, `renderWorkspaces`, `switchWorkspace`, `saveWsOrder`, `/api/workspaces`.

## Porting

1. Decide the target's split with the user: which tabs are its Work (domain), and whether it has Knowledge / Files / Inbox. Everything that decides for every workspace goes under System. Add `data-group` to each tab and a bottom-menu button per destination.
2. Copy the `.modeseg` block, the `.sys-label`, the `<nav class="bottomnav">` block, the CSS sections "영역" and "두 범위(Workspace · System)", and the JS block from `let appMode` through `setTimeout(() => setAppMode(appMode), 0)`. Replace the target's tab click handlers with `selectTab`.
3. Views list: `selectTab` toggles `<view>View` sections by `data-view`. Make the list match the target's view ids.
4. Never call `button.click()` inside a click handler to switch tabs (re-entrant clicks are dropped). Call `selectTab`.

## Verify (390px and 1280px, as member and as admin)

- Member: bottom menu Work · Knowledge · Files · Inbox, no System; `setAppMode('sys')` stays in Workspace.
- Admin: System appears; inside it the header is dark and the menu is Inbox · Roadmap · Health · Workspace.
- On phones the top tab strip shows only in Work. No horizontal scroll.
- Reload returns to the same scope and tab. A link into the other scope switches scope and tab.
- Badges: Inbox = open requests + approvals + workspace suggestions; System = admin inbox + roadmap items to start + checks at risk.
