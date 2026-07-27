# Contributing to ANA

Thanks for helping grow the **Agent‑Native Agent** harness. Contributions of any size — a fix, a new building block, or a real ANA example — are welcome.

## Ways to contribute

- **Report or fix a bug** — open an issue with steps to reproduce, or send a PR.
- **Improve docs** — clarify the quickstart, the build workflow, or the principles.
- **Add a building block** — a new skill the orchestrator can assemble (see below).
- **Share an ANA example** — a lifestyle built with ANA belongs in the [agent‑native‑lifestyle](https://github.com/tykimos/agent-native-lifestyle) gallery.

## Adding a building block

Building blocks are Claude Code skills the `agent-native-app-harness` orchestrator composes into an ANA.

1. Create a skill folder under `skills/<your-skill>/` with a `SKILL.md` (name, description, when it triggers).
2. Keep it **zero‑dependency and self‑hosted** — the third principle applies to blocks too.
3. Make it composable: a block should do one job (the *face*, the *nervous system*, an auth gate, an audit log, etc.) and hand off cleanly.
4. Document how the orchestrator should invoke it — inputs, outputs, and the order it slots into the build workflow.
5. Add it to the **Building blocks** table in `README.md` with its layer and role.

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
