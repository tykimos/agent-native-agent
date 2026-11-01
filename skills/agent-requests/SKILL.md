---
name: agent-requests
description: Port ANA's Requests, Evolve and PRD tabs — Requests (what the agent needs from the user — pending data-change diffs, approval / decision / access requests, work only the user can do, missing information), Evolve (the agent looks at the work and the usage log and proposes what to do now and how the app should change, then builds the approved ones) and PRD (what this ANA is and does — the agent writes it, people edit it, every version is kept). Every card speaks plainly (why / ask / effect / ifNot). Also triggers on "PRD", "요구사항 문서". Use when the user says "Requests 탭", "에이전트가 요청", "사용자에게 요청", "Evolve", "진화 제안", "개선 제안 탭", or when ana-update reports agent-requests / agent-evolve missing.
---

# agent-requests — the agent talks first

Three tabs (see app-shell):

| Tab | 한국어 | What |
|---|---|---|
| Requests | 요청 | what the agent needs from you: pending diffs (`/api/approve`) + requests of kind `approval`, `decision`, `access`, `action` (work only you can do), `info` (information it lacks) |
| Evolve | 진화 | what to do now and how the app should change, from the work and the usage log (`/api/activity`) |
| PRD | PRD | what this ANA is and does — the agent writes it, people edit it, every version is kept |

| Channel | Direction | Example |
|---|---|---|
| **Requests** | agent → the user | "Which calendar should I sync?", "Grant access to the shared drive", "Confirm the budget" |
| **Evolve** | agent → the work and the app | "Close the three prep tasks of the workshop that passed", "When an event passes, ask how it went and tidy its tasks in one go" |

## Status lists

The lists are split by sub-tab into **Waiting · In progress · Done** (`STATUS_TABS`, `BUCKET_OF`, `bucketList`; Done also holds failed and cancelled). Each card keeps its own state and actions. Waiting and In progress list oldest first; Done and Cancelled list newest first, with the time.

| List | Waiting | In progress | Done | Failed | Cancelled |
|---|---|---|---|---|---|
| Evolve | `new` | `doing` | `done` | `failed` | `dismissed` |
| Approvals / Requests | `open` | `answered` (the agent has your answer) | `done` | `failed` | `dismissed` |
| Approvals › data changes | `pending` | `applying` | `applied` | `failed` (apply threw) | `rejected` |

Card actions follow the list:
- **Evolve:** Waiting has Discuss / Do it / Ignore. In progress has Discuss / Mark done / **Failed** / Cancel. Done has Reopen. Failed has Discuss / Try again. Cancelled has Restore. `POST /api/evolve-act {id, action: do|done|fail|ignore|reopen, reason?}`; the agent reports a failure with `fail` + `reason`, and every action stamps `updatedAt`.
- **Requests:** in progress (answered) cards get **Failed**. `POST /api/request-act` accepts `fail` + optional `reason` (the reply box text), and the agent is notified.
- **Failed data change:** if applying the diff throws, the proposal is kept as `failed` with a short `failReason` (absolute paths shortened to file names) instead of silently going back to pending. *Try again* re-approves it; Reject cancels it.
- **Data changes:** `GET /api/proposals` returns every diff proposal (last 100). Approve and reject stamp `decidedAt`.
- **Badges** count Waiting only.

## Requests

