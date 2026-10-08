---
name: agent-requests
description: Port ANA's Collaborate area — Evolve (the agent looks at the app's features, data and usage log and proposes how the app should evolve, then builds the approved ones), Approvals (what the agent needs the user's OK for — pending data-change diffs plus approval / decision / access requests) and Requests (work only the user can do, and missing information). Use when the user says "Requests 탭", "에이전트가 요청", "사용자에게 요청", "Evolve", "진화 제안", "개선 제안 탭", or when ana-update reports agent-requests / agent-evolve missing.
---

# agent-requests — the agent talks first

All three live under **Collaborate** (see app-shell):

| Tab | 한국어 | What |
|---|---|---|
| Evolve | 진화 제안 | the agent proposes how the app should evolve, from its features, data and usage log (`/api/activity`) |
| Approvals | 승인 요청 | what the agent needs your OK for before it goes on: pending diffs (`/api/approve`) + requests of kind `approval`, `decision`, `access` |
| Requests | 작업 요청 | work only you can do (`action`) and information it lacks (`info`) |

| Channel | Direction | Example |
|---|---|---|
| **Evolve** | agent → the app | "Add a due-date filter to Tasks" (the agent proposes; the user approves; the agent implements) |
| **Requests** | agent → the user | "Which calendar should I sync?", "Grant access to the shared drive", "Confirm the budget" |

## Four lists in every tab

Each Collaborate tab has a status filter, **Waiting · In progress · Done · Cancelled**, with a count on each (`ST_BUCKETS`, `BUCKET_OF`, `renderStSeg`). The pick is remembered per tab in `localStorage ana-collab-filter`. Waiting and In progress list oldest first; Done and Cancelled list newest first, with the time.

| Tab | Waiting | In progress | Done | Cancelled |
|---|---|---|---|---|
| Evolve | `new` | `doing` | `done` | `dismissed` |
| Approvals / Requests | `open` | `answered` (the agent has your answer) | `done` | `dismissed` |
| Approvals › data changes | `pending` | `applying` | `applied` | `rejected` |

Card actions follow the list:
- **Evolve:** Waiting has Discuss / Do it / Ignore. In progress has Discuss / Mark done / Cancel. Done has Reopen. Cancelled has Restore. `POST /api/evolve-act` accepts `reopen`, and every action stamps `updatedAt`.
- **Data changes:** `GET /api/proposals` returns every diff proposal of the workspace (last 100). Approve and reject stamp `decidedAt`.
- **Badges** count Waiting only.

## Requests

- **Kinds:** `approval` (Approval), `decision` (Decision), `access` (Access) → **Approvals** tab. `action` (To do), `info` (Needs info) → **Requests** tab (`APPROVAL_KINDS` splits them; `renderReqBox(prefix, list)` renders each box). Each card has a badge, title, why it's needed, optional `options` (buttons that send that answer), and actions.
- **Approvals also shows pending data changes:** diff proposals (`proposals` map, status `pending`) rendered with `propCard` → Approve / Reject call `/api/approve`. `renderApprovals()` re-runs on the `proposal` SSE event. The Approvals badge = pending diffs + open approval-kind requests.
- **Asking the agent:** each tab has a button that sends the agent a prompt with the exact curl: Evolve "Ask the agent to analyze", Approvals "Ask the agent what needs my approval", Requests "Ask the agent what it needs".
- **API:** `POST /api/requests` registers requests (the agent calls it). Duplicates are ignored, the kind is validated, and about 100 are kept. `POST /api/request-act {id, action: answer|done|dismiss|reopen, answer?}` is what the user does.
- **Delivery to the agent:** an **answer** is also sent to the agent as a chat message (`reqAnswer` → `/api/chat`). **done / dismiss** are queued as a notification (`[ANA-NOTIFY …]`, "do not reply") and delivered when the agent's input is idle. Everything is audited with human-readable names (`nameOf`).
- **UI:** `#approvalsView` (`#apprDiffs`, `#apprList`, `#apprClosed`, `#apprBadge`), `#requestsView` (`#reqList`, `#reqClosed`, `#reqBadge`), `reqCard`, `refreshRequests`, `reqAct`, `reqAnswer`. Both feed the Collaborate badge. Closed ones are folded under "Closed (N)" in each tab.
- **Agent instructions:** add to the ANA's CLAUDE.md/AGENTS.md when to file a request: the agent is blocked, or would run the system better with the user's input, access, or a decision. Include the exact curl, and say to keep titles short and actionable.

## Evolve

- `POST /api/evolve` (the agent files proposals), `POST /api/evolve-act {id, action: do|done|ignore}`, `#evolveView`, `refreshEvolve`, `#evoBadge`, the "Ask the agent to analyze" button (`#evoAnalyze`) which asks the agent to review the app and propose. **do** sends "[Evolve] Implement/apply proposal #id …" to the agent.

## Porting

1. Copy the route blocks and the storage (`REQUESTS_FILE` next to the evolve file) into the extraApi module, and wire `REQUESTS_FILE` in `server.js`.
2. Copy the views, CSS (`.req-*`, `.evo-*`), and JS functions above. Put the three tabs under **Collaborate** if app-shell is present.
3. Update the agent's instruction file with the request/evolve contract and curl examples.
4. Port tests C15 (requests) from upstream `test.cjs`.

## Verify

- `curl` a `decision` request → the card shows the Decision badge → answer → the agent receives the answer in chat. Mark another done → the agent gets one notification. The badge count goes down.
- Duplicate registration is ignored. An invalid kind returns 400.
- Evolve: file a proposal → Do → the chat shows the implement instruction sent.
