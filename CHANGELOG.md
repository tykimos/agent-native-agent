# Changelog

All notable changes to ANA. Versions follow the Claude Code plugin version in `.claude-plugin/plugin.json`.
**English** · [한국어](CHANGELOG.ko.md)

To bring an existing ANA up to date with these changes, use the [`ana-update`](skills/ana-update/SKILL.md) skill. It compares that ANA with this repo feature by feature and ports only what you pick.

## [0.4.1] — Unreleased

One naming rule for every ANA: the folder gives the name, and the name gives the tmux sessions.

### Changed

- **Folder → ANA name.** Every ANA lives in `~/ana/<xxx>-ana` (or `/ana/<xxx>-ana`), and the folder name is the ANA's name. `<xxx>` may contain hyphens. This repo's sample is `base-ana`: install into `~/ana/base-ana`. A folder that doesn't end in `-ana` falls back to `base-ana`; `ANA_NAME` overrides.
- **Default tmux session is `<name>-claude`** (was `ana`), e.g. `base-ana-claude`. `TMUX_SESSION` still overrides it, so existing deployments keep their session.
- **Chat session list shows only this ANA's sessions:** `<xxx>-ana-<yyy>`, where `yyy` is the agent label (`claude`, `codex`, or any hyphenated label). The connected and default sessions always stay listed. `ANA_TMUX_ALL=1` lists every tmux session. `/api/config` and `/api/health` now report `ana`.
- **Install scripts.** `install.sh` and `install-wsl.ps1` clone into `~/ana/base-ana`. `run.sh` and `check-env.sh` derive the session from the folder, and `run.sh` names its server session `srv-<session>` so it stays out of the chat list. A server still running as `<session>-server` is reused.
- `channel-core.js` exports `anaNameOf`, `defaultSession` and `isAnaSession`.
- README, the `install` skill and the `ana` skill use the new paths and session names, with a short "Naming convention" section.

## [0.4.0] — 2026-10-02

The base becomes a solo operations board you run with a coding agent. It has three areas, a chat that matches the Claude app, and skills that bring all of this into ANAs that already exist.

### Added

- **Three areas.** Mobile has a bottom menu; desktop has a switch next to the logo.
  - **Workspace:** Tasks · Calendar · Notes, plus the workspace combo.
  - **Collaborate:** Evolve · Approvals · Requests. The badge counts what is waiting on you.
  - **System:** Stats · Relations · Reliability · Safety · Security. The badge counts checks at risk.
- **Relations on NodeRel.** Notes, tasks and events are linked with `SPAWNED`, `SCHEDULED_AS`, `REFERS_TO`, plus derived `DUE_ON` / `ON` day links.
  - Relation chips on every item; a click jumps to the linked item.
  - **System › Relations** draws the flow graph and lists where it breaks.
  - New APIs: `/api/graph`, `/api/graph/neighbors`, `/api/graph/trace`, `/api/graph/schema`, `/api/link`.
  - `state.json` stays the source of truth. `graph.sqlite` is a rebuilt index.
- **Collaborate.**
  - **Evolve:** proposals based on the app's features, its data, and the usage log.
  - **Approvals:** pending data-change diffs, plus requests of kind `approval`, `decision` or `access`.
  - **Requests:** `action` and `info` requests.
  - Each tab has an "ask the agent" button. The new request kind is `approval`.
- **Reliability · Safety · Security checks** (`GET /api/trust`), computed from real state:
  - **Reliability:** agent up, structured log in use, tool failure rate, interruptions, plan usage.
  - **Safety:** permission-bypass flags, and risky commands the agent actually ran.
  - **Security:** bind address, sign-in, CSRF, token handling, credential file mode, and secrets pasted into notes. Secrets are reported by location only, never by value.
- **Claude-app chat.**
  - **Rendering:** the chat comes from the agent's own log: Claude Code transcripts or Codex rollouts (`agent-log.js`). That gives user bubbles, markdown replies, collapsible `Ran 3 commands ›` groups and image thumbnails.
  - **Session combo:** full width; each session keeps its own history.
  - **Model pill and sheet:** the pill shows the real model; tapping it opens a model & effort sheet. Claude switches with `/model` and `/effort`, checked against the screen. Codex switches through its own menu (`codex-settings.js`).
  - **Usage rings:** 5-hour and weekly. Claude reads `api/oauth/usage` with the local login, server-side only. Codex reads `rate_limits`.
  - **Composer:** voice dictation, file attachments, and a floating composer with a ↓ jump button that sits on the iOS keyboard.
- **Context chips.** In Chip mode, tap any item to attach it to the next message. ✎ lets you draw on the screen (red / magenta / blue) and attach the annotated screenshot. ⟳ registers new kinds of elements.
- **Skills and updates for existing ANAs.**
  - New skills: `ana-update`, `chat-window`, `context-chips`, `relations`, `app-shell`, `agent-requests`, `trust-checks`.
  - `features.json` lists each feature's anchors. `ana-diff.mjs` uses them to report present / partial / missing, outdated modules, and runtime differences, then records the synced commit in `.ana-sync.json`.
  - Plugin marketplace: `claude plugin install ana@agent-native-agent`.
- `seed.js`: two example flows on first run (`ANA_SEED=0` to start empty).

### Changed

- Removed Meetings and Members. The base is single-person; sign-in is still possible through a gateway header.
- Requires **Node ≥ 24** (`node:sqlite`).
- README rewritten around the three areas and the skills, with new screenshots (WebP, about 130 KB in total).

### Fixed

- **Phantom question cards.** A reply that mentioned "Select model" or "Esc to cancel" could be read as a Claude Code question window. That blocked chat input. Now a visible input box means no dialog, and dialog cues only count at the start of a line in the bottom 20 lines.
- **iOS overscroll.** Pulling past the end of the chat no longer drags the whole chat down. It follows the visible viewport only while the keyboard is open, and the page behind is locked.
- `npm install` works without GitHub SSH keys (NodeRel resolved over HTTPS).
- **Delivery state.** Delivered messages no longer show "Unconfirmed / Resend" when the agent echoed them as `[Pasted text]`.
- **Small UI fixes.**
  - "You" appeared twice in the session list.
  - The "New version available" pill did nothing when tapped.
  - The session popup overflowed the screen edge.
  - Badge counts were wrong at load time.

## [0.3.0] and earlier

See the [commit history](https://github.com/tykimos/agent-native-agent/commits/main) up to `d690eda`: workspaces, Chip mode, the install skill, per-session ledgers, and structured AskUserQuestion cards.

[0.4.1]: https://github.com/tykimos/agent-native-agent/compare/v0.4.0...main
[0.4.0]: https://github.com/tykimos/agent-native-agent/compare/d690eda...v0.4.0
[0.3.0]: https://github.com/tykimos/agent-native-agent/commits/d690eda
