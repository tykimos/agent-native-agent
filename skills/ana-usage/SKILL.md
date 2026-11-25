---
name: ana-usage
description: Operate a running ANA (Agent-Native Agent) from the outside — as the person's own Claude Code driving the ANA dashboard in a browser (Playwright or similar), or guiding them through it. Covers the Codespace quick start, the screen map (PRD · Work · Knowledge · Requests · Evolve · Update · System), how to phrase requests to the ANA agent, approval cards, what every Requests / Evolve / Update button really does, getting files in and out, waiting for the agent to finish, and recovering when a Codespace goes idle. Use this skill when the user asks to "use ANA for me", "set up the ANA codespace", "press Evolve and hand it off", "attach this file to ANA", mentions a "*-8809.app.github.dev" or "localhost:8809" dashboard, or wants a walkthrough of what a button on the ANA dashboard does. This is the user-side counterpart of the porting skills (chat-window, app-shell, agent-requests…): those build the dashboard, this one uses it.
---

# ana-usage — use an ANA from the outside

Everything here was checked on ANA 0.27.11 (commit `7c92b53`), by reading the source and by driving a real ANA in a browser. Where a behaviour was read in code but not exercised, it says so. If the dashboard you see differs, trust the screen and the source, then fix this file.

Two agents are involved — keep them apart:

- **the ANA agent**: the coding agent in tmux behind the dashboard. It edits the app. It cannot see the page.
- **you**: the agent (or person) in front of the dashboard. You look at the page, press buttons, and tell the ANA agent what to do.

## 1. Quick start on Codespaces

1. Open `https://codespaces.new/tykimos/agent-native-agent?ref=main` and create the codespace. **The person signs in to GitHub themselves** (password, 2FA).
2. When the editor opens, accept "Trust folder & continue". Setup takes 2–3 minutes.
3. The ANA tab opens by itself. If it does not, open the **Ports** panel → 8809 → Open in Browser. The address is `https://<codespace>-8809.app.github.dev/`. Keep the port Private.
4. In the chat, the *Set up Claude Code* card: theme → **Claude account with subscription** → Open Claude login → paste the code → Complete login → **Yes, I trust this folder**. The person signs in to Claude themselves.
5. Send a greeting and wait for the reply.

A local ANA is at `http://localhost:8809`. Details: `docs/codespaces.md`, `skills/install/SKILL.md`.

## 2. Screen map

- The **ANA logo** (the `Menu` button) opens the tab list: PRD · Work · Knowledge · Requests · Evolve · Update · System. Sub-tabs sit in the top bar.
- **PRD** — Current / History. Buttons: Edit, Sketch, Ask the agent. With no PRD yet, start with **Talk to ANA**. *Restore this version* saves the old text as a new version; nothing is lost.
- **Work** — the screens the ANA agent built. Empty at first: **Build the first screen from the PRD**.
- **Knowledge** — Ontology (kinds and relations) / Graph / Documents (files the agent reads, 25 MB each).
- **Requests / Evolve / Update** — each has Waiting · In progress · Done.
- **System** — version, Restart the server, Restart the agent.
- **Chat** — the right-hand panel; the round button at the bottom right opens it. It has the session picker, model and effort, permission mode (Manual / Accept edits / Plan / Auto / Bypass), file attachments (10 MB each), dictation, the 5-hour and weekly usage rings, and a send button that becomes ■ (stop, sends Ctrl-C) while the agent works.
- **Chip** switch (top right) — when on, tapping an item on the page attaches it to the next message as `Context:\n- [Kind] text`. New Work elements are not chip targets until ⟳ registers them or the agent adds them to `CAP`.

## 3. The normal loop

1. PRD → **Talk to ANA**. Answer in one message: who it is for, what they handle, what they want to see. Adding "decide the rest with sensible defaults and write the PRD" saves a round of questions.
2. The ANA agent saves the PRD, declares the kinds in `work-ontology.js`, adds routes, builds the Work screen, runs the tests and restarts the server. A first screen took about 6 minutes; a batch of Evolve proposals took over 20.
3. When the **"New version available — tap to reload"** pill appears, press it (or reload). It appears because `dashboard.html` changed; the page never reloads by itself.
4. Use the new screen for real, then say what to change. If what the app does changed, ask for the PRD to be updated too.
5. When the agent wants to change the person's data, an **approval card** (Approve / Reject) appears in the chat and under Requests › Data changes. Read the *Change* lines before approving. Several cards can arrive one after another.

