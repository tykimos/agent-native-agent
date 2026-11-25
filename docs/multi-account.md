# A different Claude account per tmux session

**English** · [한국어](multi-account.ko.md)

How to use a different Claude account in each ANA session on one computer (or VM) — for example, each teammate using the same ANA with their own account.

The key is the **`CLAUDE_CONFIG_DIR` environment variable**. Claude Code keeps its login, settings and conversation history in that folder, so giving each person their own folder keeps the accounts apart.

| tmux session (example) | Claude config folder | Account |
|---|---|---|
| `<ana>-claude` | `~/.claude` (default) | the default account |
| `<ana>-claude-alice` | `~/.claude-alice` | alice |

`<ana>` is the ANA folder name (e.g. `base-ana`). Session names must follow the ANA rule `<ana>-<anything>` to appear in the session list of ANA's chat.

## From the chat (account button)

The round button to the right of the session name at the top of ANA's chat is the **Claude account of that session** — the first letter of its email. Orange means a non-default account; a dashed ring means it isn't signed in yet.

1. Press it to see the accounts on this computer (`~/.claude` and every `~/.claude-<name>`), with their email and whether they are signed in.
2. Pick one to restart Claude in this session under that account. Or press **+ Sign in with another account**, give it a short name (e.g. `alice`), and ANA creates `~/.claude-alice` (with your `settings.json`, not your login), restarts Claude there, and the chat shows Claude's sign-in to follow.

Behind the button ANA does what the manual steps below do: it sets `CLAUDE_CONFIG_DIR` in the tmux session's environment and respawns the pane with its original command (`--resume <id>` is dropped, because the other account doesn't have that conversation). API: `GET /api/agent-account`, `POST /api/agent-account {target, account, create?}` (`{action:'cancel'}` stops a Codex sign-in).

## Codex sessions

The same button works for a Codex session. Its accounts are `~/.codex` and `~/.codex-<name>` (`CODEX_HOME`; ANA copies your `config.toml`, not `auth.json`). Codex's sign-in opens a browser on the machine it runs on, which doesn't work on a remote ANA — so for an account that isn't signed in, ANA runs `codex login --device-auth` itself and the popover shows **a link and a one-time code**. Open the link on any device (your phone is fine), sign in, enter the code; when it is done, Codex in that session restarts under the new account. *Cancel* stops the sign-in and leaves the session as it was. The conversation, model and limits ANA shows come from that session's `CODEX_HOME`.

## What ANA follows per session

For each tmux session, ANA finds which config folder its Claude process uses. It looks in this order:
1. The process environment (Linux `/proc/<pid>/environ`, macOS `ps eww`).
2. The tmux session environment (`tmux new -e …`).
3. The default `~/.claude`.

It then reads these per session, from that folder:

| What | From |
|---|---|
| The conversation shown in chat | `<folder>/projects/…`, `<folder>/sessions/<pid>.json` |
| 5-hour and weekly usage limits | queried with that account's login |
| Today's tokens, login expiry | `<folder>/projects`, that account's login |
| Security check (login file permissions) | `<folder>/.credentials.json` |

Where the login lives depends on the OS:
- **Linux:** `<folder>/.credentials.json`.
- **macOS:** the keychain, looked up with Claude Code's own naming. The default is `Claude Code-credentials`; with `CLAUDE_CONFIG_DIR` set, it is `Claude Code-credentials-<first 8 hex chars of the folder path's sha256>`.

Tokens never leave the server.

## Add a session with another account

The example adds `alice`.

### 1. Create the config folder

```bash
mkdir -p ~/.claude-alice
# (optional) copy settings — theme, model. Not the login.
cp ~/.claude/settings.json ~/.claude-alice/settings.json
```

> **Do not copy `.credentials.json`** — both sessions would use the same account.

### 2. Start the tmux session with the variable

```bash
cd ~/ana/<ana>
tmux new -d -s <ana>-claude-alice -e CLAUDE_CONFIG_DIR=$HOME/.claude-alice
```

`-e` (tmux 3.0+) sets the variable for that session only.

### 3. Run Claude and sign in

```bash
tmux attach -t <ana>-claude-alice
```

Inside the session:

```bash
echo $CLAUDE_CONFIG_DIR      # → ~/.claude-alice
claude                       # (optional) --remote-control <session name>
```

On first run Claude asks for a theme and how to sign in. Sign in with that person's account (or use `/login`), then leave tmux with `Ctrl-b d`.

### 4. Check in ANA

Open the connection pill at the top of ANA's chat: `…-claude-alice` is in the session list. Pick it to talk with that account. The conversation and the usage limits shown are that account's.

## Checking

```bash
# which config folder each session's claude uses
for s in $(tmux ls -F '#{session_name}' | grep '^<ana>-'); do
  dir=$(tmux show-environment -t "$s" CLAUDE_CONFIG_DIR 2>/dev/null)
  echo "$s → ${dir:-default (~/.claude)}"
done
```

Inside Claude, `/status` shows the signed-in account's email.

## Notes

- **A session started without the variable uses the default account.** Keep `-e CLAUDE_CONFIG_DIR=...` when you recreate a session. After a reboot, start again from step 2. The login stays in the folder, so you don't sign in again.
- **To give an existing session another account,** quit claude inside it, `export CLAUDE_CONFIG_DIR=$HOME/.claude-alice`, and run `claude` again. ANA looks at the process environment first, so it notices.
- **Sharing one OS user means the folders can read each other.** For full separation, use separate OS users.
