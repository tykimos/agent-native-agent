---
name: trust-checks
description: Port ANA's System › Trustworthiness · Safety · Security tabs — checks computed on the server from real state (agent running, structured log, tool failure rate, interruptions, plan usage; permission-bypass flags, risky commands the agent actually ran, approval gate; bind address, sign-in, CSRF, token handling, credential file mode, secrets saved in the user's data) shown as ok / info / warn / risk cards with a risk badge. Use when the user says "AI 신뢰성", "안전", "보안", "trust", "위험한 명령", "보안 점검", "reliability tab", or when ana-update reports system-trust missing.
---

# trust-checks — can I rely on this agent, and is it safe?

An ANA agent often runs with permission prompts off and can reach the user's machine and data. These three tabs answer "is it working, what could it break, who can reach it" from **real state**, not static text. Every check must be computed. If you can't compute a check, report `info` ("unknown"); never report `ok` by default.

## Checks (base ANA)

| Tab | Check | Source | Status rule |
|---|---|---|---|
| Trustworthiness | Agent is running | `ctx.hasSession()` + `ctx.agentAlive()` | risk if down |
| | Chat comes from the agent's own log | `agentLog.read(target)` available | warn if screen-mirror only |
| | Tool calls that failed | `isError` over recent tool calls in the log | warn ≥ 10%, risk ≥ 30% |
| | Interrupted turns | `Interrupted` events in the log | info, warn ≥ 5 |
| | Plan usage 5-hour / weekly | `/api/limits` data (Claude) or rollout `rate_limits` (Codex) | warn ≥ 80%, risk ≥ 95% |
| | Waiting on you | pending diff proposals + open requests | info when > 0 |
| Safety | Permission mode | the **live** mode from `permission-mode.js` (Claude status line, Codex turn_context); falls back to start flags `--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`, `--yolo` | warn on Bypass / Full Access |
| | Risky commands the agent ran | full Bash/exec command text (`tool.cmd`) matched against `RISKY_CMDS` (rm -rf, reset --hard, force push, git clean -f, killall/kill -9, sudo, chmod 777, curl \| sh, DROP TABLE, dd/mkfs/diskutil erase) | warn if any; list the last 8 |
| | Data changes go through approval | diff → approve flow present; count waiting | ok |
| Security | Network exposure | server `BIND` (+`PORT`) | ok on loopback, risk otherwise |
| | Sign-in | `IDENTITY_HEADER` configured | ok / info on loopback / risk when exposed |
| | Cross-site requests blocked | `csrfOk` on every write | ok |
| | AI login stays on the server | token never in responses | ok |
| | Credential file mode | `~/.claude/.credentials.json` mode & 0o077 | warn if group/other can read |
| | Remote control | `--remote-control` in the start command | info |
| | Secrets in your data | `SECRET_PATTERNS` over notes/tasks/events (API keys, tokens, private keys, `password:`) | warn; list **where** (kind + title), never the value |

Add checks that matter for the target's domain. For example, das-ana could flag "disk nearly full" and "SMART warnings" under Trustworthiness, or "volume shared to the network" under Security. Keep the same shape: `{id, status, label, value?, detail?, items?}`.

## Pieces (upstream)

- **Server:** `collectTrust(ctx)`, `RISKY_CMDS`, `SECRET_PATTERNS` in `dashboard-api.js`, route `GET /api/trust` → `{reliability|safety|security: {checks, risk, warn}}`. `server.js` passes `BIND, PORT` in the API options. `agent-log.js` keeps the full command (`tool.cmd`, 600 chars) for Bash (Claude) and exec (Codex), and the pane start command on `resolve()`.
- **UI:** `#reliabilityView #safetyView #securityView` (`.trust-view`), `[data-trust=…]` lists and `[data-trust-sum=…]` pills, `refreshTrust()` (on tab open and every 60s while visible). Cards are sorted risk → warn → info → ok. The System badge shows the total `risk` count (`trustRisk` → `updateSysBadge`).

## Porting

1. Copy `collectTrust` + the two pattern lists + the route. Wire `BIND, PORT` from `server.js`. Update `agent-log.js` if the target's copy has no `cmd`/`start` fields (ana-diff marks it "differs").
2. Adapt the secret scan to the target's data (which arrays and fields hold user text). Adapt or extend the checks for its domain.
3. Copy the three views, the CSS block "점검 카드", `refreshTrust`, and add the views to `selectTab`'s list under the System group (see app-shell).

## Verify

- Stop the agent → Trustworthiness shows "Agent is not running" as risk, and the System badge shows 1.
- In a throwaway tmux session (never the live one), run `echo rm -rf /tmp/x-test` through the agent → Safety lists it.
- Put `sk-ant-test0123456789abcdef` in a note → Security warns and names the note, but not the key. Remove it.
- `BIND=0.0.0.0` on a test port → Security shows risk. Never leave a real server bound like that.
