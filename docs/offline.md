# ANA offline (Windows x64) — install and use

**English** · [한국어](offline.ko.md)

ANA running on one Windows PC with no internet, no LLM (AI agent) and no tmux. A portable Node is included, so there is nothing else to install.

## What's in, what's off

| Works | Off (needs an AI agent or the internet) |
|---|---|
| **Workspace**: tasks · calendar · notes, multiple workspaces | Chat, Chip and drawing |
| Links between items (→ Task / → Event / ＋ Link), relation chips | Relations › Analyze, Open in OntoAir |
| **Workspace**: Knowledge (flow chart, where the flow breaks, earlier analysis results, .ttl download), Files (upload/download) | agent checks in Health (only Security is shown) |
| **System**: Roadmap (write requirements), Health | Inbox (agent requests), Roadmap › Check all / Ask the agent / Check for updates |

## Install

1. Copy `ANA-offline-win-x64-<version>.zip` to the PC (USB etc.).
2. (Optional) Check it: in PowerShell, run `Get-FileHash .\ANA-offline-win-x64-<version>.zip` and compare with the `.sha256` file.
3. Right-click the zip and open **Properties**. If there is an **Unblock** box at the bottom, tick it and press OK. A zip downloaded from the internet carries a mark that can stop the extracted files from running.
4. Extract it anywhere you can write to, e.g. `C:\ANA`. Paths with spaces or Korean letters are fine. Avoid Program Files.

No installer and no administrator rights are needed. To uninstall, delete the folder.

## Run

- **Double-click `start.bat`.** A console window opens, then your default browser opens `http://127.0.0.1:8809/`.
- On the first run, Windows Firewall or SmartScreen may ask.
  - ANA listens only on this PC (127.0.0.1), so you can **Cancel** the firewall prompt.
  - If SmartScreen blocks it, press **More info → Run anyway**. `node\node.exe` is the official Node 24 LTS signed by the OpenJS Foundation.
- **Stop:** close the console window, or press `Ctrl+C` in it.
- The first run includes example notes, tasks and events. To start empty, add `set ANA_SEED=0` under `set ANA_OFFLINE=1` in `start.bat` **before** the first run.

## Folder layout

```
ANA-offline-win-x64-<version>\
  start.bat        run
  node\node.exe    Node 24 LTS (portable)
  app\             ANA (server.js, dashboard.html, node_modules …)
  data\            your data, created on first run (state.json, analysis.json, graph.sqlite …)
  files\           files uploaded in System › Files
  INSTALL-EN.txt · INSTALL-KO.txt · VERSION.txt
```

## Back up, move, upgrade

- **Back up:** stop ANA, then copy `data` and `files`.
- **Move to another PC:** copy the whole folder.
- **Upgrade:** stop ANA and extract the new zip somewhere else. Then move your `data` and `files` folders into it and run the new `start.bat`.
- `graph.sqlite` is an index rebuilt from `state.json`, so it is safe to delete.

## FAQ

- **It quits with "port 8809 already in use":** open `start.bat` in Notepad and change `set PORT=8809` to another number, such as 8810.
- **The browser didn't open:** open `http://127.0.0.1:8809/` yourself. Current Edge or Chrome is recommended.
- **Use it from other PCs on the network:** change `set BIND=127.0.0.1` to `set BIND=0.0.0.0` in `start.bat`. Then **anyone who can reach the PC can read and write without signing in**, so only do this on a trusted internal network. System › Security marks it as a risk.
- **Earlier analyses:** if you bring over a `data` folder from an online ANA, Relations shows its ontology and knowledge graph, and you can download them as `.ttl`. A new analysis needs an AI agent, so it isn't available offline.

## Building the package (developers)

On a Mac or Linux machine with internet, from the repository root, after `npm install`:

```bash
node scripts/package-offline.mjs     # → dist/ANA-offline-win-x64-<version>.zip (+ .sha256)
```

- The script downloads the Windows Node build from nodejs.org (default `v24.22.0`) and checks its SHA-256. It then copies only the runtime files and `node_modules`, adds `start.bat` and this guide, and zips the result.
- Set `NODE_DIST_VERSION=v24.x.y` to use another version.
- Offline mode is `ANA_OFFLINE=1`. Here is what it does:
  - The server marks the page with `data-offline` so the agent screens are hidden.
  - tmux polling stops.
  - Routes that need the internet or an agent (`/api/limits`, `/api/update/*`, `/api/analysis/start`, `/api/requirements/analyze`, …) answer 503.
