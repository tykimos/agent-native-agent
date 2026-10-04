---
name: install
description: Install and run ANA (Agent-Native Agent) from scratch on macOS, Linux, or Windows (via WSL) — analyze the environment, install exactly what is missing (Node ≥ 24, tmux, git, curl, Claude Code CLI), clone the repo if needed, then start the agent and the ANA server in tmux and verify the dashboard answers. tmux is mandatory and only runs natively on macOS/Linux, so on Windows everything is installed inside WSL (Ubuntu). Use whenever the user says "ANA 설치", "ana 설치해줘", "install ana", "set up ANA", "ANA 실행 환경", "tmux 설치", "윈도우에서 ANA", "WSL 설치", "run ANA locally", "처음부터 띄워줘", or ANA fails to start because node/tmux/claude is missing.
---

# install — ANA from zero to a running dashboard

ANA needs three things at runtime: **Node ≥ 24**, **tmux**, and a **coding-agent CLI** (Claude Code by default). Its one npm dependency, [NodeRel](https://github.com/tykimos/NodeRel), is installed from GitHub by `install.sh` (and by `run.sh` if it is missing). This skill checks the machine, installs what's missing, and starts ANA.

```
check-env.sh ──► install.sh ──► run.sh start ──► http://localhost:8809
 (report only)    (missing only,     tmux "base-ana-claude"      (dashboard)
                   idempotent)       tmux "srv-base-ana-claude"
Windows: install-wsl.ps1 ──► WSL Ubuntu ──► install.sh + run.sh (inside WSL)
```

All scripts live in `skills/install/scripts/`, and every one is safe to re-run.

**Naming convention.** Every ANA lives in `~/ana/<xxx>-ana` (or `/ana/<xxx>-ana`); that folder name is the ANA's name (`<xxx>` may contain hyphens). The sample is `~/ana/base-ana`. Agent tmux sessions are `<xxx>-ana-<yyy>` (`yyy` = `claude`, `codex`, or any hyphenated label), and only those appear in the chat's session list. A folder that doesn't end in `-ana` (e.g. a plain `git clone` into `agent-native-agent`) falls back to the name `base-ana`. Overrides: `ANA_NAME`, `TMUX_SESSION`, `ANA_TMUX_ALL=1` (list every tmux session).

| Script | Does | Changes the machine? |
|---|---|---|
| `check-env.sh [PORT]` | Reports platform, package manager, node/tmux/git/curl/claude, repo location, port, existing session. Last line: `ANA_ENV platform=… missing=… ready=yes\|no` | No |
| `install.sh` | Installs only what's missing, installs Claude Code, clones the repo if run outside it | Yes (asks for sudo/brew) |
| `run.sh [start\|stop\|status\|restart]` | Starts the agent in tmux `<name>-claude` and the server in tmux `srv-<name>-claude`, picks a free port, health-checks | Starts processes only |
| `install-wsl.ps1` | Windows PowerShell: installs WSL + Ubuntu if absent, otherwise runs install + run inside WSL | Yes (Windows features) |

## Workflow (follow in order)

### 1. Analyze the environment first. Never install blindly.

```bash
bash skills/install/scripts/check-env.sh
```

Read the `ANA_ENV` line and branch:

| `platform` | Meaning | Next |
|---|---|---|
| `macos` | macOS | step 2 |
| `linux` | native Linux | step 2 |
| `wsl` | Linux inside Windows (WSL) | step 2 (and see the WSL notes below) |
| `windows-native` | Git Bash / MSYS / Cygwin on Windows, **no tmux possible** | go to **Windows** below |

If you're in plain Windows PowerShell or cmd (no bash at all), go straight to **Windows**.

`ready=yes` → skip to step 3. `ready=no` → step 2. Tell the user what is missing *before* installing.

### 2. Install what's missing

```bash
bash skills/install/scripts/install.sh
```

| Platform | How |
|---|---|
| macOS | Homebrew (installs it if absent) → `brew install node tmux git` for the missing ones |
| Debian/Ubuntu/WSL | `apt-get install tmux git curl` + Node 24 from NodeSource |
| Fedora/RHEL | `dnf`/`yum` + NodeSource RPM |
| Arch / openSUSE / Alpine | `pacman` / `zypper` / `apk` |
| All | Claude Code via `curl -fsSL https://claude.ai/install.sh \| bash` (skip with `SKIP_CLAUDE=1` if you use another agent CLI) |

The script needs `sudo` (Linux) or your password (Homebrew). This is interactive: if you are an agent running it, tell the user it will prompt, or have them run it with `! bash skills/install/scripts/install.sh`. Outside the repo it clones into `ANA_DIR` (default `~/ana/base-ana`; override `ANA_REPO` / `ANA_DIR`, keeping the `~/ana/<xxx>-ana` form). Re-run `check-env.sh` afterwards; it must say `ready=yes`.

### 3. Run

```bash
bash skills/install/scripts/run.sh            # = start
bash skills/install/scripts/run.sh status     # agent/server sessions + URL + health
bash skills/install/scripts/run.sh stop
```

- The agent runs in tmux `<name>-claude` (the `claude` command; `base-ana-claude` for `~/ana/base-ana`), and the server runs in tmux `srv-<name>-claude` (`PORT=… ANA_NAME=<name> TMUX_SESSION=<name>-claude node server.js`). The `srv-` prefix keeps the server out of the chat's session list. A server still running under the old name `<session>-server` is reused.
- If 8809 is busy, the next free port is used. `status` prints the real URL.
- Env overrides: `ANA_NAME`, `TMUX_SESSION=name`, `PORT`, `AGENT_CMD="codex"` (any agent CLI), `BIND`. A second agent for the same ANA: `AGENT_CMD=codex TMUX_SESSION=base-ana-codex bash run.sh`.
- **First run:** Claude Code needs a one-time login and a folder-trust confirmation. Tell the user to run `tmux attach -t base-ana-claude` (or `<name>-claude`), finish it, then detach with `Ctrl-b d`. Until then the dashboard loads but the agent can't answer.

### 4. Verify, then hand off

`run.sh status` must show `health : HTTP 200`. Give the user the URL and the three things they'll use:

1. **Open the dashboard:** `http://localhost:<port>`
2. **Chat:** the chat icon (bottom right) is always there. Turn on **Chip** (top right) to click dashboard elements into context chips.
3. **Watch the agent directly:** `tmux attach -t base-ana-claude`

## Windows (WSL)

tmux does not run natively on Windows. ANA runs **inside WSL**, and the Windows browser reaches it at `localhost` (WSL2 forwards ports automatically).

1. Open **PowerShell as Administrator** (only needed the first time) in the repo folder, or download just the script:
   ```powershell
   powershell -ExecutionPolicy Bypass -File skills\install\scripts\install-wsl.ps1
   ```
2. If WSL/Ubuntu isn't installed yet, the script runs `wsl --install -d Ubuntu`. **Reboot if asked**, open "Ubuntu" from the Start menu once to create the Linux user, then **run the script again**. No admin is needed the second time.
3. On the second run it goes into Ubuntu, installs git, clones the repo into `~/ana/base-ana` (the Linux home, not `/mnt/c`), runs `install.sh`, then `run.sh start`.
4. Open `http://localhost:8809` in the Windows browser. Log the agent in with `wsl -d Ubuntu -- tmux attach -t base-ana-claude`.

Manual equivalent (already inside an Ubuntu/WSL shell):

```bash
sudo apt-get update && sudo apt-get install -y git curl
git clone https://github.com/tykimos/agent-native-agent ~/ana/base-ana
cd ~/ana/base-ana
bash skills/install/scripts/install.sh && bash skills/install/scripts/run.sh
```

Parameters: `-Distro Ubuntu-24.04`, `-Repo <fork url>`, `-Dir ~/ana/<xxx>-ana`.

WSL notes:
- Keep the repo in the Linux filesystem (`~`). Under `/mnt/c/...` file I/O is slow and `check-env.sh` warns about it.
- `localhost` not reachable from Windows → WSL1 or forwarding disabled. Check with `wsl -l -v` (VERSION must be 2; upgrade with `wsl --set-version Ubuntu 2`).
- Line endings: `.gitattributes` forces `*.sh` to LF so a Windows-side checkout doesn't break bash.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `tmux: command not found` | Run `install.sh`. On Windows you must be inside WSL. |
| `node` too old (< 24) | `install.sh` upgrades via NodeSource/brew. With nvm: `nvm install 24`. |
| `claude: command not found` right after install | New PATH not loaded: `export PATH="$HOME/.local/bin:$PATH"` or open a new shell. |
| Dashboard loads but the agent never replies | Agent not logged in or stuck on the trust prompt: `tmux attach -t base-ana-claude`. |
| Port already in use | Another ANA or app. `run.sh` picks the next port. Read it from `run.sh status`. |
| Want two ANAs on one machine | Clone a second folder `~/ana/<other>-ana` and run its `run.sh`: separate tmux sessions (`<other>-ana-claude`), next free port. |
| Server crashed | `tmux attach -t srv-base-ana-claude` to read the error, then `run.sh restart`. |
| Server must be reachable from other devices | `BIND=0.0.0.0` has **no auth**. Use a trusted network only, or put it behind a gateway (see the `cloud-setting` skill for Cloudflare Tunnel). |

## Related skills

- `ana`: attach the ANA runtime (`channel-core.js`) to an existing web app.
- `cloud-setting`: run ANA on a cloud VM with systemd and a Cloudflare Tunnel.
