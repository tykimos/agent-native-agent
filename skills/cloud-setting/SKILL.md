---
name: cloud-setting
description: Provision and wire up a cloud VM as an ANA (Agent-Native Agent) host end-to-end — create an Azure VM (az CLI), record its connection info, SSH in, install Node ≥ 20 + tmux + Claude Code, clone a project into ~/Projects/<name>, run the coding agent inside a named tmux session, expose the ANA server through a Cloudflare Tunnel (cloudflared systemd service + public hostname), and register everything as systemd units that survive reboots and crashes. Use whenever the user says "VM 만들어", "클라우드 셋팅", "cloudflare 터널 연결", "tmux에서 claude 띄워", "서비스로 등록해", "재부팅해도 살아있게", "azure vm setup", "cloud-setting", "deploy ANA to a server", or wants to move an ANA project from laptop to a server.
---

# cloud-setting — ANA host on a cloud VM

Turns a fresh cloud VM into a running ANA host in one pass. Every step is idempotent and scriptable, so the same skill works for a new project (`prosecution`, `sales`, `lab`, …) by changing `PROJECT`.

```
laptop ──ssh/pem──► VM ┬─ tmux <PROJECT>-ana ── claude (coding agent = backend)
                       ├─ ana-<PROJECT>.service ── node server.js  127.0.0.1:8809
                       └─ cloudflared.service ── tunnel ──► https://<PROJECT>.<domain>
```

## Inputs (ask only what is missing)

| Var | Example | Notes |
|---|---|---|
| `PROJECT` | `prosecution` | folder `~/Projects/<PROJECT>`, tmux `<PROJECT>-ana`, unit `ana-<PROJECT>` |
| `REPO` | `https://github.com/tykimos/agent-native-agent` | what to clone into the project folder |
| `VM_IP`, `VM_USER`, `PEM` | `52.231.69.212`, `azureuser`, `~/ana/connect/demo-vm_key.pem` | SSH target |
| `PORT` | `8809` | ANA server port (bind stays `127.0.0.1`) |
| `CF_TOKEN` | `eyJ…` | Cloudflare Tunnel token (Zero Trust → Tunnels → Install connector). **Treat as a secret: never commit, never echo in logs.** |
| `PUBLIC_HOST` | `prosecution.anahub.io` | public hostname mapped in the Cloudflare dashboard |

Azure-only (when the VM does not exist yet): `RG`, `LOCATION` (`koreacentral`), `VM_NAME`, `SIZE` (`Standard_B2as_v2`), `IMAGE` (`Ubuntu2404`).

## Workflow

### 0. Create the VM (skip if it exists)
`scripts/azure-create-vm.sh` — `az vm create` with Trusted Launch, SSH key, Ubuntu 24.04, **only port 22 open** (the ANA port is never exposed; Cloudflare Tunnel is the only ingress). Prints the public IP and saves the PEM.

### 1. Record connection info
Write `connect/<VM_NAME>.md` (outside the repo, e.g. `~/ana/connect/`) using `templates/connect.md`: IPs, RG, subscription, size, key file, SSH one-liner, and — after setup — the systemd unit names and public URL. Keep the PEM next to it, `chmod 400`.

### 2. Bootstrap the VM
`scripts/setup-vm.sh` run **on the VM** (pipe it through ssh). It:
1. installs `tmux git curl` (apt), Node 22 (NodeSource), Claude Code (`curl -fsSL https://claude.ai/install.sh | bash`) and adds `~/.local/bin` to `PATH`;
2. `mkdir -p ~/Projects/<PROJECT>` and clones `REPO` if absent;
3. creates tmux session `<PROJECT>-ana` (200×50, cwd = repo) running `claude`, unless it already exists.

```bash
ssh -i $PEM $VM_USER@$VM_IP 'bash -s' -- < scripts/setup-vm.sh   # with PROJECT/REPO exported, or pass as args
```

### 3. Log the agent in (human step)
Claude Code needs a browser OAuth. From the tmux pane: pick theme → login method (1 = subscription) → it prints a URL. Drive it remotely with `tmux send-keys`/`capture-pane`, hand the URL to the user, then paste the code back with `tmux send-keys -l "<code>" Enter`. Afterwards press **Shift+Tab** (`tmux send-keys BTab`) to switch to *accept edits* so file edits don't block; read-only Bash prompts can be approved with "don't ask again".

### 4. Cloudflare Tunnel
`scripts/install-cloudflared.sh <CF_TOKEN>` — adds the Cloudflare apt repo, installs `cloudflared`, runs `cloudflared service install <token>` (systemd, auto-start). Then in **Zero Trust → Networks → Tunnels → Public Hostname** map `PUBLIC_HOST` → `http://localhost:<PORT>`. Ingress is remotely managed, so no local config file. Verify from the VM first (`curl https://<PUBLIC_HOST>/api/health`); the laptop may lag on DNS for a few minutes.

### 5. systemd units (reboot/crash safe)
`scripts/install-services.sh <PROJECT> [PORT]` renders `templates/*.service` and enables:
- `<PROJECT>-ana-tmux.service` — oneshot, creates the tmux session with `claude --continue || claude` **only if it does not exist** (never kills a working agent).
- `ana-<PROJECT>.service` — `node server.js` with `TMUX_SESSION=<PROJECT>-ana PORT=<PORT> BIND=127.0.0.1`, `Restart=always`, ordered after the tmux unit.

Why systemd and not tmux for the server: auto-start on boot, restart on crash, `journalctl` logs. The **agent** stays in tmux because ANA's runtime *is* the tmux pane (paste-buffer / capture-pane).

### 6. Verify
```bash
ssh -i $PEM $VM_USER@$VM_IP 'systemctl is-active ana-'$PROJECT' '$PROJECT'-ana-tmux cloudflared; curl -s localhost:'$PORT'/api/health'
```
Expect `session:true`, `ready:true`. Health fields: `busy` (agent thinking), `dialog` (permission prompt waiting — approve via tmux or the dashboard).

## Operating cheatsheet

| Need | Command (on VM) |
|---|---|
| Attach to agent | `tmux attach -t <PROJECT>-ana` |
| Send a prompt remotely | `tmux load-buffer -b p file && tmux paste-buffer -d -b p -t <PROJECT>-ana && tmux send-keys -t <PROJECT>-ana Enter` |
| Server logs / restart | `sudo journalctl -u ana-<PROJECT> -f` / `sudo systemctl restart ana-<PROJECT>` |
| Tunnel logs | `sudo journalctl -u cloudflared -f` |
| Rotate tunnel token | `sudo cloudflared service uninstall && sudo cloudflared service install <new>` |

## Guardrails
- Keep `BIND=127.0.0.1`. The ANA server has no auth; Cloudflare Tunnel (+ optional Cloudflare Access) is the perimeter. Never open the port in the NSG.
- Never paste the tunnel token or PEM into git, chat logs, or the connect note. Reference file paths instead.
- Do not `kill-session` on a tmux pane where the agent is mid-task; the tmux unit is written to be a no-op when the session exists.
- One VM can host several projects: repeat steps 2–5 with a different `PROJECT` and `PORT`, and add another public hostname on the same tunnel.
