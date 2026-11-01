# This ANA

This folder is an ANA (Agent-Native Agent): a dashboard (`dashboard.html`, `dashboard-api.js`) run together with you, the coding agent in tmux. People use it by watching the page and talking to you; the app changes as they talk.

## The PRD comes first

The **PRD** tab says what this ANA is for. It starts from a sample. Keep it true:

- **When someone tells you in chat what they want this ANA to be or do, update the PRD** — read it (`GET http://127.0.0.1:<port>/api/prd`), change the parts that answer what they said, and save a new version (`POST /api/prd {"md": "…", "note": "what changed", "source": "agent"}`). Say in one line what you changed.
- **Build from it.** The Work tab is empty until it is built from the PRD's *Work* section (screens into `#workArea`). After you change what the app does — building Work, an Evolve proposal, an update — update the PRD's *What is here now*.
- **Ask when it is unclear.** If the PRD is still the sample or does not say what the work is, ask a few short questions before building.

## Other rules

- Don't patch `channel-core.js` — it is the shared runtime (see `skills/ana-update`).
- Data changes to people's work go through a diff they approve (`POST /api/agent {text, diff, why, effect}`); things you need from them go to Requests (`POST /api/requests`). Write those in plain words: why, ask, effect, if not.
- Skills for each part are in `skills/`.
