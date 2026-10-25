---
name: agent-requests
description: Port ANA's Inbox / Roadmap / admin Inbox — Evolve (the agent looks at the app's features, data and usage log and proposes how the app should evolve, then builds the approved ones), Approvals (what the agent needs the user's OK for — pending data-change diffs plus approval / decision / access requests) and Requests (work only the user can do, and missing information). Use when the user says "Requests 탭", "에이전트가 요청", "사용자에게 요청", "Evolve", "진화 제안", "개선 제안 탭", or when ana-update reports agent-requests / agent-evolve missing.
---

# agent-requests — the agent talks first

Where they live now (see app-shell): the member's **Workspace › Inbox** gathers requests, approvals (incl. data changes) and this workspace's suggestions; the admin's **System › Roadmap** gathers requirements, system proposals and upstream updates as one line per item (Request → Proposal → Building → Checked); **System › Inbox** is the admin inbox. The table below names the item types as they were first built as separate tabs.

| Tab | 한국어 | What |
|---|---|---|
| Evolve | 진화 제안 | the agent proposes how the app should evolve, from its features, data and usage log (`/api/activity`) |
| Approvals | 승인 요청 | what the agent needs your OK for before it goes on: pending diffs (`/api/approve`) + requests of kind `approval`, `decision`, `access` |
| Requests | 작업 요청 | work only you can do (`action`) and information it lacks (`info`) |

| Channel | Direction | Example |
|---|---|---|
| **Evolve** | agent → the app | "Add a due-date filter to Tasks" (the agent proposes; the user approves; the agent implements) |
| **Requests** | agent → the user | "Which calendar should I sync?", "Grant access to the shared drive", "Confirm the budget" |

## Admin and member

Roles: `admin` decides the System, `member` works in workspaces (`roleOf(req)`; `ANA_ADMINS`; everyone is admin when the list is empty, when there's no identity header, or for local calls without identity). Server-side gates return `403 {needsAdmin:true}` for: system Evolve `do|ignore|reopen`, `update-act do|ignore|reopen`, risky permission modes, workspace delete. The page turns that into `askAdmin({type:'approval', title, action:{kind,…}})`. The admin approves it in **System › Admin**, and `runAdminAction` runs the action as the admin before the approval is recorded. Admin inbox: `admin.json` next to `evolve.json`, `GET /api/admin/inbox`, `POST /api/admin/requests`, `POST /api/admin/act`. `syncCheckRequests` opens one work request per check at risk and closes it when the check recovers. Evolve proposals carry `scope: system|workspace` (+`ws`); `escalate` copies a workspace proposal to the system (`fromId`/`escalatedTo`). Workspace proposals render in Workspace › Inbox › Evolve, system proposals in System › Inbox › Evolve.

## Requirements (user → system)

**Loop with Evolve:** a requirement judged *Not reflected* or *Partly* gets **Propose this** (`POST /api/requirements {action:'propose', id}`). It registers an Evolve proposal `Requirement #id: …` with `reqId` and the analysis's next step and reason; only one proposal stays open per requirement. When that proposal is marked done (`/api/evolve-act done`), the requirement gets `recheck {proposalId}` and its analysis is marked stale. The card says *Proposal #N is done — check again*, and re-analyzing clears it. The agent can also link a proposal it registers with `reqId` in `POST /api/evolve`.

**Requirements** (members: *Request a feature* in Inbox; admin: Roadmap) run the other direction from Requests: the **user** writes what they want this ANA to do, and the agent reports how far the system already does it.

- **Store:** `requirements.json` holds one list for the whole ANA, not per workspace: `{items:[{id, title, detail, by, at, analysis}], jobs:[…]}`. `POST /api/requirements {action: add|update|remove}` edits it. Editing the title or details marks the analysis `stale` ("Changed since — analyze again").
- **Analyze:**
  1. `POST /api/requirements/analyze {ids?}` starts a job for all requirements, or one card's *Analyze this*. One job runs at a time.
  2. The page sends the agent a `[Requirements]` instruction with the curls. The agent reads `GET /api/requirements/input?job=`, which includes this ANA's folder, `features.json` and `CHANGELOG.md`, and is told to check the real code, dashboard, APIs and data and change nothing.
  3. It reports `POST /api/requirements/progress {job, progress, step}`, then posts `POST /api/requirements/result {job, summary, results:[{id, status: reflected|partial|missing, how, why, evidence[], next}]}`. Results for unknown ids or with another status are dropped. `/fail` and `/cancel` end a job.
- **Screen:**
  - An input card on top, then the Analyze button with a one-line tally, then a progress or last-analysis card.
  - A filter: All · Reflected · Partly · Missing · Unchecked, with counts.
  - Cards with a status badge and the analysis: *How it is reflected* (or *Current state*), *Why not (yet)*, *Evidence*, *Next step*.
  - Each card has Analyze again, Discuss (adds a context chip), Edit and Delete.

## Status lists

The lists show **Open / Done** (`TWO_KEYS`; `bucketList` adds `open` = waiting + in progress and `closed` = done + failed + cancelled); each card keeps its own state and actions, from the five underlying states **Waiting · In progress · Done · Failed · Cancelled**, with a count on each (`ST_BUCKETS`, `BUCKET_OF`, `renderStSeg`). The pick is remembered per tab in `localStorage ana-collab-filter`. Waiting and In progress list oldest first; Done and Cancelled list newest first, with the time.

| Tab | Waiting | In progress | Done | Failed | Cancelled |
|---|---|---|---|---|---|
| Evolve | `new` | `doing` | `done` | `failed` | `dismissed` |
| Approvals / Requests | `open` | `answered` (the agent has your answer) | `done` | `failed` | `dismissed` |
| Approvals › data changes | `pending` | `applying` | `applied` | `failed` (apply threw) | `rejected` |

Card actions follow the list:
- **Evolve:** Waiting has Discuss / Do it / Ignore. In progress has Discuss / Mark done / **Failed** / Cancel. Done has Reopen. Failed has Discuss / Try again. Cancelled has Restore. `POST /api/evolve-act {id, action: do|done|fail|ignore|reopen, reason?}`; the agent reports a failure with `fail` + `reason`, and every action stamps `updatedAt`.
- **Requests:** in progress (answered) cards get **Failed**. `POST /api/request-act` accepts `fail` + optional `reason` (the reply box text), and the agent is notified.
- **Failed data change:** if applying the diff throws, the proposal is kept as `failed` with a short `failReason` (absolute paths shortened to file names) instead of silently going back to pending. *Try again* re-approves it; Reject cancels it.
- **Data changes:** `GET /api/proposals` returns every diff proposal of the workspace (last 100). Approve and reject stamp `decidedAt`.
- **Badges** count Waiting only.

## Requests

- **Kinds:** `approval` (Approval), `decision` (Decision), `access` (Access) → **Approvals** tab. `action` (To do), `info` (Needs info) → **Requests** tab (`APPROVAL_KINDS` splits them; `renderReqBox(prefix, list)` renders each box). Each card has a badge, title, why it's needed, optional `options` (buttons that send that answer), and actions.
- **Approvals also shows pending data changes:** diff proposals (`proposals` map, status `pending`) rendered with `propCard` → Approve / Reject call `/api/approve`. `renderApprovals()` re-runs on the `proposal` SSE event. The Approvals badge = pending diffs + open approval-kind requests.
- **Asking the agent:** each tab has a button that sends the agent a prompt with the exact curl: Evolve "Ask the agent to analyze", Approvals "Ask the agent what needs my approval", Requests "Ask the agent what it needs".
- **API:** `POST /api/requests` registers requests (the agent calls it). Duplicates are ignored, the kind is validated, and about 100 are kept. `POST /api/request-act {id, action: answer|done|dismiss|reopen, answer?}` is what the user does.
- **Delivery to the agent:** an **answer** is also sent to the agent as a chat message (`reqAnswer` → `/api/chat`). **done / dismiss** are queued as a notification (`[ANA-NOTIFY …]`, "do not reply") and delivered when the agent's input is idle. Everything is audited with human-readable names (`nameOf`).
- **UI:** `#inboxView` holds `#apprDiffs`, `#apprList`, `#reqList` (Needs you), `#evoList` (Suggestions) and `#toAdmin` (Sent by you: admin requests + my feature requests, `renderToAdmin`); `renderInboxSeg` sums the Open/Done counts; `reqCard`, `refreshRequests`, `reqAct`, `reqAnswer`. Both feed the Inbox badge. Closed ones are folded under "Closed (N)" in each tab.
- **Agent instructions:** add to the ANA's CLAUDE.md/AGENTS.md when to file a request: the agent is blocked, or would run the system better with the user's input, access, or a decision. Include the exact curl, and say to keep titles short and actionable.

## Evolve

- `POST /api/evolve` (the agent files proposals, `scope: system|workspace`), `POST /api/evolve-act {id, action: do|done|fail|ignore|reopen|escalate}`, `refreshEvolve`, `askEvolveAgent(scope)` (`#evoAnalyze` in Inbox for the workspace, `#sysEvoAnalyze` in Roadmap for the system); both render with `evoCardsHtml` — workspace proposals in Workspace › Inbox › Evolve (`#evoList`), system ones in System › Inbox › Evolve (`#sevoList`); the Roadmap (`renderRoadmap`: `reqState`, `updState`) only follows requirements and updates) which asks the agent to review the app and propose. **do** sends "[Evolve] Implement/apply proposal #id …" to the agent.

## Porting

1. Copy the route blocks and the storage (`REQUESTS_FILE` next to the evolve file) into the extraApi module, and wire `REQUESTS_FILE` in `server.js`.
2. Copy the views, CSS (`.req-*`, `.evo-*`, `.ib-*`, `.rm-*`), and JS functions above. Put Inbox under Workspace and Roadmap / admin Inbox under System if app-shell is present.
3. Update the agent's instruction file with the request/evolve contract and curl examples.
4. Port tests C15 (requests) from upstream `test.cjs`.

## Verify

- `curl` a `decision` request → the card shows the Decision badge → answer → the agent receives the answer in chat. Mark another done → the agent gets one notification. The badge count goes down.
- Duplicate registration is ignored. An invalid kind returns 400.
- Evolve: file a proposal → Do → the chat shows the implement instruction sent.
