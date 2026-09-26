---
name: ana-update
description: Bring an existing, customized ANA up to date with the latest upstream ANA (github.com/tykimos/agent-native-agent) feature by feature — compare first, report what is new/missing/outdated, then port only what the user picks, using the per-feature skills (chat-window, context-chips, relations, app-shell, agent-requests). Never overwrite the ANA's own domain code. Use when the user says "최신 내용으로 업데이트해", "ANA 업데이트", "update this ANA", "upstream이랑 뭐가 달라", "새 기능 가져와", "base-ana 개선사항 적용", or gives the ANA GitHub URL and asks to sync.
---

# ana-update — compare with upstream, then port feature by feature

A per-user ANA (e.g. `das-ana`) started from the base but has its own domain code, file names and UI. So an update is **never** "copy the repo over". It is: **diff by feature → the user picks → port each picked feature with its skill → verify → record**.

```
ana-diff.mjs ──► report (✓ present · ◐ partial · ✗ missing · module differs · runtime differs)
     │                      │
     │            user picks features
     ▼                      ▼
 .ana-sync.json ◄── verify ◄── port with the feature's skill (chat-window, context-chips, …)
 (--record)
```

The feature list lives in upstream **`features.json`**. Each feature has anchors (element ids, function names, API routes), the skill that ports it, modules to copy as-is, and npm deps.

## 0. Get the latest skills (once per machine, then just update)

The per-feature skills ship with the upstream repo as a Claude Code plugin. Install them so this ANA's agent can load them:

```bash
claude plugin marketplace add tykimos/agent-native-agent
claude plugin install ana@agent-native-agent
# later, to pick up newer skills:
claude plugin marketplace update agent-native-agent && claude plugin update ana@agent-native-agent
```

Without the plugin, read the same skills from the clone: `<upstream>/skills/<name>/SKILL.md`.

## 1. Diff (read-only)

Run from anywhere; the script needs only Node and git.

```bash
# upstream = GitHub (default), cloned to a temp dir
node <upstream>/skills/ana-update/scripts/ana-diff.mjs --target <path to the ANA>
# or against a local checkout / another URL
node ana-diff.mjs --target ~/ana/das-ana --upstream ~/ana/base-ana
node ana-diff.mjs --target . --upstream https://github.com/tykimos/agent-native-agent --json
```

If you don't have the script yet: `git clone --filter=blob:none https://github.com/tykimos/agent-native-agent /tmp/ana-up` and run it from there.

Read the last line: `ANA_DIFF present=… partial=… missing=… runtime=same|differs|not-found todo=<ids>`.

It scans the target's own `.js/.mjs/.cjs/.html` (not tests, `node_modules`, `.ana/`, `data/`). It also finds the `channel-core.js` the ANA actually uses, which may be a shared `../channel-core.js` on a host.

## 2. Report to the user before changing anything

Give a short table in the user's language, grouped by skill. For each row: what it does for them (from `summary` in `features.json`), and its state. Call out:

- **◐ partial:** the ANA has an older/custom version. List the missing anchors; porting means merging, not replacing.
- **module differs:** a copied module (`agent-log.js`, `graph.js`, `codex-settings.js`) exists but is older. Usually safe to replace whole, because these modules have no domain code. Check the target didn't edit it: `diff` it first.
- **runtime differs:** `channel-core.js` is shared by every ANA on a host. Updating it is a **separate decision**. Ask explicitly, name the other ANAs that share it, and replace the whole file, never a patch. Several chat features need the newer runtime (per-session ledgers, per-person recent session).
- **changes since last sync:** if `.ana-sync.json` exists, the script lists upstream commits since then. Summarize them.

Then ask which features to apply. A sensible default: everything from the `chat-window` skill first (most visible), then `context-chips`, then the rest.

## 3. Port each picked feature with its skill

Load the skill named in the report and follow its **Porting** section. Common rules for all of them:

1. **Find the target's extension points first.** These are:
   - the page file (usually `dashboard.html`)
   - the API module passed as `extraApi` to `channel-core`'s `createApp` (`dashboard-api.js` in the base, `das-api.js` in das-ana, …)
   - `server.js` options
2. **Copy standalone modules whole** (`copy` in `features.json`), then add the routes/UI that use them.
3. **Take code from upstream by anchor.** Run `grep -n '<anchor>' <upstream>/dashboard.html` to find each block: the HTML element, its CSS rules, and its JS functions. Bring the whole block, then rename ids only if they collide with the target's.
4. **Keep the target's domain code and look.** Use its CSS tokens (`--blue`, `--surface`, …). If a token is missing, add it to the target's `:root`.
5. **Never patch `channel-core.js` per ANA.** If a feature needs a newer runtime, stop and ask (step 2).
6. **Don't touch other ANAs' `.ana/`** or their ports/tmux sessions.

## 4. Verify

- the target's own tests (`node test.cjs` or `npm test`)
- re-run `ana-diff.mjs`: the ported features must show ✓
- open the page at phone width (390px) and desktop and exercise each feature (each skill has a checklist)
- restart only that ANA's server, the way it is normally run (launchd `kickstart -k`, tmux, `run.sh restart`). **Never `killall node`**: it kills every ANA and the Codex CLIs.

## 5. Record

```bash
node ana-diff.mjs --target <ANA> --upstream <same upstream> --record
```

This writes `<ANA>/.ana-sync.json` (upstream commit, date, features present). The next update lists only upstream commits since then.

## Git safety

- Commit only when the user asks, and push right away if the checkout is kept in sync with a remote. A launchd "sync" job that does `git reset --hard origin/main` will wipe unpushed commits. Check `launchctl list | grep sync` and `~/Library/LaunchAgents/*sync*` first.
- If something goes wrong, the reflog keeps the commit: `git reflog`, then `git branch backup/<name> <sha>`.

## Keeping this working (for upstream maintainers)

When you add or rename a user-facing feature in the base, update `features.json` (anchors, skill, copy, npm) and the skill's Porting section. `test.cjs` fails if an anchor no longer exists in the base.
