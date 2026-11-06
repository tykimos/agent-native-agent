# This ANA

This folder is an ANA (Agent-Native Agent): a dashboard (`dashboard.html`, `dashboard-api.js`) run together with you, the coding agent in tmux. People use it by watching the page and talking to you; the app changes as they talk. Using it is building it.

## Start from a conversation

A new ANA has **no PRD and an empty Work tab**. The PRD is written *from* the first conversation, not before it.

- **Talk to ANA** sends you a `[PRD] Let's shape this ANA's PRD together` instruction. That is the PRD conversation: **you speak first** — greet in one line, say in a sentence or two what a PRD is with one small example (they may not know the word), and ask what product they want to make (in their language), then lead with one short question at a time. Build nothing until they agree to a first version.
- **When someone tells you what they want this ANA to do** (the PRD is empty, or they describe new work): ask only what you still need — who it is for, what they handle, what they want to see — in a few short questions. Then, **in the same turn**:
  1. write the PRD with the sections of `prd-template.md` and save it (`GET`/`POST http://<this server>/api/prd {"md": "…", "note": "what changed", "source": "agent"}`; `GET /api/agent-base` gives the address);
  2. build the first Work screen into `#workArea` in `dashboard.html` (with `<nav class="subtabs" data-sub="work">` and `SUBTABS.work` if there are several kinds of work), with the data and routes it needs in `dashboard-api.js`. Keep each kind of work item in `work-graph.json` as one array (`quotes: [...]`) and declare the kind in `work-ontology.js` (`list`, `title`, and a `derived` relation for each field that points at another item) — then its items join the one graph (NodeRel) with everything else, show in Knowledge › Ontology and Graph, and `/api/graph/trace` can follow them;
  3. say in two or three lines what you wrote and built, and what you would ask next.
- **Sketches.** People can draw a rough screen (Sketch) and send it; it arrives as an image attachment (`.ana/uploads/sketch-….png`). Read it, build from it, and keep it in the PRD under *Sketches* as `![what it shows](/uploads/<file name>)`.
- **Keep the PRD true.** Whenever what the app does changes — a request in chat, an Evolve proposal, an update — update the PRD (*Work*, *What is here now*) and save a new version.

## Other rules

- Don't patch `channel-core.js` — it is the shared runtime (see `skills/ana-update`).
- Data changes to people's work go through a diff they approve (`POST /api/agent {text, diff, why, effect}`); things you need from them go to Requests (`POST /api/requests`). Write those in plain words: why, ask, effect, if not.
- To show a picture in the chat (a screenshot, a captcha, a chart you made), write `![what it is](/absolute/path.png)` on its own line. The file must be a png/jpg/gif/webp inside this folder or your scratchpad — anywhere else it will not show.
- Skills for each part are in `skills/`.
