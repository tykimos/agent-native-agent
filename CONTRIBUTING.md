# Contributing to ANA

Thanks for helping grow **ANA — the Agent‑Native Agent** runtime. Contributions of any size — a bug fix, a runtime improvement, a cleaner example, or a real ANA lifestyle — are welcome.

## Ways to contribute

- **Report or fix a bug** — open an issue with steps to reproduce, or send a PR.
- **Improve docs** — clarify the quickstart, the attach recipe, or the principles.
- **Improve the runtime** — `channel-core.js` is the whole engine (tmux inject/mirror/ledger). Bug fixes and robustness improvements are the highest‑value contributions; every change must keep `node test.cjs` green.
- **Improve the example** — the reference dashboard (`dashboard.html` + `dashboard-api.js`) shows one way to build on the core. Cleaner examples and new interaction patterns are welcome.
- **Share an ANA example** — a lifestyle built with ANA belongs in the [agent‑native‑lifestyle](https://github.com/tykimos/agent-native-lifestyle) gallery.

## Working on the runtime

`channel-core.js` is intentionally **dependency‑free** (Node ≥ 20 + tmux only) — keep it that way; the third principle applies to the engine too.

1. Make the change small and focused; one concern per PR.
2. Add or update a test in `test.cjs` that would fail without your change. The suite runs both unit checks and integration against `mock_agent.py` (a deterministic TUI stand‑in) — no real agent needed.
3. Run `node test.cjs` and keep it fully green.
4. If you change a public endpoint or option, update `skills/ana/SKILL.md` and both READMEs so the attach recipe stays accurate.

## Adding an example

- Build the app with ANA, then contribute it to the companion [agent‑native‑lifestyle](https://github.com/tykimos/agent-native-lifestyle) repo.
- Include a short GIF (watch + converse in action) and the one‑screen definition so others can reproduce it.

## PR flow

1. Fork the repo and create a branch: `git checkout -b feat/<short-name>`.
2. Keep changes focused; one concern per PR.
3. Verify the quickstart still works and any new skill triggers as documented.
4. Open the PR with a clear description of *what* changed and *why*. Link related issues.
5. A maintainer reviews — we aim to respond within a couple of days.

By contributing, you agree your work is licensed under the repo's [AGPL-3.0 License](LICENSE), and you grant AI Factory Inc. the right to also offer your contribution under a commercial license (see [COMMERCIAL.md](COMMERCIAL.md)).
