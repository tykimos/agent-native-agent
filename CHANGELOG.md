# Changelog

All notable changes to ANA. Versions follow the Claude Code plugin version in `.claude-plugin/plugin.json`.
**English** · [한국어](CHANGELOG.ko.md)

To bring an existing ANA up to date with these changes, use the [`ana-update`](skills/ana-update/SKILL.md) skill. It compares that ANA with this repo feature by feature and ports only what you pick.

## [0.10.0] — 2026-10-27

**Work and Knowledge.** ANA is now described, stored and shown as two layers. Each layer is an ontology (the kinds) and a graph (the actual things). See [docs/relations.md](docs/relations.md).

| | Work layer | Knowledge layer |
|---|---|---|
| The actual things | work items (notes, tasks, events) and the links between them | entities and facts found in the work |
| Ontology (System) — classes, relations, rules | **Work ontology**: `work-schema.js`, from the code | **Knowledge ontology**: `.ana/ontology.json`, kept by the admin |
| Graph (each workspace) | **Work graph**: `state.json` | **Knowledge graph**: `kg.json` |
| In the app | **Work**: Tasks · Calendar · Notes · **Links** | **Knowledge**: one page |

### Changed

- **No more "built-in" core.** What the app stores is the **Work ontology**, declared by each ANA in `work-schema.js` (new). Nothing in it is universal: an ANA without tasks has no Task.
  - `graph.js` reads its vocabulary from it, and so does the *Links by kind* table. A test checks that the node kinds and link kinds the app really produces are exactly the declared ones.
  - In System › Ontology, the Work ontology is tagged **Work** (read-only) and both layers are explained. Their links show all their classes (Note · Task · Event).
  - API: `source: "work" | "knowledge"` replaces `core`.
- **Screens follow the layers.**
  - The work graph (formerly Knowledge › Links) moved to **Work › Links**.
  - **Knowledge** is one page: the knowledge graph, *Analyze* in its toolbar, and the latest analysis (above the graph while it runs or waits for you, below it otherwise). The *Analysis* and *Ontology* sub-tabs are gone.
  - The ontology has one page, System › Ontology. *Knowledge › Ontology* takes the admin there and shows members the same content read-only in a popup.
- **Work links are a lens too.** A new kind of link such as `BLOCKS` (UPPER_SNAKE_CASE) is stored and shown as *(new)* / *not in the Work ontology yet*, in the chart, on item chips and in *Links by kind*. The known kinds keep their From → To, because the app's features read them. DUE_ON and ON can't be made by hand.
- **Inbox: *Work requests* → *Action requests*** (실행 요청), so "work" means only the Work layer.
- **Broken references are shown, not hidden.** When a kind disappears (a feature was removed, a concept deleted) but others still point at it, `GET /api/ontology` returns `issues`. System › Ontology lists them and keeps the class in the tree tagged *parent … missing*.
- Removed: merging per-workspace analysis ontologies from before 0.8.0, and facts held back as `pending`.

### Added

- **Rules — the third part of an ontology** (System › Ontology › *Rules*). An ontology is now **classes + relations + rules**.
  - **Chain rules:** *if* a path of 1 to 3 relations *then* a relation — x attends y, y part_of z ⇒ x involved_in z. A step can be walked in reverse (`^attends`: people at the same workshop ⇒ meets), and one step makes a sub-relation.
  - **Limit rules:** at most N of a relation per From or per To. Facts over the limit are kept and marked *breaks a rule*.
  - Inverse, symmetric and transitive (set on the relation) and chains run in one engine to a fixed point, so rules build on each other's results. Inferred facts carry `rule`, `ruleLabel` and `because`. The Work ontology's compute rules (DUE_ON ← Task.due, ON ← Event.date) are listed read-only.
  - Exported as OWL: `rdfs:subPropertyOf`, `owl:propertyChainAxiom`, `owl:Restriction` + `owl:maxCardinality`. A relation a rule uses can't be removed; a rule pointing at something removed shows in `issues`.
  - API: `POST /api/ontology {kind: "rule"}`. The [Analyze] instruction tells the agent rules derive facts on their own.
