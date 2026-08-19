---
name: ana
description: Attach ANA (Agent-Native Agent) to an existing web app or service so the user can operate it by watching a dashboard and chatting with a coding agent that runs inside tmux — chat is injected via tmux paste-buffer and the session is mirrored via capture-pane, with zero dependencies (no MCP, no bridge, no hooks, no plugin runtime). Use this whenever the user wants to "add ANA / a chat+watch dashboard to my app", "attach a coding-agent chat to an existing service", "make my dashboard talk to a tmux agent", "화면 보면서 대화로 조작", "기존 서비스에 ANA 붙이기", or to scaffold the standalone ANA base app. The single file `channel-core.js` is the whole runtime — drop it in and mount it.
---

# Attach ANA to your service

ANA turns any web app into one you **operate by watching + talking**: a coding agent runs inside a tmux pane; the browser sends chat that ANA injects into that pane, and mirrors the session (agent replies, tool activity, busy state) back to the page — no MCP, no bridge, no hooks. **The entire runtime is one dependency-free file: `channel-core.js`.**

## The whole idea (2 pieces)

```
[your web page] ──POST /api/chat──► server ──paste-buffer + Enter──► [tmux pane: claude / any agent]
      ▲                               │                                     │
      └── SSE /api/stream ◄───────────┘  300ms capture-pane → parse → ledger (auto-mirror)
```

1. **A server** that mounts `channel-core.js` and serves your HTML.
2. **A tmux session** running a coding-agent CLI (`claude`, or any).

## Attach in 3 steps (very simple)

**1. Copy `channel-core.js`** into your project (it is dependency-free, Node ≥ 20 + tmux).

**2. Mount it** — add ~12 lines to (or beside) your server:

```js
const path = require('node:path');
const core = require('./channel-core.js');
const app = core.createChannelServer({
  PORT: 8809, BIND: '127.0.0.1',
  SESSION: process.env.TMUX_SESSION || 'ana',
  SOCKET: process.env.TMUX_SOCKET || '',          // default tmux socket
  TARGET: core.resolveTarget(__dirname, process.env),
  FEED_FILE: path.join(__dirname, '.ana', 'transcript.jsonl'),
  SERVABLE: new Set(['index.html']),              // your dashboard file(s)
  defaultDoc: 'index.html',
  autoConfigPane: true,                            // sets alternate-screen off on connect
});
app.listen(() => console.log('ANA → http://localhost:8809'));
```

**3. Add the chat widget** to your page — send with `POST /api/chat {text}` and stream with `GET /api/stream` (SSE). Minimal client:

```html
<script>
  const es = new EventSource('/api/stream');
  es.onmessage = (e) => { const d = JSON.parse(e.data); /* d.kind: snapshot|commit|pending|status|screen|draft */ };
  function send(text) { fetch('/api/chat', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ text, force: true }) }); }
</script>
```

## Run

```bash
tmux new -s ana        # inside it, start your agent:  claude
node server.js         # → http://localhost:8809 , open in a browser
```

That's it — type in the page, the agent answers in the page.

## What channel-core gives you (the API)

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` `{text, force?}` | inject a message into the tmux agent (use `force:true` from the web — it clears the input line first, avoiding false "draft" blocks) |
| `POST /api/keys` `{key}` | send a control key (`enter`/`esc`/`up`/`down`/`1`..`9`/`ctrl-c` …) — used to answer TUI dialogs |
| `GET /api/stream` (SSE) | snapshot + incremental `commit`/`pending`/`status`/`screen`/`draft` events |
| `GET /api/feed?since=<seq>` | conversation ledger (cursor pagination) — survives restarts |
| `GET /api/health` | `{session, target, command, ready, dialog, busy}` — connection + terminal-dialog state |
| `GET /api/config` / `POST /api/config {target}` | list tmux sessions / switch the connected session live (no restart) |
| `GET /api/screen` | raw pane snapshot (for a terminal view / dialog card) |

## Rich responses (optional)

Plain replies mirror automatically. For **preview + approve** cards, the agent posts `POST /api/agent {text, diff}`; your server applies the diff on approval and bumps a `version` so every device re-syncs. See `dashboard-api.js` in the ANA base for the todo/schedule/memo/evolve reference implementation.

## Safety notes (already built in)

- Server binds `127.0.0.1` by default — a coding agent has tool-execution power, so never expose it unauthenticated (`BIND=0.0.0.0` is opt-in for trusted networks only).
- `/api/chat`/`/api/keys` require `content-type: application/json` + same-origin (CSRF guard). Only `SERVABLE` files are served.
- Injection is refused when the pane is a shell (agent exited) or a TUI dialog is open — surface `health.dialog` in your UI so the user can respond with `/api/keys`.

> Full reference app (dashboard with ANA mode, context chips, docked chat, evolution tab): the repository root. Run it, then copy the parts you want.