## 4. What to know before asking

- One message is at most **8000 bytes** (`MAX_TEXT`). Split longer briefs.
- Messages sent while the agent is working are handled in order afterwards. To change direction, just send a correction; the earlier PRD stays in History.
- There is no chart library — ask for charts "drawn directly in SVG".
- Work items live in `.ana/work-graph.json`, one flat array per kind. Field values are booleans, finite numbers, strings (cut at 20,000 characters) or arrays of those (cut at 100). **An object value is stored as an empty string.**
- Not in the base: sending mail, push notifications, a scheduler, a headless browser, any market or news data source. Whatever the agent fetches from the web can differ between sources — ask it to show how many sources agree, and do not take the numbers as verified.
- A "run every morning" the agent sets up lives inside its own session. It stops when the session ends or the codespace sleeps.
- The approval step is a rule the ANA agent follows (`CLAUDE.md`), not something the server enforces: `POST /api/apply` applies a diff with no card.
- When several requests touch the same file, say "one after another, not at the same time".
- **The ANA agent cannot see the page.** After every change, open the screen yourself and report what is off in concrete terms ("the labels are about 28 px and the top one is cut off at the right edge").

## 5. Requests · Evolve · Update — what the buttons do

All three sort their cards the same way: `new/open` → Waiting, `doing/answered` → In progress, and `done`, `failed`, `dismissed` → Done.

### Requests

- **Ask the agent** — the agent registers what it needs from the person: approval, decision, access, action, info.
- Card buttons: Send (answer), Resolved / I did it, Discuss, Not now.
- Do not answer on the person's behalf when only they can know (their name, preferences, how they want things run).

### Evolve

| Button | Where | What happens |
|---|---|---|
| Ask the agent | top of the tab | sends an instruction; 2–7 minutes later tidy / improve / reimagine cards appear in Waiting |
| Discuss | Waiting, In progress, failed cards | attaches the proposal as a chip and opens the chat — nothing is built |
| Do it | Waiting | status → `doing`, and an `[Evolve] Implement/apply proposal #N …` instruction goes to the agent |
| Mark done / Failed | In progress | status → `done` / `failed` |
| Cancel | In progress | **the same action as Ignore**: status → `dismissed`, shown as "Ignored" |
| Ignore | Waiting | status → `dismissed` |
| Reopen (done) · Restore (ignored) · Try again (failed) | Done | all three send `reopen`: back to Waiting |

- **Do it, Ignore, Cancel, Mark done and Failed have no confirmation.** Check the `#number` and the title before pressing.
- **Cancel does not reach the agent.** The server notifies the agent only on Do it, and the build instruction is already in its terminal — so the work goes ahead and the card later turns to Done. To really stop it, say so in the chat ("do not do #15").
- For a large proposal, press **Discuss** first and state your conditions, ending with "build only after I press Do it". The agent points out what is wrong with the conditions before anything is built.
- Proposals are as good as their evidence. Upload a note that lists known problems to Knowledge › Documents, press Knowledge › Ask the agent, then Evolve › Ask the agent — the proposals will aim at those problems one by one.
- Ask for a before/after measurement with the same method (for a game: the same bot and fixed random seeds) so the result is a table, not an impression.
- Proposals that need outside setup (GitHub Actions, a mail account) or the person's information are theirs to decide — leave them in Waiting.

### Update

- **Check for updates** fetches the upstream repo into `.ana/upstream/` and compares `features.json`. The line under the button shows the commit and e.g. "20/20 features here".
- With nothing new there are no cards, so Bring it in / Skip are not shown.
- Card buttons (read in code, not exercised): Waiting — Bring it in / Skip; In progress — Mark done / Failed / Cancel; failed — Try again; skipped — Restore; done — none. Unlike Evolve, Update's *Try again* is the same action as Bring it in.
- Bring it in changes app code and can collide with a custom Work screen. Ask the person first.

## 6. Files in and out

