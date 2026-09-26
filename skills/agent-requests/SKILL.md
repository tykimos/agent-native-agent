---
name: agent-requests
description: Port ANA's two agent-initiated channels — Requests (the agent asks the user for what it needs to run the system better — info, a decision, an action, or access — and the user answers, marks done, or dismisses) and Evolve (the agent proposes improvements to the app itself and implements the approved ones). Use when the user says "Requests 탭", "에이전트가 요청", "사용자에게 요청", "Evolve", "진화 제안", "개선 제안 탭", or when ana-update reports agent-requests / agent-evolve missing.
---

# agent-requests — the agent talks first

| Channel | Direction | Example |
|---|---|---|
| **Evolve** | agent → the app | "Add a due-date filter to Tasks" (the agent proposes; the user approves; the agent implements) |
| **Requests** | agent → the user | "Which calendar should I sync?", "Grant access to the shared drive", "Confirm the budget" |

## Requests

- **Kinds:** `info` (Needs info), `decision` (Decision), `action` (To do), `access` (Access). Each card has a badge, title, why it's needed, and actions.
- **API:** `POST /api/requests` registers requests (the agent calls it). Duplicates are ignored, the kind is validated, and about 100 are kept. `POST /api/request-act {id, action: answer|done|dismiss|reopen, answer?}` is what the user does.
- **Delivery to the agent:** an **answer** is also sent to the agent as a chat message (`reqAnswer` → `/api/chat`). **done / dismiss** are queued as a notification (`[ANA-NOTIFY …]`, "do not reply") and delivered when the agent's input is idle. Everything is audited with human-readable names (`nameOf`).
- **UI:** `#requestsView`, `reqCard`, `refreshRequests`, `reqAct`, `reqAnswer`, `#reqBadge` (open count, also feeds the System badge). Closed requests are folded under "Closed (N)".
- **Agent instructions:** add to the ANA's CLAUDE.md/AGENTS.md when to file a request: the agent is blocked, or would run the system better with the user's input, access, or a decision. Include the exact curl, and say to keep titles short and actionable.

## Evolve

- `POST /api/evolve` (the agent files proposals), `POST /api/evolve-act {id, action: do|done|ignore}`, `#evolveView`, `refreshEvolve`, `#evoBadge`, the "Ask the agent to analyze" button (`#evoAnalyze`) which asks the agent to review the app and propose. **do** sends "[Evolve] Implement/apply proposal #id …" to the agent.

## Porting

1. Copy the route blocks and the storage (`REQUESTS_FILE` next to the evolve file) into the extraApi module, and wire `REQUESTS_FILE` in `server.js`.
2. Copy the views, CSS (`.req-*`, `.evo-*`), and JS functions above. Put both tabs under **System** if app-shell is present.
3. Update the agent's instruction file with the request/evolve contract and curl examples.
4. Port tests C15 (requests) from upstream `test.cjs`.

## Verify

- `curl` a `decision` request → the card shows the Decision badge → answer → the agent receives the answer in chat. Mark another done → the agent gets one notification. The badge count goes down.
- Duplicate registration is ignored. An invalid kind returns 400.
- Evolve: file a proposal → Do → the chat shows the implement instruction sent.
