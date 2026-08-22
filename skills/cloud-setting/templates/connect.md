# {{VM_NAME}} ({{CLOUD}} Virtual Machine)

## 접속 정보
| 항목 | 값 |
|---|---|
| Public IP | {{PUBLIC_IP}} |
| Private IP | {{PRIVATE_IP}} |
| OS | {{OS}} |
| SSH Key | `{{VM_NAME}}_key.pem` (이 폴더, chmod 400) |

```bash
ssh -i {{VM_NAME}}_key.pem {{ADMIN}}@{{PUBLIC_IP}}
```

## 클라우드 리소스
| 항목 | 값 |
|---|---|
| Resource group | {{RG}} |
| Location | {{LOCATION}} |
| Subscription / ID | {{SUBSCRIPTION}} / {{SUBSCRIPTION_ID}} |
| Size | {{SIZE}} |
| Time created | {{CREATED}} |

## 설치된 구성 ({{DATE}})
- Claude Code, Node 22, tmux, git
- `~/Projects/{{PROJECT}}/<repo>` — tmux 세션 `{{PROJECT}}-ana` (claude)
- systemd: `ana-{{PROJECT}}.service` (node server.js, 127.0.0.1:{{PORT}}), `{{PROJECT}}-ana-tmux.service`
- cloudflared `cloudflared.service` — 터널 ID `{{TUNNEL_ID}}`, 공개 URL https://{{PUBLIC_HOST}}/
- 운영: `sudo journalctl -u ana-{{PROJECT}} -f`, `sudo systemctl restart ana-{{PROJECT}}`, `tmux attach -t {{PROJECT}}-ana`
