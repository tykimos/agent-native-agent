<div align="center">

<img src="docs/assets/ana-logo.png" width="92" alt="ANA logo" />

# ANA — Agent‑Native Agent

### Build apps you operate by watching and talking.

> **Two editions.** **Agent-Native Agent** (this repository, AGPL) is the simple one: chat with your coding agent and six tabs — PRD, Work (tasks, calendar, notes and how they link), Knowledge, Requests, Evolve and Update. **Agent-Native Agent Pro** (commercial) adds a knowledge layer that grows from the work (analysis, knowledge graph, ontology with rules), the Graph view, a System scope with admin and member roles, Roadmap and Health, several workspaces, a Claude account per session and an offline edition. Ask about Pro: [COMMERCIAL.md](COMMERCIAL.md).

[![Stars](https://img.shields.io/github/stars/tykimos/agent-native-agent?style=for-the-badge&logo=github&color=CC785C)](https://github.com/tykimos/agent-native-agent/stargazers)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-1f6feb?style=for-the-badge)](LICENSE)
[![Built for Claude Code](https://img.shields.io/badge/built%20for-Claude%20Code-CC785C?style=for-the-badge)](https://claude.com/claude-code)
[![Zero-dependency runtime](https://img.shields.io/badge/runtime_dependencies-0-111?style=for-the-badge)](channel-core.js)
[![Last commit](https://img.shields.io/github/last-commit/tykimos/agent-native-agent?style=for-the-badge&color=64748b)](https://github.com/tykimos/agent-native-agent/commits/main)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-22c55e?style=for-the-badge)](#contributing)

**English** · [한국어](README.ko.md)

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dashboard-ana-dark.webp" />
  <img src="docs/assets/dashboard-ana-light.webp" alt="ANA — talk with the agent; it writes the PRD and builds the app" />
</picture>

</div>

---

## TL;DR

**ANA is an _Agent‑Native Agent_ for _Agent‑Native Lifestyle_ (ANL).** It is a self‑hosted app you operate by **watching** a live dashboard and **conversing** with a coding agent that serves as the runtime. Need a new behavior? Ask once — ANA proposes the change, applies it on approval, and evolves the app at runtime. No PR, no ship step — the running agent rewrites the app live and the dashboard reloads.

> Use = Build. That's the whole idea.

---

## Why Agent, Not Assistant

An assistant waits for instructions. An agent uses judgment, executes, and improves the tools around your work. Every tool today still forces a trade‑off between **using** and **building** — ANA collapses that gap.

|  | SaaS / Apps | No‑code | Chatbots | Coding agents | **ANA** |
|---|:---:|:---:|:---:|:---:|:---:|
| Use it instantly | ✅ | ✅ | ✅ | ❌ | ✅ |
| Change *anything* | ❌ | ⚠️ in‑box | ❌ | ✅ | ✅ |
| Sees your live data | ✅ | ✅ | ⚠️ | ⚠️ | ✅ |
| **Change it while using it — same conversation** | ❌ | ❌ | ❌ | ⚠️ | ✅ |
| You fully own it (self‑host) | ❌ | ❌ | ❌ | ✅ | ✅ |

SaaS is *instant but frozen*. Coding agents are *infinitely malleable but build‑time only* — you ship, then use. **ANA makes using the app (talking) the same act as building it (changing behavior),** because the agent is native to the runtime.

---

## The Three Principles

1. **Watch + Converse** — visual state and chat live in *one* view. You operate by looking and talking, not clicking through fixed UI.
2. **Agent as Runtime** — the agent reads your data, acts, and **rewrites the app's own code** when asked. Inference is the runtime.
3. **Own Your Harness** — zero dependencies, self‑hosted, yours forever. It keeps evolving with you.

These are also the acceptance criteria for every ANA built with this harness.

---

## How it works

```mermaid
flowchart TB
  subgraph UX["Watch + Converse (browser)"]
    direction LR
    U["User"] <--> D["Dashboard"]
  end

  subgraph RT["ANA runtime — one file: channel-core.js"]
    direction LR
    S["Server"] -->|"paste-buffer + Enter"| A["Coding agent · tmux"]
    A -->|"capture-pane · 300ms"| S
  end

  D -->|"POST /api/chat"| S
  S -->|"SSE /api/stream + proposals"| D
```

There is **no bridge and no MCP**. The browser posts to the server, the server injects the text straight into the tmux pane, and a 300 ms `capture-pane` loop mirrors the session back as an append-only ledger over SSE. For rich replies the agent posts a **proposal** (before/after + approve card); on approval the server applies the diff and bumps a `version` so every device re-syncs. When the agent keeps a structured log (Claude Code, Codex), the chat is rendered from that log instead of the screen, so replies and tool calls come through exactly. **The coding agent is the backend** — you grow the app by talking to it.

---

## Start without local installation — GitHub Codespaces

Run ANA in your browser without installing WSL, Node or tmux on your computer. Bring a GitHub account and Claude Code access, then sign in to Claude once inside the codespace.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/tykimos/agent-native-agent?ref=main)

**[Browser quick-start guide](docs/codespaces.md)** — automatic setup → open **ANA / 8809** in Ports → complete Claude setup in ANA chat. Keep the port **Private**. Codespaces usage is billed separately from Claude; ANA stops when the codespace stops.

## Quickstart — run the base (2 min)

**Prerequisites:** Node ≥ 24, tmux, and a coding-agent CLI (e.g. [Claude Code](https://claude.com/claude-code)). The runtime (`channel-core.js`) has zero dependencies; the base app has one, [NodeRel](https://github.com/tykimos/NodeRel), installed from GitHub with `npm install`.

### Install & run with the `install` skill (recommended)

The **[`install` skill](skills/install/SKILL.md)** takes a fresh machine to a running dashboard. It checks the environment first, installs only what's missing (Node ≥ 24, tmux, git, curl, Claude Code) plus the npm dependency, then starts the agent and the server in tmux and health-checks them. Every script is safe to re-run.

```bash
git clone https://github.com/tykimos/agent-native-agent ~/ana/base-ana && cd ~/ana/base-ana
bash skills/install/scripts/check-env.sh   # 1) analyze — reports only, changes nothing
bash skills/install/scripts/install.sh     # 2) install what's missing (brew / apt / dnf / pacman …)
bash skills/install/scripts/run.sh         # 3) tmux "base-ana-claude" (agent) + "srv-base-ana-claude" (server) → URL printed
bash skills/install/scripts/run.sh status  #    later: status | stop | restart
```

| Script | What it does |
|---|---|
| `check-env.sh` | Detects macOS / Linux / WSL / Git Bash and checks node, tmux, git, curl, claude, repo location and port. Ends with `ANA_ENV … ready=yes\|no` |
| `install.sh` | Installs only what's missing (Homebrew on macOS, the system package manager + NodeSource on Linux/WSL) plus the Claude Code CLI, and clones the repo if run outside it |
| `run.sh` | Starts or reuses the tmux sessions, picks a free port when 8809 is taken, runs a health check. `ANA_NAME`, `TMUX_SESSION`, `PORT` and `AGENT_CMD` override the defaults |
| `install-wsl.ps1` | **Windows:** tmux only runs inside WSL. This installs WSL + Ubuntu (reboot, run again), then installs and starts ANA inside WSL. Open `http://localhost:8809` from the Windows browser |

```powershell
# Windows (PowerShell; Administrator for the first run only)
powershell -ExecutionPolicy Bypass -File skills\install\scripts\install-wsl.ps1
```

With the skill installed in Claude Code (this repo is a plugin), just ask: *"install ANA"* / *"ANA 설치해줘"*. The agent runs the same steps and tells you when to finish the one-time Claude login (`tmux attach -t base-ana-claude`, detach with `Ctrl-b d`).

### Manual run

```bash
git clone https://github.com/tykimos/agent-native-agent ~/ana/base-ana
cd ~/ana/base-ana

# 1) start your coding agent inside tmux
tmux new -s base-ana-claude   # inside the session, run:  claude   (or any agent CLI)

# 2) in another terminal, start ANA
node server.js           # → http://localhost:8809
```

Open **http://localhost:8809** and tap the chat button. The server needs **no launcher** (`run.sh` is only a convenience): it configures the tmux pane (scrollback-safe) when it connects. Runtime state lives in `.ana/` (git-ignored). On first run the board is seeded with two small example flows (`ANA_SEED=0` to start empty).

### Naming convention

- **Folder → ANA name.** Every ANA lives in `~/ana/<xxx>-ana` (or `/ana/<xxx>-ana`), and that folder name is the ANA's name. `<xxx>` may contain hyphens (`~/ana/sales-team-ana` → `sales-team-ana`). The sample is `~/ana/base-ana`; a folder that doesn't end in `-ana` falls back to `base-ana`.
- **tmux → `<xxx>-ana-<yyy>`.** Agent sessions are named after the ANA plus an agent label: `base-ana-claude`, `base-ana-codex`, or any hyphenated label (`base-ana-review-2`). The default session is `<xxx>-ana-claude`.
- **Chat session list.** The chat's session picker shows only this ANA's `<xxx>-ana-<yyy>` sessions (plus the one it is connected to). `run.sh` names its server session `srv-…`, so it stays out of the list.
- **Overrides.** `ANA_NAME` sets the name, `TMUX_SESSION` sets the default session (existing deployments keep working), `ANA_TMUX_ALL=1` lists every tmux session.

---

## What's in the base

The base starts **empty**: you tell ANA in the chat what your work is — in words or with a rough sketch — and it writes the PRD and builds the screens with you. Using it is building it. It has one workspace and six tabs (a bottom menu on phones):

| Tab | Sub-tabs | What |
|---|---|---|
| **PRD** | Current · History | what this ANA is and does — purpose, users, work, sketches, knowledge, what the agent does. **A new ANA has none: it opens here and you start by talking.** Tell ANA in the chat what the work is (or pick an example, or sketch a screen); it asks what it needs, writes the PRD and builds the first Work screen in the same turn. Edit it any time; every save is a new version you can view or restore |
| **Work** | — | the screens for your work. **Empty at first;** the agent builds them as you talk (with sub-tabs if there are several kinds of work) |
| **Knowledge** | Ontology · Graph · Documents | what your work is about: the kinds of things and how they relate (ontology), and the actual things and the facts between them, each tied to the items it came from (graph). It starts empty; *Ask the agent* has it read your work and add to both, and you remove what is wrong. *Documents* holds the files the agent should know about (specs, price lists, manuals — up to 25 MB each); it reads them and points facts back to them |
| **Requests** | Waiting · In progress · Done | what the agent needs from you: data changes it proposes (nothing changes until you approve), approvals, decisions, access, things only you can do, missing information |
| **Evolve** | Waiting · In progress · Done | what to do now and how ANA could change, at three horizons — **tidy** (fix what is off), **improve** (a better way of doing this work), **reimagine** (a new way of working) — with what was seen, what changes for people and what others do (links). *Do it* hands it to the agent |
| **Update** | Waiting · In progress · Done | features that are new in [agent-native-agent](https://github.com/tykimos/agent-native-agent) and not yet here. *Check for updates* compares this ANA with the latest upstream feature by feature; *Bring it in* has the agent port one with its skill |

**Sketch a screen** (on the PRD and Work tabs) opens a blank pad — pen, box, text, eraser — and sends the drawing to the chat as an image; the agent builds from it and keeps it in the PRD under *Sketches*.

Every Requests and Evolve card answers the same questions in plain words — **What's going on · What is asked · What it changes · If not**. The agent updates the PRD when an Evolve proposal or an update changes what the app does.

### Chat — like the Claude app

- **Rendered from the agent's own log**, not the screen: Claude Code's transcript (`~/.claude/projects/…`) or Codex's rollout (`~/.codex/sessions/…`). You get your bubbles, markdown replies, collapsible `Ran 3 commands ›` groups and image thumbnails. Agents without a log fall back to the screen mirror.
- **Session combo:** pick the tmux session (Claude Code or Codex). Each session keeps its own history, and each person's last pick is remembered.
- **Composer:** ＋ attach files · **model pill** (the real model, e.g. `Opus 5.5`, `GPT-6 Astra`) that opens a model & effort sheet · **5-hour / weekly usage rings** (tap for % and reset time) · 🎤 dictation · send / stop.
- Floating input with a ↓ jump button. It sits right on top of the phone keyboard.
- **Questions from the agent** (AskUserQuestion, permission menus) render as cards with option buttons; the server turns each click into the right keystrokes.

### Point at the screen

Turn on **Chip** (top right) and tap anything (a task, a card, a KPI) to attach it to the next message as a context chip. ⟳ registers newly added kinds of elements. ✎ lays a canvas over the board: circle what you mean in red, magenta or blue and press *Add to chat*. The annotated screenshot is attached, with chips for the items under your marks. Screenshots use [modern-screenshot](https://github.com/qq15725/modern-screenshot), served locally from `/vendor/`.

### Links between your work

Notes, tasks and events link to each other, indexed with [NodeRel](https://github.com/tykimos/NodeRel) (`graph-index.js` → `graph-index.sqlite`, rebuilt whenever the data changes) so the agent can follow them:

```
Note ─SPAWNED──────▶ Task | Event     where a task or event came from      (explicit)
Task ─SCHEDULED_AS─▶ Event            the time blocked to work on the task (explicit)
Note|Task|Event ─REFERS_TO─▶ Note|Task|Event   manual reference            (explicit)
Task ─DUE_ON─▶ Day,  Event ─ON─▶ Day           computed from due / date    (rule)
```

The kinds come from `work-ontology.js`. To make links in the UI:
- Select a line in a note and press **→ Task** or **→ Event**.
- Press the calendar button on a task to block time for it.
- **＋ Link** connects any two items.

Links show as chips on both ends; click one to jump to that item. A new kind of link (`BLOCKS`) is kept as it is.

| Endpoint | Purpose |
|---|---|
| `GET /api/state` → `graph.links` | the links (from NodeRel) |
| `POST /api/todo {title, due?, from?}` · `POST /api/event {action:'add', …, from?}` | create and link to its source in one call (`from` = note → `SPAWNED`, task → `SCHEDULED_AS`) |
| `POST /api/link {action:'add'\|'remove', from, to, type}` | add / remove a link |
| `GET /api/graph/neighbors?id=` · `GET /api/graph/trace?id=&depth=&direction=&types=` | incident links / everything reachable |
| `GET /api/graph/schema` | NodeRel's AI-readable schema plus the meanings. Hand it to the agent |
| `GET /api/stats` → `graph` | counts per kind and where the flow breaks (`gaps`) |

### Requests, Evolve and PRD — the API

*Ask the agent* has it fill the list. The agent registers items with `POST /api/requests {requests:[{kind, title, why, ask, effect, ifNot, options?, ref?}]}` (`ref` = a task/event/note id shown as a link) and data changes with `POST /api/agent {text, diff, why, effect}`. Your answer goes straight to the agent in chat. *Resolved* / *Not now* notify it (`POST /api/request-act {id, action: answer|done|dismiss|reopen}`). Evolve proposals come in through `POST /api/evolve` and are handled with `POST /api/evolve-act {id, action: do|done|fail|ignore|reopen}`. Documents are `GET /api/documents`, `POST /api/documents {name, type, data (base64), note?}` or `{action:'remove', id}`, and `GET /api/documents/<id>/file`. Knowledge is `GET /api/knowledge` and `POST /api/knowledge {classes?, relations?, entities?, facts?}` (same id = update) or `{action:'remove', kind, id}`. The PRD is `GET /api/prd` (current + history) and `POST /api/prd {md, note, source}` (a new version) or `{action:'restore', v}`. Updates: `GET /api/updates`, `POST /api/update/check`, `POST /api/update-act {id, action}`.

### Sharing it with other people (optional)

ANA has **no login of its own**. For single-user self-hosting that is the point — bind to loopback and it is yours. If several people need the same board, put ANA behind something that authenticates (a reverse proxy, an SSO gateway, a Zero Trust tunnel) and have it forward the user identifier as a request header:

```bash
ANA_IDENTITY_HEADER=x-forwarded-email \
ANA_LOGOUT_URL=/your-gateway/logout \
node server.js
```

With the header set, items carry an author and only the author can edit or delete their own. Unset (the default) everything runs as one local user.

**Coding-agent sessions per person.** The session combo at the top of the chat picks a tmux session. Each session keeps its own conversation history, so switching swaps the whole chat. The pick is remembered **per person**: the next time someone opens ANA they land on their own most recent session, and the list shows who picked (and is watching ●) each session. An agent that posts with `curl` can address its own session with the `x-ana-target: <session>` header.

> The header is trusted as-is, so it only means anything when a gateway in front actually sets it. Keep the server on loopback or behind that proxy — exposing it on `0.0.0.0` with this option on lets anyone forge the header.

---

## Attach ANA to your own service (very simple)

The **entire runtime is one dependency-free file: [`channel-core.js`](channel-core.js).** Drop it in and mount it:

```js
const path = require('node:path');
const core = require('./channel-core.js');
const app = core.createChannelServer({
  PORT: 8809, BIND: '127.0.0.1',
  SESSION: core.defaultSession(__dirname, process.env),   // TMUX_SESSION || <ANA name>-claude
  SOCKET: process.env.TMUX_SOCKET || '',
  TARGET: core.resolveTarget(__dirname, process.env),
  FEED_FILE: path.join(__dirname, '.ana', 'transcript.jsonl'),
  SERVABLE: new Set(['index.html']),   // your dashboard file(s)
  defaultDoc: 'index.html',
  autoConfigPane: true,
});
app.listen(() => console.log('ANA → http://localhost:8809'));
```

Then, on your page: send with `POST /api/chat {text, force:true}` and stream with `GET /api/stream` (SSE). That's the whole integration. Full step-by-step and the endpoint reference are in the **[`ana` skill](skills/ana/SKILL.md)**. With the plugin installed (see [Skills](#skills)), just ask Claude Code: *"attach ANA to my app"*.

---

## Skills

The repo is a **Claude Code plugin**. Install it once per machine and every ANA's agent can use the skills; update them the same way:

```bash
claude plugin marketplace add tykimos/agent-native-agent
claude plugin install ana@agent-native-agent          # later: claude plugin update ana@agent-native-agent
```

| Skill | Use it to |
|---|---|
| [`install`](skills/install/SKILL.md) | take a fresh machine to a running dashboard (env check, installer, tmux runner, Windows WSL) |
| [`ana`](skills/ana/SKILL.md) | attach the ANA runtime to your own service |
| [`ana-update`](skills/ana-update/SKILL.md) | bring an existing, customized ANA up to date, feature by feature |
| [`chat-window`](skills/chat-window/SKILL.md) | the Claude-app chat: session combo, log-based rendering, model sheet, usage rings, voice, attachments, Codex |
| [`context-chips`](skills/context-chips/SKILL.md) | Chip mode, ✎ draw-on-screen annotation, ⟳ register new elements |
| [`app-shell`](skills/app-shell/SKILL.md) | the six tabs (PRD · Work · Knowledge · Requests · Evolve · Update), sub-tabs, the bottom menu on phones |
| [`agent-requests`](skills/agent-requests/SKILL.md) | Requests, Evolve, PRD and Knowledge |

### Updating an existing ANA

This base is the starting point; each person's ANA grows its own domain code. To bring one up to date, don't copy the repo over it. Tell that ANA's agent:

> *"Update to the latest from https://github.com/tykimos/agent-native-agent"*

The **[`ana-update` skill](skills/ana-update/SKILL.md)** runs `ana-diff.mjs`, which reports:
- every feature as ✓ present, ◐ partial, or ✗ missing
- outdated modules
- whether the shared `channel-core.js` differs

You pick what to take. It ports each feature with its skill into that ANA's own files, then records the synced commit in `.ana-sync.json`, so the next update shows only what's new. [`features.json`](features.json) lists every feature with the anchors used for the comparison.

```bash
node skills/ana-update/scripts/ana-diff.mjs --target ~/ana/my-ana            # read-only report
node skills/ana-update/scripts/ana-diff.mjs --target ~/ana/my-ana --record   # after porting
```

---

## Repository layout

```
channel-core.js     ★ the whole ANA runtime — tmux inject / capture-pane mirror / per-session ledgers (0 deps)
server.js             base app: mounts channel-core + dashboard-api, serves dashboard.html
dashboard-api.js      base API: tasks · events · notes · links · knowledge · requests · approvals · evolve · PRD · updates
dashboard.html        reference UI: PRD · Work · Knowledge · Requests · Evolve · Update, Claude-app chat, Chip mode + drawing, relation chips
agent-log.js          chat from the agent's own JSONL log (Claude Code + Codex): replies, tools, model, limits
codex-settings.js     Codex model/effort catalog and switching through Codex's own menu
graph-index.js        the NodeRel index of the links (derived graph-index.sqlite)
work-ontology.js      the kinds of work items and links (classes, relations, compute rules); graph-index.js reads it
prd-template.md       the sections the agent writes the first PRD with
CLAUDE.md · AGENTS.md what the agent does here (start from the conversation, PRD and first screen in one turn, keep the PRD true)
features.json         feature manifest: anchors + skill per feature (used by ana-update)
package.json          dependencies: @tykimos/noderel (github:tykimos/NodeRel), modern-screenshot
test.cjs              unit + integration tests (npm test), mock_agent.py = deterministic TUI stand-in
skills/               install · ana · ana-update · chat-window · context-chips · app-shell · agent-requests · cloud-setting
.claude-plugin/       plugin + marketplace manifest
CHANGELOG.md          release notes per version (Korean: CHANGELOG.ko.md)
```

`channel-core.js` is the reusable core; `dashboard-api.js` / `dashboard.html` are the **example** you copy from and replace with your own.

---

## ANA and ANL

| Name | Reads as | Means | Role |
|---|---|---|---|
| **ANA** | Ana | Agent‑Native Agent | The autonomous agent that understands, acts, and improves the app. |
| **ANL** | Anel | Agent‑Native Lifestyle | The new way of working, learning, creating, and running daily routines with agents. |

**ANA enables ANL.** Real ANL cases — lifestyles built with ANA — live in the companion repo: **[agent‑native‑lifestyle](https://github.com/tykimos/agent-native-lifestyle)**.

---

## Star History

<a href="https://www.star-history.com/#tykimos/agent-native-agent&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=tykimos/agent-native-agent&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=tykimos/agent-native-agent&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=tykimos/agent-native-agent&type=Date" />
  </picture>
</a>

---

## Contributing

ANA is meant to be **owned and evolved** — that includes this repo. Issues, ideas, and PRs are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) for how to improve the runtime or the example dashboard.

If you build something with ANA, add it to the **[agent‑native‑lifestyle](https://github.com/tykimos/agent-native-lifestyle)** gallery so ANL stays visible as real usage.

If ANA changes how you think about apps, **⭐ star the repo** so others can find it.

---

## License

[AGPL-3.0](LICENSE) © [tykimos](https://github.com/tykimos) · AI Factory Inc.

Free to use, modify, and self-host. If you run a modified version as a network service, AGPL §13 requires you to publish your source. Building something closed-source or hosted? A **[commercial license](COMMERCIAL.md)** is available.

