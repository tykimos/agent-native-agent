# Start ANA in your browser without local installation


[한국어](codespaces.ko.md) · **English**

Run ANA and Claude Code inside GitHub Codespaces. Your computer needs only a browser: no local WSL, Node, tmux or Claude Code installation. Bring a GitHub account and an account with Claude Code access. You will sign in to Claude once inside the codespace; your computer's login is not copied.

## Create your environment

In this repository, choose **Code → Codespaces → Create codespace**. A 2-core machine is sufficient for this configuration. Wait for container creation and the setup commands to finish. Node, tmux, Claude Code and ANA dependencies are installed, then the server and Claude terminal start automatically.

GitHub may show a development-port notice. Check that the address belongs to your codespace and select **Continue**.

## Complete Claude setup in ANA — once

1. Under **Ports**, find **ANA / 8809** and click the globe icon (**Open in Browser**). Keep visibility **Private**. The address is `https://<codespace-name>-8809.app.github.dev`.
2. In ANA chat, choose a terminal theme and your account's login method from the setup card.
3. Click **Open Claude login**. Complete sign-in and consent on Claude's official page in the new tab.
4. If Claude displays an authentication code, return to ANA, paste it into the dedicated **Paste login code** field, and click **Complete login**. Never send codes as ordinary chat messages or GitHub issues.
5. Read the login confirmation and **Security notes**, then click **Continue**. The numbered safety notes are explanatory text, not choices.
6. Check the workspace path. Choose **Yes, I trust this folder** only if you trust the repository; the initial selection is **No, exit**. If **Try the new fullscreen renderer?** appears, select **Not now**. ANA was tested with the existing terminal renderer.

Users complete authentication themselves. Subscription login does not require creating an API key. Organization policies may restrict login methods.

Normal onboarding does not require terminal commands. Expand **Terminal view & keys** to inspect a prompt. If an unsupported CLI screen blocks setup, open a new terminal in the editor and attach to the running Claude process:

```bash
bash .devcontainer/connect.sh
```

To detach afterwards, press **Ctrl+B**, release both keys, then press **D**. Claude keeps running.

## Start chatting

When setup finishes, the card disappears and the ordinary chat input becomes available. Send `Hello` and check for a response. Use the ANA address while the codespace is running.

## Return later

Open the **existing** environment from [your codespaces](https://github.com/codespaces), instead of creating another one. ANA and the Claude process start automatically on container start. If Claude requests login or onboarding again, use the setup card in ANA.

If the codespace is running but ANA is unavailable, run:

```bash
bash .devcontainer/start.sh
```

Then reopen port 8809.

## Keep it awake longer

A codespace stops after **30 minutes** without activity by default, and ANA's connection drops with it. Activity means typing in VS Code or its terminal; ANA's server and agent running inside do not count, and using ANA in the browser may not either. You can raise this to at most **240 minutes (4 hours)**:

- **For every new codespace** — GitHub → **Settings → Codespaces → Default idle timeout**, enter e.g. `180` and save. It applies only to codespaces created **after** the change, so create a new one (an existing codespace keeps its old value).
- **For one codespace** — create it from the command line:

  ```bash
  gh codespace create -R tykimos/agent-native-agent --idle-timeout 3h
  ```

  The **Create codespace** button on the web cannot set this.

`devcontainer.json` cannot change it, and an organization's policy can cap it lower. The whole running time is billed, idle or not.

## Data and costs

- ANA state lives in the repository's ignored `.ana/` directory. Claude credentials and history live outside the checkout in `/workspaces/.ana-private/`. Do not commit credentials or private conversations.
- `/workspaces` persists across stop/start and container rebuilds. **Deleting a codespace deletes unbacked-up data.** Committing source code does not back up private application data.
- Idle codespaces stop automatically, stopping ANA and its agent too (see [Keep it awake longer](#keep-it-awake-longer)). This configuration is not an always-on server.
- Codespaces compute and storage are billed separately from Claude. GitHub plans include different usage allowances; storage can remain billable while stopped.
- The agent operates on files in the cloud environment. Your local computer's files are not automatically available.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Recovery mode | Container creation failed. Read the creation log; installation has not completed. |
| Claude login/onboarding screen | Complete the setup card. If it looks wrong, reload and inspect Terminal view & keys or attach with the command above. |
| Agent input line is not ready | Check the Claude terminal for login, trust or selection prompts. |
| ANA URL is unavailable | Check that the codespace is running and port 8809 is forwarded. Your computer's `localhost:8809` is not this server. |
| Another account cannot open ANA | Private ports require access to the codespace. Check the signed-in GitHub account. |

References: [GitHub port forwarding](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace), [persistence across rebuilds](https://docs.github.com/en/codespaces/developing-in-a-codespace/rebuilding-the-container-in-a-codespace), [Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces), [Claude authentication](https://code.claude.com/docs/en/authentication).
