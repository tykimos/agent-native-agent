---
name: chat-window
description: Port or rebuild the ANA chat window so it looks and behaves like the Claude app — full-width session combo, user bubbles + markdown replies + collapsible tool groups rendered from the agent's own JSONL log (Claude Code and Codex), floating composer with model pill, model/effort sheet, 5-hour/weekly usage rings, voice dictation, file attachments, reliable send state, iOS keyboard fit, one ledger per session. Use when the user says "채팅창 개선", "채팅창 스킬", "클로드 앱처럼", "모델 선택", "한도 표시", "음성 입력", "코덱스 지원", "세션별로 따로", "port the chat window", or when ana-update reports chat-* features missing.
---

# chat-window — the Claude-app chat for any ANA

UI/UX is the point of this skill. Match the spec below exactly; it came from side-by-side comparison with the Claude iOS app. The reference implementation is the upstream base (`dashboard.html`, `dashboard-api.js`, `agent-log.js`, `codex-settings.js`). Take code from there by the anchors in `features.json` (`chat-*` features).

## UX spec (what it must look like)

```
┌──────────────────────────────────────────┐
│ ‹  ● base-ana-claude                  ▾  │  header: back (mobile) + full-width combo, left-aligned, no ⋯ button
├──────────────────────────────────────────┤
│                        ┌──────────────┐  │
│                        │ user bubble  │  │  gray bubble, right; images as 110px thumbnails above it
│                        └──────────────┘  │
│ Assistant reply as plain markdown —      │  no bubble; headings, lists, code, tables, links
│ **bold**, `code`, lists, tables.         │
│ Ran 3 commands, read 1 file ›            │  collapsible tool group; "Running `cmd`" + spinner while running
│                                          │
│ ✳ 12s · Working…              ⟳ Syncing… │  status line (spinner + elapsed + agent's status)
│               ( ↓ )                      │  jump-to-bottom, dot when new messages arrive below
│ ╭──────────────────────────────────────╮ │
│ │ Message ANA — Enter to send          │ │  floating, blurred, translucent card
│ │ (+) (Opus 5.5) (5h)(7d)      (🎤) (↑) │ │  send = theme accent; stop = light circle + 18px ■
│ ╰──────────────────────────────────────╯ │
└──────────────────────────────────────────┘
```

- **Session combo:** dot (green alive / red not connected) + session name, ▾ at the right edge. The popup is exactly the combo's width, with 10px screen margins. Rows show the name, the agent (Claude Code / Codex, from the process or session name; strip `.exe`), msg count, and **You** only on the session *this screen* views. Elsewhere show "Open in another tab" / "Your last pick".
- **Model pill:** shows the real model from the log (`Opus 5.5`, `GPT-6 Astra`). Tap opens the **model sheet**. Without a log it opens the session list.
- **Model sheet:** bottom sheet with a grab bar, ✕, and title "Model". There's one rounded group of models (name + one-line description, ✓ on the current one), then an **Effort ›** row that expands the levels, then a note: "Also becomes the default for new Claude Code sessions."
- **Usage rings:** 36px rings that fill as the plan is used. Accent color; orange ≥ 80%, red ≥ 95%. Tap opens a popover with a bar, "% used", and "Resets in 39 min (09:59)". Show only the windows the plan has (Codex Pro currently has weekly only).
- **Mic:** shows only if `SpeechRecognition` exists; pulses red while listening; dictation goes into the input. It needs **https**, and on iPhone Siri & Dictation must be on.
- **Keyboard (iOS):** the composer sits 2px above the keyboard. Safari's own ^ ∨ ✓ accessory bar can't be removed from a web page; say so if asked.
- **Empty state:** "No agent connected — tap the session name above to choose one".

## Architecture

