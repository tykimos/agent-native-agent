#!/usr/bin/env bash
# Run ON the VM. Installs cloudflared from Cloudflare's apt repo and registers the tunnel as a systemd service.
# Usage: bash install-cloudflared.sh <TUNNEL_TOKEN>     (token from Zero Trust → Tunnels → Install connector; keep it secret)
set -euo pipefail
TOKEN=${1:?tunnel token}
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
sudo apt-get update -qq && sudo apt-get install -y -qq cloudflared >/dev/null
if systemctl is-enabled cloudflared >/dev/null 2>&1; then sudo cloudflared service uninstall || true; fi
sudo cloudflared service install "$TOKEN"
sleep 4; systemctl is-active cloudflared
sudo journalctl -u cloudflared --no-pager -n 5 | grep -i "registered tunnel" || true
echo "Now map the public hostname → http://localhost:<PORT> in Zero Trust → Tunnels → Public Hostname"