- **Sub-classes on work items.** When a Knowledge class is a kind of a Work class (Ticket ⊂ Task, Meeting ⊂ Event), a work item can carry it (`POST /api/subtype`). The pill next to the title appears only when such sub-classes exist. The app still treats the item as a task; the knowledge side reads it as a Ticket.
- **Promotion evidence:** `GET /api/ontology/evidence` lists new link kinds in use, sub-classes on items, and Knowledge classes whose entities mostly come from one kind of item. The system [Evolve] instruction points at it, so use and knowledge can become features. A feature that changes the Work ontology updates `work-schema.js` in the same change.
- **System › Inbox: *Ask the agent* on every tab.** Approvals and Action requests have it too, not only Evolve. The agent reads checks, updates, the ontology, usage, workspaces and open admin items, then registers what it needs from the admin (`/api/admin/requests`).
- **Draw on popups.** With Chip on, the pen also works while a popup is open. The capture is the popup, and the chip names the popup and the field or button under each mark. Turning Chip on no longer closes the open popup.
- **Drawing on ontology rows** gives chips such as `Relation "SCHEDULED_AS (Task → Event)"`. Drawn marks use each target's own chip text.

### Fixed

- **"Not connected" after the sign-in expired.** Behind a sign-in gateway, an expired sign-in makes API calls return `401 {"error":"Sign-in required"}`. The page read that as the agent status and stuck on *Not connected* until a manual refresh. Now it shows **Signed out — tap to sign in**. When nothing is being typed or uploaded, it reloads once by itself to sign in again (at most once a minute). While the server can't be reached it re-checks every 2 seconds instead of 5.
- **The analysis card speaks Work and Knowledge.** It reads "read 2 notes · 5 tasks → found 17 entities · 26 facts · 2 new classes · 1 new relation". *Add to the knowledge graph* is the main button, and the views are *Entities & facts · Classes & relations*. Export lives in one place, the knowledge graph's toolbar, not also in the card. The Analyze popup is *Analyze your work*.
- Popup text boxes and the *Send* button had no style.
- Phone toolbars no longer hide buttons off-screen: short labels, ellipsis, compact Open/Done pills.
- A class whose parent was missing disappeared from the ontology tree, and from an analysis result's tree. It now stays at the top level, marked.
- Leftover "Collaborate" wording; the Tests command no longer scrolls sideways; no /favicon.ico 404.

## [0.9.0] — 2026-10-25

The ontology becomes a **lens, not a gate**: it guides the agent and lets ANA check and reason, but never limits what the agent may find or propose. Plus **rule reasoning** on the knowledge graph, and Evolve always in the Inbox.

### Added

- **Rule reasoning on the knowledge graph.** A relation type can be marked *inverse of* another, *symmetric* or *transitive* (System › Ontology › Relations). Reading the knowledge graph derives the facts these rules imply (acme *employs* pat from pat *works_for* acme; o1 *part_of* o3 from a chain), plus each entity's super-classes. Derived facts are never stored: they come back as `inferred` with the `rule` and the facts they come `because` of, show as dashed lines (toggle *Inferred*), reach NodeRel marked `inferred`, and export as `owl:inverseOf` / `owl:SymmetricProperty` / `owl:TransitiveProperty`.

### Changed

- **The ontology is a lens, not a gate.** It guides the agent; it no longer limits what it may say.
  - An analysis keeps what doesn't fit — an unknown class or relation, a fact whose From → To doesn't match — and marks it *not in the ontology yet* (orange) instead of dropping it. Only facts pointing at missing entities are dropped.
  - Adding to the knowledge graph no longer holds anything back waiting for the admin. Whether something fits is computed when the graph is read, so when the admin adds a concept it fits at once.
  - Concepts an analysis uses without declaring them also go to the admin. The admin request is now tidying, not a gate.
  - The [Analyze] and [Evolve] instructions say so: use the ontology where it fits, say what you actually found where it doesn't, and propose changes to the ontology itself.