| Piece | Where | Notes |
|---|---|---|
| Structured log | `agent-log.js` (copy whole) | Finds the log for a tmux target from the pane's cwd. **Claude Code:** `~/.claude/projects/<cwd with non-alnum→'-'>/*.jsonl` (newest). **Codex:** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` whose first-line `session_meta.cwd` matches. Incremental reads by byte offset; items get a `rev`; clients poll `since=rev` and replace by `id`. |
| Log API | `GET /api/agentlog?target=&since=` → `{available, kind, model, modelName, effort, limits, rev, items}`; `GET /api/agentlog/img?target=&ref=` | Images are re-read from the JSONL line by reference, never cached in memory. |
| Model/effort | `POST /api/agent-setting {model?, effort?, target}`; `GET /api/agent-models` (Codex catalog) | **Claude:** whitelist `opus/fable/sonnet/haiku` and `low…max`. Inject `/model x` / `/effort y` with `ctx.injectText(cmd, true, true)` (no sender prefix, or the slash command breaks). Then read the screen: "Set model to …" = ok, "Kept model as …" = refused (long conversations can refuse Fable). **Codex:** `codex-settings.js` (copy whole). The catalog comes from `~/.codex/models_cache.json`; it types `/model` and walks Codex's own menus, then waits for "Model changed to …". |
| Limits | `GET /api/limits?target=` | **Claude:** server reads the OAuth token (macOS keychain `Claude Code-credentials`, else `~/.claude/.credentials.json`) and calls `https://api.anthropic.com/api/oauth/usage` with `anthropic-beta: oauth-2025-04-20` → `five_hour` / `seven_day.utilization`. Cache 60s. **Never send the token to the browser.** **Codex:** `token_count.rate_limits` from the rollout (`window_minutes ≤ 360` = 5h, else weekly). |
| Uploads | `POST /api/upload` → `.ana/uploads/…`; the message carries "N attached file(s) — read and check these paths:" + paths | The log view turns those paths back into thumbnails (`/uploads/<name>`). |
| Per-session ledgers | `channel-core.js` ≥ upstream `d690eda` (`TARGETS_FILE`, `transcripts/`) | Each tmux session keeps its own history; each person's last-picked session is remembered. Needs the newer shared runtime; see ana-update step 2. |
| Screen mirror | `/api/stream` (SSE) from channel-core | Still used for busy/status, dialogs, and agents without a structured log. In log mode, render only `proposal` messages from the ledger. |

## Porting into an existing ANA

1. `ana-diff.mjs` → note which `chat-*` features are ✗/◐ and whether the runtime differs.
2. Copy `agent-log.js` and `codex-settings.js`. In the ANA's extraApi module add `const { createAgentLog } = require('./agent-log.js'); const agentLog = createAgentLog({ socket: opts.TMUX_SOCKET || '' });` and pass `TMUX_SOCKET` from `server.js`. Then copy the route blocks for `/api/agentlog`, `/api/agentlog/img`, `/api/agent-models`, `/api/agent-setting`, `/api/limits` (plus `readOauth`/`collectLimits`).
3. In the page, bring over by anchor:
   - **HTML:** `#chatDock` (composer, `#jumpBtn`, `.cbar` with `#agentPill #ring5h #ringWeek #micBtn #send`), `#connPill`/`#tmuxCfg`, `#msheet`/`#msheetScrim`, `#limitPop`.
   - **CSS:** rules for `.chat-dock`, `.composer`, `.cbar`, `.limit-ring`, `.msheet`, `.md`, `.actgrp`, `.umsg`, `.limg`, `kb-open`, and the mobile `#chatSide` rule using `--vvh/--vvt`.
   - **JS:** the log-mode block (`logMode…`, `pollLog`, `logItemHtml`, `toolSummary`, `splitUserText`, `mdHtml`), limits (`pollLimits`, `renderLimits`, `openLimitPop`), mic IIFE, model sheet (`openModelSheet`, `applyAgentSetting`), the visualViewport IIFE, and delivery (`addOptimistic`, `reconcile`, `echoOf`).
4. Wire: `pollHealth()` kicks `pollLogSoon()`; `switchStream()` calls `logReset()`; the ledger render goes through `ledgerHtml()`.

## Pitfalls (each one bit us)

- **Declare state at the top of the script.** `logMode, logRev, logModel, logKind, limits, …` sit next to `contextChips`. Bootstrap calls `pollHealth` → `pollLog` before later `let`s run, which throws a TDZ error, and the page silently stops.
- **Don't call `.click()` on a button from inside its own click handler** (re-entrancy is ignored). Use a plain function (`selectTab`).
- **Selector collisions:** the theme uses `data-mode` on `<html>`, so don't use `[data-mode]` for your own buttons.
- **Testing `/model` changes defaults:** Claude Code saves `/model` and `/effort` as the default for new sessions in `~/.claude/settings.json`. Never test on the live session you're running in. Use a throwaway `tmux -L test new-session …`, back up `settings.json` first, and restore it after.
- **Test servers must not touch real sessions:** run them with `TMUX_SOCKET=<nonexistent>`. The runtime sets pane options on any session it attaches to.
- **Restarting:** restart only this ANA's server, the way it normally runs. Never `killall node`.
- **Codex mid-turn:** Codex won't change model mid-turn or with text in its input. Surface the server's error; don't retry.

## Verify

- Unit: `node test.cjs` (includes agent-log `toolLabel/cleanUser/modelName/codexModelName/codexLimits`) and `node --test codex-settings.test.cjs`.
- 390×844 and desktop, light and dark:
  - a Claude session renders bubbles / markdown / tool groups / thumbnails
  - a Codex session renders its replies, and the pill says `GPT-…`
  - the rings show the right %, the popover shows reset times
  - the model sheet ✓ matches, and the Effort row expands
  - the combo popup doesn't overflow
  - ↓ appears when scrolled up
- Security: `/api/agent-setting` rejects `{"model":"sonnet; rm -rf ~"}` with 400; no token in any response.