- **Kinds:** `approval` (Approval), `decision` (Decision), `access` (Access), `action` (To do), `info` (Needs info), shown as a badge on one list (`renderRequestsAll`). Each card has a badge, title, the plain fields, optional `options` (buttons that send that answer), and actions.
- **Requests also shows data changes** above the requests: diff proposals (`proposals` map) rendered with `propCard` → Approve / Reject call `/api/approve`. `renderApprovals()` re-runs on the `proposal` SSE event. The Requests badge = pending diffs + open requests.
- **Every card speaks plainly.** Requests (`/api/requests`), data changes (`/api/agent`) and Evolve proposals carry the same plain fields: `why` (what's going on), `ask` (what is asked), `effect` (what it changes), `ifNot` (if not). Cards show them as one block (`plainHtml`), falling back to `desc`. A data change without them gets a sentence from the diff (`diffEffect`, `diffRows` with item names). Every agent instruction asks for these fields in the words of the work — no graph, schema, API or diff words.
- **Asking the agent:** Requests, Evolve and PRD each have *Ask the agent*, which sends a prompt with the exact curl: [Requests] asks what the agent needs from the user (`/api/requests`), [Evolve] asks for proposals, [PRD] asks it to write or update the PRD. The instruction card in chat opens the matching tab.
- **API:** `POST /api/requests` registers requests (the agent calls it). Duplicates are ignored, the kind is validated, and about 100 are kept. `POST /api/request-act {id, action: answer|done|dismiss|reopen, answer?}` is what the user does.
- **Delivery to the agent:** an **answer** is also sent to the agent as a chat message (`reqAnswer` → `/api/chat`). **done / dismiss** are queued as a notification (`[ANA-NOTIFY …]`, "do not reply") and delivered when the agent's input is idle. Everything is audited with human-readable names (`nameOf`).
- **UI:** `#requestsView` holds `#apprDiffs` and `#reqList`; `reqCard`, `refreshRequests`, `renderRequestsAll`, `reqAct`, `reqAnswer`.
- **Agent instructions:** add to the ANA's CLAUDE.md/AGENTS.md when to file a request: the agent is blocked, or would run things better with the user's input, access, or a decision. Include the exact curl, and say to keep titles short and actionable.

## Evolve

- **In the words of the work.** The instruction (`askEvolveAgent`) has the agent read the work (`/api/state`, where the flow breaks in `/api/stats`, usage in `/api/activity`, open proposals) and propose two kinds of change: the work now (close, reschedule, follow up, decide, ask someone) and the app (named by what people get, not by mechanism). Proposals spread over three horizons — **tidy** (fix what is off), **improve** (a better way of doing this work), **reimagine** (a new way of working), at least one reimagine — with outside examples found on the web (`sources`, only pages actually opened). API, schema and file words stay out of titles, `because` and `outcome`; they go only in `how` (collapsed on the card as *How it would work*).
- **API:** `POST /api/evolve {proposals:[{horizon, type, title, because, outcome, how, sources}]}` (`horizon` must be tidy|improve|reimagine; only http(s) links are kept in `sources`), `GET /api/evolve`, `POST /api/evolve-act`.
- **UI:** `#evolveView`; `refreshEvolve`, `renderEvolve`, `evoCardsHtml` (`#evoList`), `evoAct`. Cards show the horizon, *What's going on* (`because`), *What it changes* (`outcome`), *Seen elsewhere* and *How it would work*. **Do it** sends "[Evolve] Implement/apply proposal #id …" with all of it to the agent and opens the chat; the instruction also tells it to update the PRD if what the app does changed.

## PRD

- **What:** the product requirements of this ANA in markdown — purpose, users, features, screens, data, what the agent does, what is not done yet. Written for a person who uses the app.
- **Who writes it:** *Ask the agent* sends a `[PRD]` instruction: read the code (`dashboard.html`, `dashboard-api.js`, `server.js`, `features.json`, `CHANGELOG.md`), the data, finished Evolve proposals and the current PRD, then save a new version. *Edit* lets a person change it (a markdown textarea and a "what changed" note). Evolve and Update instructions tell the agent to update it when what the app does changes.
- **Versions:** every save is a new version `{v, md, note, source: agent|person, by, at}` in `prd.json` (last 50 kept); saving the same text is not a new version. *History* lists earlier versions, each viewable and restorable (restore = a new version with the old text; nothing is lost).
- **API:** `GET /api/prd` → `{current, history}`; `POST /api/prd {md, note, source}`; `POST /api/prd {action:'restore', v}`. Large text is fine (up to 200 000 chars); post it with `--data-binary @-` from a file.
- **UI:** `#prdView` with sub-tabs Current · History; `refreshPrd`, `renderPrd` (markdown through `mdHtml`), `#prdForm`, `#prdHist`.

## Porting

1. Copy the route blocks and the storage (`REQUESTS_FILE` next to the evolve file) into the extraApi module, and wire `REQUESTS_FILE` in `server.js`.
2. Copy the views, CSS (`.req-*`, `.evo-*`, `.ib-*`, `.pl-*`, `.prd-*`), and JS functions above.
3. Update the agent's instruction file with the request/evolve contract and curl examples.
4. Port tests C15 (requests) and C7 (evolve) from upstream `test.cjs`, and the plain-fields and PRD tests from `lite.test.cjs`.

## Verify

- `curl` a `decision` request with why/ask/effect → the card shows the Decision badge and the plain block → answer → the agent receives the answer in chat. Mark another done → the agent gets one notification. The badge count goes down.
- Duplicate registration is ignored. An invalid kind returns 400.
- Evolve: file a proposal with a horizon and sources → the card shows them → Do it → the chat shows the implement instruction sent.