- **Evolve is always in the Inbox.** System proposals moved from Roadmap to **System › Inbox › Evolve**, the same place as Workspace › Inbox › Evolve, with the same cards and buttons (*Start* for the admin, *Request approval* for members). The Roadmap now only follows progress: *Requirements · Updates* (a requirement's proposal still shows on its line).


## [0.8.0] — 2026-10-24

A new structure: **two scopes** (Workspace for members, System for the admin), an inbox in each, **roles**, a **System ontology with a knowledge graph per workspace**, and **Health › Tests**.

### Added

- **Two scopes, one inbox each.** The three areas (Workspace / Collaborate / System) are now two, and the top of the screen always shows which one you are in.
  - **Workspace** (members): **Work** (Tasks · Calendar · Notes) · **Knowledge** · **Files** · **Inbox**.
  - **System** (admin only, dark header band): **Inbox** · **Roadmap** · **Ontology** · **Health**.
  - Phones get a bottom menu per scope (Work · Knowledge · Files · Inbox · System / Inbox · Roadmap · Ontology · Health · Workspace). The top tab row shows only for Tasks · Calendar · Notes. On desktop, a switch next to the logo changes scope.
  - **One kind of thing per page:** pages with several kinds have sub-tabs, each showing how many need you. Lists filter *Open / Done*, and each card still shows its own state.
    - Workspace Inbox: *Approvals · Work requests · Evolve · Sent*
    - System Inbox: *Approvals · Work requests*
    - Knowledge: *Links · Knowledge graph · Analysis · Ontology*
    - Roadmap: *Requirements · Evolve · Updates*
    - Ontology: *Classes · Relations*
    - Health: *Trustworthiness · Safety · Security · Tests · Usage*
  - Tabs went from 16 to at most 6 per scope. Menus never wrap on phones: sub-tabs and toolbars scroll sideways, and the System header drops its subtitle on narrow screens.
- **Admins and members.** `ANA_ADMINS=email,…` names the admins. If the list is empty, the install has no identity header (single user), or a call comes from this machine without identity, everyone is admin, so single-user installs behave as before.
  - **Admin-only, checked on the server:**
    - starting, cancelling or retrying a system proposal
    - bringing in an Update
    - switching the agent to Bypass / Full Access
    - deleting a workspace
    - project files
    - changing the ontology
    - running tests
  - A member's tap on one of these becomes an **approval request in System › Inbox**. When the admin approves it, the action runs.
  - **System › Inbox** collects approval and work requests from members (*Ask the admin*), the agent (`POST /api/admin/requests`) and the system checks: a check at risk opens a work request and closes it once fixed. Members follow theirs under Inbox › *Sent*. The profile menu shows your role.
- **Evolve in two places.** Workspace › Inbox › *Evolve* holds ways to run this workspace better with existing features: members start them, and the agent is told to change only that workspace's data. System › Roadmap › *Evolve* holds changes to the system itself, which only the admin starts. *Propose to the system* lifts a workspace proposal that needs a new feature.
- **Roadmap.** Requirements, system proposals and upstream updates sit on one line each with their stage (*Request → Proposal → Building → Checked*) and the next action: *Check*, *Propose*, *Start*, *Check again*, *Bring in*. Members send requirements with *Request a feature*.
- **Requirement → proposal → re-check.** A requirement judged *Not reflected* or *Partly* can become a system proposal in one tap (it carries the next step and reason). When that proposal is done, the requirement asks to be checked again.
- **Ontology in the System, knowledge graph in each workspace.** See [docs/relations.md](docs/relations.md).
  - **System › Ontology:** one ontology shared by every workspace. The core (Note · Task · Event · Day and the app's relations) is built in and locked; the admin adds, edits and removes the rest. A concept still used by a knowledge graph can't be removed.
  - **Knowledge graph per workspace** (`kg.json`), shown in Knowledge › *Knowledge graph*, and opened in OntoAir or downloaded as Turtle (shared ontology as TBox, the workspace's facts as ABox).
  - **Analyses** read the shared ontology. A new class or relation in a result becomes an admin approval request.
  - The result is added only when a member approves it (**Inbox › Approvals** or Knowledge › Analysis: *Add to the knowledge graph* / *Discard*). Facts that use a concept still waiting for approval are added to every workspace automatically once the admin approves it. Members can remove a wrong entity or fact.
  - The knowledge graph is indexed in NodeRel (`kg:<id>`, relation-typed facts, `MENTIONED_IN` to source items) for `/api/graph/trace · neighbors · schema`.
- **Health › Tests.** The admin runs this ANA's tests (`package.json` scripts.test). The page shows passed / failed per suite, the failing tests, the output and earlier runs. A failed run counts on the Health badge.
- **Examples banner.** While the first-run example notes, tasks and events are still there, Workspace shows *These are examples — Clear them / Keep*. Examples are seeded once per install (`.seeded`), so they never come back.
- **ANA's own instructions show as cards in chat**, not as your bubbles: *Asked the agent to analyze 10 items · #1*, with **Open** (goes to that tab) and *Show instruction*. The usage log records them as `analysis.request`, `evolve.request`, … instead of `chat.send`.

### Changed

- **Files** is one folder per workspace (`.ana/files` for the base workspace, or `ANA_FILES_ROOT`). *From chat* shows chat attachments read-only, and *Project files* is admin-only with no writes into `.ana/` or `.git/`.
- **Health** puts Stats and the three check areas in one place. In each area the riskiest checks come first and OK checks are folded.
- **The usage log** records what you do in the app: tab and sub-tab visits, approvals, proposal and request actions, requirement edits, uploads (folder or type and size, no names), OntoAir opens, `.ttl` downloads and test runs. `chat.send` keeps only the first 60 characters plus the length.
- The README phone image shows the new layout.

### Upgrade notes

- Existing evolve proposals become **system** proposals. Existing requests stay in their workspace.
- The first time the ontology is read, each workspace's earlier analysis ontology is merged into `ontology.json`. Concepts that clash with the core are skipped. Earlier analysis results are **not** added to any knowledge graph until a member approves them (Inbox › Approvals).
- To give someone a member role, set `ANA_IDENTITY_HEADER` (the identity header your gateway sends) and `ANA_ADMINS`. Until then everyone is admin.
- New API: `/api/admin/inbox · requests · act`, `/api/ontology`, `/api/kg`, `/api/kg/ttl`, `/api/analysis/apply · discard`, `/api/tests`, `/api/tests/run`, `POST /api/activity`. `/api/evolve` takes `scope`, and `/api/evolve-act` adds `escalate`. `/api/analysis/ontology/reset` and `useBase` are gone.

## [0.7.0] — 2026-10-24

### Added

- **Offline edition for Windows x64 (no LLM, no internet, no tmux).** `node scripts/package-offline.mjs` builds `dist/ANA-offline-win-x64-<version>.zip`: a portable Node 24 LTS (checksum-verified), the ANA base, its `node_modules`, and `start.bat`. Unzip it and double-click `start.bat`; the browser opens on `http://127.0.0.1:8809/`. Data stays in `data\`, uploads in `files\`. See [docs/offline.md](docs/offline.md).
  - `ANA_OFFLINE=1` runs any ANA this way. The page hides chat, Chip and drawing, Analyze, Open in OntoAir, Requirements › Analyze, and the Evolve · Approvals · Requests · Trustworthiness · Safety · Update tabs. tmux polling stops, and routes that need an agent or the internet answer 503.
  - `ANA_OPEN=1` opens the default browser once the server is up.
- **Switching sessions shows what it's waiting for.** Picking a session in the chat combo replaces the conversation with a progress card: *Connect to the session* → *Find the conversation log* (Claude Code / Codex and its title) → *Read the log* (MB read, with a bar) → *Show the latest messages* (latest 40 of N), each with its time. Shell sessions say there is no structured log and show the terminal mirror; a session that isn't running says so. Opening the page on a long conversation shows the same card.
  - While it loads, the chat controls say so too. The input is locked with *Loading <session>…*, the model pill shows a spinner and *Loading…*, the other buttons are dimmed and inactive, the session dot spins, and a bar runs along the top of the composer. Sending is blocked until the conversation is shown.
- **Fill the suggestion on phones.** The grey suggestion in the chat input (text typed in the terminal but not sent) now has a tappable **Tab** button. On touch screens it's a larger pill; tapping it fills in the text and keeps the keyboard open. The Tab key still works on desktop.
- **Upload progress.** Attachments show *Uploading 42%* with a fill bar in the chip. A drawing goes *Capturing… → Compressing… → Uploading %* in the same chip.

- **ANA's own instructions show as cards, not your bubbles** (Evolve proposal #1). The long messages the page sends for you are drawn as a one-line card with a tag, what was asked, **Open** (goes to that tab) and *Show instruction* (the full text). This covers `[Analyze]`, `[Evolve]`, `[Requirements]`, `[Update]`, `[Requests]`, `[Approvals]` and `[Request #n]`. Examples: *Asked the agent to analyze 10 items · #1*, *Asked the agent to do proposal #1 · …*, *Answered request #7 · B*. It works both from the agent's log and in the screen mirror. The usage log records them as `analysis.request`, `evolve.request`, `requirements.request`, `update.request`, `requests.request`, `approvals.request` and `request.answer` instead of `chat.send`.

- **Requirement → proposal → re-check** (Evolve proposal #3). A requirement judged *Not reflected* or *Partly* has **Propose this**. It adds an Evolve proposal "Requirement #N: …" that carries the analysis's next step and reason. The requirement card then shows that proposal's status with *Open in Evolve*, and the proposal shows *From requirement #N*. When the proposal is marked done, the requirement says *Proposal #N is done — check again* and its button becomes **Check again**. Only one proposal stays open per requirement.
- **"These are examples — Clear them"** (Evolve proposal #5). While the first-run example notes, tasks and events are still there, Workspace shows a banner. **Clear them** removes them and their links; **Keep** hides the banner. Examples are seeded only once per install (a `.seeded` marker), so clearing them or deleting the state file never brings them back. `ANA_SEED=0` still skips them entirely.
- **Files has its own folder** (Evolve proposal #6). System › Files now opens on **Files** (`.ana/files`, or `ANA_FILES_ROOT`). **From chat** shows chat attachments read-only. The whole project appears as **Project files** only after ticking *Show project files*, and uploads into `.ana/` or `.git/` are refused (`?root=files|chat|project`).
- **The usage log records what you do, not just chats** (Evolve proposal #7). It now covers:
  - tab visits (`tab.view`, once a minute per tab)
  - approvals (`approval.approve|reject`) and proposal actions (`evolve.do|done|fail|ignore|reopen`)
  - request actions (by `#id`) and requirement edits
  - uploads to Files (`files.upload`, folder and size) and chat attachments (`upload.attach`, type and size, no name)
  - OntoAir opens and `.ttl` downloads

  `chat.send` keeps only the first 60 characters plus the length. In-page events go through `POST /api/activity`, which accepts a fixed list of event types.

### Changed

- **Annotated screenshots are much smaller.** They're captured at most 1600 px on the long side (at most 2× scale) and saved as JPEG (quality 0.82, or 0.7 if still over 900 KB), instead of a full-resolution PNG. On the same screen: iPhone 497 KB → 62 KB, Retina Mac 285 KB → 61 KB. Pen marks and text stay legible.

- **Long conversations load in the background.** The first read of a large agent log (over 4 MB) is parsed in 4 MB chunks without blocking the server, and `/api/agentlog` answers with `loading {done, total}` until it's ready. Lines are split on bytes, so multi-byte characters at chunk edges stay intact. A 99 MB log reads in about 0.6 s.
- **Switching is faster.** The log is fetched right after the switch instead of waiting for the next health check, a poll that was still in flight no longer delays the new one by 2 s, and opening the combo pre-reads the other agent sessions' logs (`/api/agentlog?prefetch=1`), so picking one shows it at once. The terminal-mirror history no longer flashes before the log appears.

### Fixed

- The chat's "No agent connected / Start a conversation" line could stay visible above messages: a comment had swallowed the line that hides it.

## [0.6.0] — 2026-10-15

### Added

- **Collaborate › Requirements.** Write down what you want this ANA to do. *Analyze* has the agent check each requirement against the actual system and say whether it's **Reflected**, **Partly** or **Not reflected**: how it is reflected, or why not (not built yet, conflicts, needs information, out of scope, blocked), with evidence and the next step.
  - A progress bar shows while the agent works.
  - Filter by status. Edit a requirement and its analysis is marked as needing another look.
- **Relations › Open in OntoAir.** A finished analysis opens in [OntoAir](https://poc.aifactory.space/ontoair/) as a 3D ontology and knowledge graph. *Download .ttl* saves the same OWL/Turtle file. The graph travels inside the link itself (a `data:` URL after `#`, which browsers never send to a server), so it opens even when this ANA sits behind a sign-in gateway, with no public link and no change to OntoAir. Only a very large graph (over ~1.5 MB of link) falls back to a 24-hour token link, or to downloading the file for OntoAir's 📄 File.
- **[docs/relations.md](docs/relations.md)** explains the two layers of relations (fixed app links and discovered analysis), the analysis process step by step, the ontology, the knowledge graph, the checks, NodeRel indexing and export.

### Changed

- **Analysis results must fit their ontology.** Each entity's class and each fact's relation must exist, and a fact must respect its relation's From → To (sub-classes count). Facts that don't fit are dropped; entities with an unknown class keep their place without a class. Both are listed under *N items didn't fit the ontology* and returned to the agent as `issues`.
- **The ontology carries over.** Each workspace keeps the classes and relation types built so far, and the next analysis starts from them, so the same concept isn't named differently each time. Classes reused from earlier runs show *(earlier)*. *Start fresh* clears it.
- **The knowledge graph is part of the relation graph.** The latest analysis is indexed in NodeRel next to notes, tasks and events: entities as `kg:<id>`, facts by relation type, and `MENTIONED_IN` links to the items they came from. The agent can trace from a note to the people and organizations in it with `/api/graph/trace`, and `/api/graph/schema` describes the knowledge-graph vocabulary. The Links flow chart is unchanged.

### Fixed

- **Instructions sent to the agent used the browser's address.** Through a sign-in gateway (e.g. `base.anahub.io`) the agent's `curl` got 401, so analyses, requirements, evolve proposals, requests and updates couldn't report back. The page now asks the server for its local address (`/api/agent-base` → `127.0.0.1:<port>`) and puts that in every instruction.
- **Sending failed with "Agent input line is not ready … waiting on a dialog"** when the agent's input line held text that starts with a number and a dot, such as `0.5.1 기준으로…` or `3.14 …`. Reported by world-ana. The check took it for a menu item (`❯ 1. Yes`). Menu items now need a space (or the end of the line) after the dot, in all four places in `channel-core.js`. Real menus are still blocked, and the chat's send clears the leftover text and delivers the message. Regression test in D9.
  - **Numbered-list input** such as `1. run the tests first…` is told apart from a menu by the row under the input box. The normal box has a mode status line (`⏵⏵ auto mode on (shift+tab to cycle)`, `⏸ plan mode on`, `? for shortcuts`). A menu replaces the box and shows a controls hint (`Enter to select · Esc to cancel`) instead. Checked on real Claude Code screens: a typed numbered draft reads as ready, and the `/model` picker still reads as a menu.
- **Agent-internal notices showed up as your chat bubbles.** Claude Code's `<task-notification>` (a background task finished) now renders as a one-line system note, e.g. *Background task completed: …*, in both the log view and the screen mirror.

## [0.5.1] — 2026-10-14

### Changed

- **Long conversations open fast.** Switching to a session loads only the latest 40 messages. Scrolling up loads the earlier ones 40 at a time, and the message you're reading stays in place. The top of the chat says *Loading earlier messages…*, and *Beginning of the conversation* once everything is loaded. Updates to earlier messages that aren't loaded yet are no longer appended at the bottom (`/api/agentlog?before=&limit=`).

## [0.5.0] — 2026-10-14

### Added

- **Start in GitHub Codespaces.** Run ANA in the browser with no local install: open the codespace, open **ANA / 8809** in Ports, and finish Claude setup in the ANA chat ([guide](docs/codespaces.md)). The conversation resumes when the codespace restarts.
- **Claude Code setup in the chat.** First-run screens are rendered as cards: theme choice (seven unnumbered options, chosen with the arrow keys), login method, the OAuth link, and a password-type code field. Login codes go only to the live prompt and are never stored.
- **System › Files.** Browse this ANA's folder (`ANA_FILES_ROOT` to change it), upload into the current folder (25 MB per file, existing files are never overwritten), and download. Symbolic links and paths outside the folder are refused. The list is a compact explorer: one row per item with name, size, modified time and download (the time is hidden on phones).
- **Collaborate lists by status.** Evolve, Approvals and Requests each have a filter: **Waiting · In progress · Done · Failed · Cancelled**, with counts. The choice is remembered per tab. Phones show it as a five-column grid.
  - **Failed:** in-progress proposals and requests get a *Failed* button, and the agent can report a failure with a reason (`action: fail`). A data change that can't be applied now stays as **Failed** with the error, instead of silently going back to waiting. *Try again* retries it.
  - Finished and cancelled items are no longer hidden; they list newest first, with the time.
  - **Evolve:** cards in progress get *Mark done* and *Cancel*. Done ones can be *Reopened* and cancelled ones *Restored* (`/api/evolve-act` → `reopen`).
  - **Approvals:** data changes now include applied and rejected ones (`GET /api/proposals`).

- **Permission shield in the composer.** Next to the model pill: a shield that shows the agent's permission mode at a glance. It turns red with "!" when the agent runs without asking (Bypass, Full Access). Tap it for a permissions-only sheet.

- **System › Update.** *Check for updates* compares this ANA with the latest agent-native-agent on GitHub, feature by feature, and lists what's worth bringing in: missing or partial features, newer modules, a newer shared runtime.
  - *Update* hands the item to the agent with the exact skill, the missing parts and the upstream checkout. The agent ports it and reports done or failed.
  - *Cancel* hides that item from later checks.
  - Items use the same five lists: Waiting · In progress · Done · Failed · Cancelled.
  - `ANA_UPDATE_TARGET` / `ANA_UPSTREAM_URL` change what is compared.
- On phones the System tab bar scrolls to the selected tab and fades its edge where more tabs are hidden.

- **Relations analysis.** *Analyze* on the Relations tab lets you pick notes, tasks and events (and a focus). The agent then builds an **ontology** (kinds of things and relations) and a **knowledge graph** (the actual things and facts, each citing its source items).
  - A progress bar shows the agent's steps while it works.
  - The result has two views: *Ontology* and *Knowledge graph*. Tap an entity for its facts and sources.

### Changed

- **System › Reliability is now Trustworthiness.** Same checks; the tab and docs use the new name.

### Fixed

- **Codex dialog options** are parsed and selected correctly in the chat.
- **Trust prompts:** safety notes are no longer mistaken for unnumbered trust choices.
- **File uploads failed on a server started before the Files tab existed** (the page was new, the API wasn't). The fix is a server restart; the page is unchanged.
- **On phones, the chat button covered the last row's Download button.** Views now leave room above the button.
- **Chat history now follows the selected tmux session when several Claude sessions share one folder.** The chat used to read the newest conversation file in that folder, so every session (for example `<name>-ana-claude-1` and `-2`, or one session per person) showed the same conversation. It now reads the conversation of the Claude process running in that pane, from `~/.claude/sessions/<pid>.json`, then the pane's `@ana_session_id` tag, and only then the newest file. A new session that hasn't been used yet now shows an empty chat instead of another session's conversation (`agent-log.js`).

- **Codex chat showed no replies, no model name and no usage** once its session had been running for more than a week. Codex keeps writing to the log in the folder of the day the session started, but the lookup only searched the last 7 day folders. It now picks the most recently modified log for the folder.

- **The model name in the composer was cut off** ("Opus 5…") in the desktop chat panel and on narrow phones, once the shield and usage rings were added. The pill no longer shrinks. The round controls size to the composer's own width (container queries: 40 → 34 → 31 px), so the desktop panel and phones follow one rule.

- **Selected status filter was unreadable in dark mode** (white text on a light pill). The selected pill now uses the inverse theme colour, so it reads in light and dark.

## [0.4.2] — 2026-10-06

### Added

- **Permission mode picker.** The chat's model sheet has a **Permissions** row under Effort.
  - **Claude Code:** Manual · Accept edits · Plan · Auto · Bypass permissions. The current mode is read from the status line, and switching presses Shift+Tab until it shows. It applies to this session only.
  - **Codex:** Ask for approval · Approve for me · Full Access, through Codex's own `/permissions` menu. Codex also saves the choice as its default.
  - Modes that never ask (Bypass, Full Access) need a confirmation. **System › Safety** now reports the live mode instead of the start flags.
  - New module `permission-mode.js` and API `/api/agent-permission`.

## [0.4.1] — 2026-10-04

One naming rule for every ANA: the folder gives the name, and the name gives the tmux sessions.

### Changed

- **Folder → ANA name.** Every ANA lives in `~/ana/<xxx>-ana` (or `/ana/<xxx>-ana`), and the folder name is the ANA's name. `<xxx>` may contain hyphens. This repo's sample is `base-ana`: install into `~/ana/base-ana`. A folder that doesn't end in `-ana` falls back to `base-ana`; `ANA_NAME` overrides.
- **Default tmux session is `<name>-claude`** (was `ana`), e.g. `base-ana-claude`. `TMUX_SESSION` still overrides it, so existing deployments keep their session.
- **Chat session list shows only this ANA's sessions:** `<xxx>-ana-<yyy>`, where `yyy` is the agent label (`claude`, `codex`, or any hyphenated label). The connected and default sessions always stay listed. `ANA_TMUX_ALL=1` lists every tmux session. `/api/config` and `/api/health` now report `ana`.
- **Install scripts.** `install.sh` and `install-wsl.ps1` clone into `~/ana/base-ana`. `run.sh` and `check-env.sh` derive the session from the folder, and `run.sh` names its server session `srv-<session>` so it stays out of the chat list. A server still running as `<session>-server` is reused.
- `channel-core.js` exports `anaNameOf`, `defaultSession` and `isAnaSession`.
- README, the `install` skill and the `ana` skill use the new paths and session names, with a short "Naming convention" section.

### Fixed

- **Chat header stuck on "Not connected" until a reload** while the agent was actually running.
  - **Cause:** after the iPhone screen locks or the tab goes to the background, Safari can leave the connection half-dead. Status, session-list and stream requests then neither failed nor answered. The page had no timeouts, so the header and the session popup (its "Start an agent in tmux…" placeholder) stayed frozen.
  - **Now:** every poll has a timeout. Coming back to the page re-checks at once (`visibilitychange`, `pageshow`, `online`). A live stream that has been silent for over 40 seconds is reopened (the server pings every 15 seconds).
  - The header says **Reconnecting…** while the server can't be reached, and **Not connected** only when the server reports that the agent isn't running.

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

[0.8.0]: https://github.com/tykimos/agent-native-agent/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/tykimos/agent-native-agent/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/tykimos/agent-native-agent/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/tykimos/agent-native-agent/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/tykimos/agent-native-agent/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/tykimos/agent-native-agent/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/tykimos/agent-native-agent/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/tykimos/agent-native-agent/compare/d690eda...v0.4.0
[0.3.0]: https://github.com/tykimos/agent-native-agent/commits/d690eda
