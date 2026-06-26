<div align="center">

# ⟁ ANA — Agent‑Native Agent

### Apps a **coding agent builds, runs, and evolves at runtime.**

You watch a live dashboard and talk. The agent ships.

[![Stars](https://img.shields.io/github/stars/tykimos/agent-native-agent?style=for-the-badge&logo=github&color=CC785C)](https://github.com/tykimos/agent-native-agent/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-1f6feb?style=for-the-badge)](LICENSE)
[![Built for Claude Code](https://img.shields.io/badge/built%20for-Claude%20Code-CC785C?style=for-the-badge)](https://claude.com/claude-code)
[![Protocol: MCP](https://img.shields.io/badge/protocol-MCP-111?style=for-the-badge)](https://modelcontextprotocol.io)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-22c55e?style=for-the-badge)](#contributing)

![ANA demo — watch a dashboard, converse, and the app grows](docs/assets/demo.gif)

**English** · [한국어](README.ko.md) · [Concept deck](docs/ana-concept.md)

</div>

---

## TL;DR

**ANA is a harness for building _Agent‑Native Agents_ — self‑hosted apps where a coding agent _is_ the runtime.**
No deploy cycle. Zero dependencies. Fully owned. You operate the app by **watching** a dashboard and **conversing**; when you need a new feature, you just ask — and the agent rewrites the app, live.

> **Read the name as _Coding‑Agent‑Native Agent_.** The center of gravity is the **builder** — the coding agent — not the service you see. The agent doesn't just answer; it **authors and keeps your app alive.**

---

## Why ANA

Every tool today forces a trade‑off between **using** and **building**:

|  | SaaS / Apps | No‑code | Chatbots | Coding agents | **ANA** |
|---|:---:|:---:|:---:|:---:|:---:|
| Use it instantly | ✅ | ✅ | ✅ | ❌ | ✅ |
| Change *anything* | ❌ | ⚠️ in‑box | ❌ | ✅ | ✅ |
| Sees your live data | ✅ | ✅ | ❌ | ⚠️ | ✅ |
| **Change at runtime — no deploy** | ❌ | ❌ | ❌ | ❌ | ✅ |
| You fully own it (self‑host) | ❌ | ❌ | ❌ | ✅ | ✅ |

SaaS is *instant but frozen*. Coding agents are *infinitely malleable but build‑time only* — you ship, then use. **ANA collapses build‑time into run‑time:** because the coding agent is native to the runtime, **using the app (talking) is the same act as building it (changing behavior).**

> Use = Build. That's the whole idea.

---

## The Three Principles

1. **Watch + Converse** — visual state and a chat live in *one* view. You operate by looking and talking, not clicking through fixed UI.
2. **Agent as Runtime** — the agent reads your data → acts → and **rewrites the app's own code** when asked. Inference is the runtime.
3. **Own Your Harness** — zero dependencies, self‑hosted, yours forever. It keeps evolving with you.

Full philosophy in [`docs/ana-concept.md`](docs/ana-concept.md).

---

## How it works

```
   You (phone / laptop)
        │  watch dashboard  ▲ rich proposals + approve
        ▼  natural language │
 ┌────────────────────────────────────────────┐
 │  Dashboard  ──►  Bridge server  ──►  Channel │   inbound = push
 │     ▲                                  │      │
 │     │  /api/agent (rich UI)            ▼      │
 │     └────────────  Coding Agent (runtime) ◄──┘   reads state → acts → rewrites app
 └────────────────────────────────────────────┘
   • Inbound (you → agent) travels a push channel (MCP / fakechat).
   • Outbound (agent → you) returns via the app API, so changes arrive as
     before/after previews you approve. State is versioned; every device syncs.
```

The coding agent is the backend. There is no separate server logic to write — you grow it by talking.

---

## Quickstart

```bash
git clone https://github.com/tykimos/agent-native-agent
cp -r agent-native-agent/skills/* ~/.claude/skills/
```

Then, in **Claude Code**, just describe the app:

```text
"Build a weekly family planner as an agent-native agent"
"Add voice input to this ANA"        # ← evolve: one sentence, no deploy
"Put an at-a-glance progress bar on top"
```

The `agent-native-app-harness` orchestrator skill triggers and builds your ANA: **define one screen → design → wire up → run the evolution loop.** Step‑by‑step in [`build-workflow.md`](skills/agent-native-app-harness/references/build-workflow.md).

---

## Building blocks

| Skill | Layer | Role |
|---|---|---|
| [`agent-native-app-harness`](skills/agent-native-app-harness/) | **Orchestrator** | Defines *what to assemble, in what order* to build an ANA, and runs the evolution loop. |
| [`uxui-design-system`](skills/uxui-design-system/) | Building block — *the face* | Zero‑dependency, Toss‑style design system: the dashboard's visual context. |
| [`fakechat-dashboard-agent`](skills/fakechat-dashboard-agent/) | Building block — *the nervous system* | Wires dashboard + channel + coding agent for watch + converse. |

---

## Example — a real ANA in 60 seconds

**"Work Secretary"** — six channels (mail · Slack · KakaoTalk · approvals · calendar · SMS) collapsed into one board, sorted by urgency.

- **Watch:** a live status board of everything that needs you.
- **Converse:** *"Approve this expense and send the reply mail."*
- **Flow:** chat → channel → the agent reads state → returns a **before/after preview + approve card** → tap → applied, every device synced.
- **Evolve:** *"Add a weekly throughput metric."* → it appears. No dev cycle — one sentence.

> The demo above is an ANA built with this harness.

---

## Roadmap

- [ ] One‑command scaffolder (`npx create-ana`)
- [ ] More building blocks (auth gate, audit log, multi‑user)
- [ ] Template gallery (planner, CRM‑lite, order desk, work queue)
- [ ] Hosted quickstart tunnel

---

## Contributing

ANA is meant to be **owned and evolved** — that includes this repo. Issues, ideas, and PRs are welcome.
If ANA changes how you think about apps, **⭐ star the repo** so others can find it.

---

## License

[MIT](LICENSE) © [tykimos](https://github.com/tykimos)