- **In, through the chat:** the attach button (`#attachBtn`) → pick the file → send it with a message. A single self-contained HTML file (a game, a report) can become "a Work sub-tab + its own route + an iframe" this way. The iframe is same-origin, so `iframe.contentWindow` is reachable for checking.
- **In, as reference material:** Knowledge › Documents → Add files (`#docAdd`).
- **Out:** in the dashboard tab, fetch the path and save the text — e.g. `browser_evaluate` with `async () => (await fetch('/game')).text()` and a `filename`. The saved file is a JSON string; decode it with `json.loads`.
- **Sharing on anahub.io:** Use cases → "＋ 내 ANA 공유하기" (sign-in needed). It is a public post: check that no names or e-mail addresses are visible in the screenshots, and do not put the private codespace address in the site-address field.

## 7. Driving the dashboard with Playwright

- Page snapshots are large. Save them with `filename` and `grep` for the `ref` you need. Refs change on re-render — look them up again right before clicking.
- Send a message: type into `role=textbox[name="Message input"]` with `submit: true`.
- Change tab: click `[aria-label="Menu"]`, then the `[role=tab]` whose text starts with the name (Requests / Evolve / Update carry a badge number, so match with `startsWith`). Sub-tabs are `#topSub [role=tab]`.
- **Is the agent working?** `[aria-label="Stop the current task"]` is visible. A wait loop should also break when an `Approve` button appears, or it will wait on a card forever.
- `browser_evaluate` moves to the background after 120 seconds. Poll in loops of under 100 seconds, or start one long wait on purpose and act on the notification. Several `browser_wait_for` calls issued together end together — they do not add up.
- Confirmation dialogs are in-page modals (`#scrim`). While one is open, clicks behind it are blocked: screenshot it, read it, and press the button inside it.
- If the chat panel covers the Work screen, close it with `#chatCloseBtn`.
- List rows can be `[role=button]` rather than `<button>`. Widen the selector before concluding something is missing.
- When setting an input from script, use the native value setter and dispatch `input` and `change`.
- After every action, confirm the result from the page text (a filter count, a status label, a time stamp) — not from the click having succeeded.

## 8. When the codespace stops

- **Signs:** the dashboard returns 401 / `ERR_HTTP_RESPONSE_CODE_FAILURE`; the editor tab says "Stopping codespace…" or "Codespace is stopped".
- **Cause:** about 30 minutes without activity on the editor side. Using the ANA page on the forwarded port did not count, and neither did sending a keyboard shortcut to the editor.
- **Recover:** open `https://<codespace>.github.dev/` again; it restarts within a minute and the ANA tab reopens. Data and the conversation survive (`claude --continue`). If the agent sits idle, send "please continue".
- **Prevent:** before creating the codespace, raise GitHub Settings › Codespaces › Default idle timeout (up to 240 minutes; applies to new codespaces). In one that is already running, start a **bounded** output loop in the editor's terminal — `for i in $(seq 1 22); do date; sleep 240; done` kept one alive for 90 minutes. Never an endless loop: it keeps billing.
- Check `github.com/codespaces` to see which codespace is active. The person may be using the same browser — do not touch tabs or codespaces you did not open.

## 9. Rules

- Sign-ins (password, 2FA, picking an OAuth account) are the person's. Stop at that screen and say so.
- Anything that leaves the machine — real mail, a public post — only after the person confirms how and to whom. Never guess an e-mail address.
- Approve a card only when its *Change* lines match what the person gave you or asked for.
- Hard-to-undo buttons — delete, Restart, Bring it in — only on the person's request.
- To restart the server use System › Restart the server or `bash skills/install/scripts/run.sh restart`. Not `killall node`.
- `channel-core.js` is the shared runtime. Do not ask the agent to patch it.

## 10. Troubleshooting

| Symptom | Do this |
|---|---|
| A fix is not visible | Press the "New version available" pill or reload. If routes changed, System › Restart the server |
| "Agent input line is not ready" | A login, trust or menu dialog is open in the terminal. Use the *Terminal view & keys* card in the chat |
| A bubble says Unconfirmed / Send failed | Resend |
| Approved, but "unknown list" | The kind is not declared in `work-ontology.js`. Have it declared, then Try again on the card |
| "Server unreachable — reconnecting", or the page returns 401 | The codespace stopped — see section 8 |
| Recovery mode | The container setup failed. Read the creation log |

---

A Korean edition of this skill, for installing into a personal Claude Code, is kept at <https://github.com/sw-woo/ana-usage-skill>.
