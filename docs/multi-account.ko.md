# tmux 세션마다 다른 Claude 계정 쓰기

[English](multi-account.md) · **한국어**

한 컴퓨터(또는 VM)에서 ANA 세션마다 다른 Claude 계정을 쓰는 방법입니다. 예를 들어 팀원마다 자기 계정으로 같은 ANA를 씁니다.

핵심은 **`CLAUDE_CONFIG_DIR` 환경 변수**입니다. Claude Code는 로그인 정보, 설정, 대화 기록을 이 폴더에 저장하므로, 사람마다 폴더를 따로 주면 계정이 분리됩니다.

| tmux 세션(예) | Claude 설정 폴더 | 계정 |
|---|---|---|
| `<ana>-claude` | `~/.claude`(기본값) | 기본 계정 |
| `<ana>-claude-alice` | `~/.claude-alice` | alice |

`<ana>`는 ANA 폴더 이름입니다(예: `base-ana`). 세션 이름은 ANA 규칙인 `<ana>-<아무거나>`를 따라야 ANA 채팅의 세션 선택 목록에 나옵니다.

## ANA가 세션마다 따라가는 것

ANA는 각 tmux 세션의 Claude 프로세스가 어떤 설정 폴더를 쓰는지 스스로 찾습니다. 찾는 순서는 이렇습니다.
1. 프로세스 환경 변수(Linux `/proc/<pid>/environ`, macOS `ps eww`)
2. tmux 세션 환경 변수(`tmux new -e …`)
3. 기본값 `~/.claude`

그 폴더를 기준으로 아래를 세션마다 따로 읽습니다.

| 무엇 | 어디서 |
|---|---|
| 채팅에 보이는 대화 기록 | `<폴더>/projects/…`, `<폴더>/sessions/<pid>.json` |
| 5시간·주간 사용량 한도 | 그 계정의 로그인으로 조회 |
| 오늘 토큰 사용량, 로그인 만료 | `<폴더>/projects`, 그 계정의 로그인 |
| 보안 점검(로그인 파일 권한) | `<폴더>/.credentials.json` |

로그인 정보의 위치는 운영체제마다 다릅니다.
- **Linux:** `<폴더>/.credentials.json`
- **macOS:** 키체인입니다. Claude Code와 같은 규칙으로 찾습니다. 기본은 `Claude Code-credentials`이고, `CLAUDE_CONFIG_DIR`이 있으면 `Claude Code-credentials-<폴더 경로의 sha256 앞 8자>`입니다.

토큰은 서버 밖으로 나가지 않습니다.

## 새 계정 세션 추가하기

아래 예시는 `alice`를 추가합니다.

### 1. 설정 폴더 만들기

```bash
mkdir -p ~/.claude-alice
# (선택) 기존 설정 복사 — 테마·모델 등. 로그인 정보는 복사하지 않습니다.
cp ~/.claude/settings.json ~/.claude-alice/settings.json
```

> `.credentials.json`은 **복사하지 마세요.** 복사하면 두 세션이 같은 계정을 씁니다.

### 2. 환경 변수를 넣어 tmux 세션 시작

```bash
cd ~/ana/<ana>
tmux new -d -s <ana>-claude-alice -e CLAUDE_CONFIG_DIR=$HOME/.claude-alice
```

`-e`(tmux 3.0 이상)는 그 세션에만 환경 변수를 넣습니다. 다른 세션에는 영향이 없습니다.

### 3. Claude 실행 후 로그인

```bash
tmux attach -t <ana>-claude-alice
```

세션 안에서:

```bash
echo $CLAUDE_CONFIG_DIR      # → ~/.claude-alice 인지 확인
claude                       # (선택) --remote-control <세션 이름>
```

처음 실행하면 테마와 로그인 방식을 묻습니다. 그 사람의 계정으로 로그인한 뒤(`/login`으로도 가능) `Ctrl-b d`로 tmux에서 빠져나옵니다.

### 4. ANA에서 확인

ANA 채팅 위의 연결 표시를 누르면 세션 목록에 `…-claude-alice`가 나옵니다. 고르면 그 계정으로 대화합니다. 대화 기록과 사용량 한도도 그 계정의 것이 보입니다.

## 확인 방법

```bash
# 각 세션의 claude가 어떤 설정 폴더를 쓰는지
for s in $(tmux ls -F '#{session_name}' | grep '^<ana>-'); do
  pid=$(tmux list-panes -t "$s" -F '#{pane_pid}')
  dir=$(tmux show-environment -t "$s" CLAUDE_CONFIG_DIR 2>/dev/null)
  echo "$s → ${dir:-기본값(~/.claude)}"
done
```

Claude 안에서 `/status`를 입력하면 로그인한 계정 이메일도 볼 수 있습니다.

## 주의 사항

- **환경 변수 없이 시작하면 기본 계정을 씁니다.** 세션을 다시 만들 때도 `-e CLAUDE_CONFIG_DIR=...`를 꼭 넣으세요. tmux가 재시작되면(재부팅 등) 2단계부터 다시 하면 됩니다. 로그인은 폴더에 남아 있어 다시 하지 않아도 됩니다.
- **이미 있는 세션에 나중에 계정을 붙이려면** 세션 안에서 claude를 끈 뒤 `export CLAUDE_CONFIG_DIR=$HOME/.claude-alice`를 하고 다시 `claude`를 실행합니다. ANA는 프로세스 환경 변수를 먼저 보므로 이 경우도 알아봅니다.
- **같은 OS 사용자를 함께 쓰면** 폴더끼리 서로 읽을 수 있습니다. 계정 정보를 완전히 분리하려면 OS 사용자를 따로 만들어야 합니다.
- **이전에 로컬 패치를 썼다면 지워도 됩니다.** 사용량 한도를 세션별로 보이게 하려고 `dashboard-api.js`에 넣었던 `claudeConfigDirOf` 같은 로컬 패치는 0.14.0부터 필요 없습니다. 업데이트하면서 지워도 됩니다.
