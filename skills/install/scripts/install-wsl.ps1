# ANA on Windows — tmux는 Windows에서 네이티브로 돌지 않으므로 WSL(Ubuntu) 안에 설치한다.
# PowerShell에서 실행:  powershell -ExecutionPolicy Bypass -File skills\install\scripts\install-wsl.ps1
#   1) WSL이 없으면 설치(관리자 권한 필요) → 재부팅 후 다시 실행하라고 안내
#   2) WSL이 있으면 배포판(기본 Ubuntu) 안에서 git 설치 → 저장소 clone(~/ana/agent-native-agent) → install.sh 실행
param(
  [string]$Distro = "Ubuntu",
  [string]$Repo = "https://github.com/tykimos/agent-native-agent",
  [string]$Dir = "~/ana/agent-native-agent"
)
$ErrorActionPreference = "Stop"
function Say($m) { Write-Host "[ana-install] $m" -ForegroundColor Cyan }

$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
$distros = @()
if ($wsl) { $distros = (wsl.exe -l -q 2>$null) -replace "`0", "" | Where-Object { $_.Trim() } | ForEach-Object { $_.Trim() } }

if (-not $wsl -or -not ($distros -contains $Distro)) {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $admin) {
    Write-Host "WSL/$Distro is not installed. Re-run this script in PowerShell opened as Administrator." -ForegroundColor Yellow
    exit 1
  }
  Say "Installing WSL with $Distro (this can take a few minutes)…"
  wsl.exe --install -d $Distro
  Write-Host ""
  Write-Host "Reboot Windows if asked, open '$Distro' once from the Start menu to create your Linux user," -ForegroundColor Yellow
  Write-Host "then run this script again (no Administrator needed the second time)." -ForegroundColor Yellow
  exit 0
}

Say "WSL distro '$Distro' found — installing ANA inside it"
$bash = @"
set -e
command -v git >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq git curl; }
D=$Dir; D=`${D/#\~/`$HOME}
[ -f "`$D/server.js" ] || { mkdir -p "`$(dirname "`$D")"; git clone -q $Repo "`$D"; }
bash "`$D/skills/install/scripts/install.sh"
bash "`$D/skills/install/scripts/run.sh" start
"@
$bash = $bash -replace "`r", ""   # CRLF로 체크아웃돼도 bash가 깨지지 않게
wsl.exe -d $Distro -- bash -lc $bash
Say "Open http://localhost:8809 (or the port printed above) in your Windows browser."
Say "Agent login: wsl -d $Distro -- tmux attach -t ana   (detach with Ctrl-b d)"
