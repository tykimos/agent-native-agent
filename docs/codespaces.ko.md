# 설치 없이 브라우저에서 ANA 시작하기


**한국어** · [English](codespaces.md)

GitHub Codespaces 안에서 ANA와 Claude Code를 실행합니다. PC에 WSL, Node, tmux, Claude Code를 설치할 필요가 없습니다. 준비물은 **GitHub 계정**, **Claude Code를 사용할 수 있는 계정**, **웹 브라우저**입니다. PC에서 사용하던 Claude 로그인은 자동으로 옮겨지지 않으므로 최초 한 번 로그인합니다.

## 1. Codespace 만들기

저장소의 **Code → Codespaces → Create codespace**를 선택합니다. 기본 2코어 환경으로 실행할 수 있습니다. 처음에는 컨테이너 생성과 설치에 시간이 걸립니다. 아래쪽 터미널에서 설치 중이라면 완료될 때까지 기다립니다.

환경이 준비되면 Node, tmux, Claude Code, ANA 의존성이 설치되고 ANA 서버와 Claude 터미널이 자동으로 시작됩니다. GitHub의 개발 포트 안내 화면이 뜨면 자신의 Codespace 주소인지 확인하고 **Continue**를 누릅니다.

## 2. ANA에서 Claude 초기 설정하기 — 최초 한 번

1. 편집기 아래 **Ports**에서 **ANA / 8809** 행의 지구본 아이콘(**Open in Browser**)을 누릅니다. 포트 공개 범위는 **Private**으로 유지합니다. 주소는 `https://<codespace 이름>-8809.app.github.dev` 형태입니다.
2. ANA 채팅에 표시되는 초기 설정 카드에서 터미널 테마와 사용하는 계정 유형을 선택합니다.
3. **Open Claude login**을 누릅니다. 새 탭의 Claude 공식 페이지에서 로그인과 동의를 완료합니다.
4. 인증 코드가 표시되면 ANA로 돌아와 **Paste login code** 전용 입력창에 붙여 넣고 **Complete login**을 누릅니다. 일반 채팅이나 GitHub 이슈에 인증 코드를 보내지 않습니다.
5. 로그인 완료 카드와 **Security notes** 안내문을 확인하고 **Continue**를 누릅니다. 안내문의 1·2번은 선택지가 아닙니다.
6. 작업 폴더 경로를 확인한 뒤, 신뢰하는 저장소라면 **Yes, I trust this folder**를 선택합니다. 기본 선택은 **No, exit**입니다. **Try the new fullscreen renderer?**가 나타나면 **Not now**를 선택합니다. ANA는 기존 터미널 렌더러로 검증했습니다.

로그인은 사용자가 직접 완료합니다. Claude 구독으로 로그인할 때 별도 API 키를 만들 필요는 없습니다. 조직 정책에 따라 가능한 인증 방식은 달라질 수 있습니다.

일반적인 초기 설정에는 터미널 명령이 필요하지 않습니다. 화면을 확인해야 한다면 카드 아래 **Terminal view & keys**를 펼칠 수 있습니다. 지원되지 않는 CLI 화면에서 멈추면 편집기의 새 터미널에서 다음 명령으로 실행 중인 Claude에 연결합니다.

```bash
bash .devcontainer/connect.sh
```

터미널 연결을 마치면 **Ctrl+B를 누르고 손을 뗀 뒤 D**로 분리합니다. Claude는 계속 실행됩니다.

## 3. 대화 시작하기

초기 설정이 끝나면 안내 카드가 사라지고 일반 채팅 입력창이 활성화됩니다. `안녕`을 보내 응답을 확인합니다. 이후에는 ANA 주소를 브라우저에서 열어 사용합니다. Codespace가 실행 중이어야 접속됩니다.

## 다음에 다시 사용하기

[내 Codespaces](https://github.com/codespaces)에서 **기존 환경**을 다시 엽니다. 매번 새 환경을 만들지 않습니다. 재시작하면 ANA와 Claude 프로세스를 자동으로 다시 시작합니다.

로그인 화면이 다시 나오면 ANA의 초기 설정 카드에서 진행합니다. 환경이 실행 중인데 ANA가 열리지 않으면 다음을 실행한 뒤 Ports의 8809를 다시 엽니다.

```bash
bash .devcontainer/start.sh
```

## 잠자기 시간 늘리기

Codespace는 기본으로 **30분** 동안 활동이 없으면 멈추고, ANA 연결도 함께 끊깁니다. 여기서 활동은 VS Code나 그 터미널에 입력하는 것입니다. 안에서 돌고 있는 ANA 서버·에이전트는 활동으로 치지 않고, 브라우저로 ANA를 쓰는 것도 활동으로 치지 않을 수 있습니다. 이 시간은 최대 **240분(4시간)**까지 늘릴 수 있습니다.

- **새로 만드는 모든 Codespace** — GitHub → **Settings → Codespaces → Default idle timeout**에 예를 들어 `180`을 넣고 저장합니다. 바꾼 **뒤에 만드는** Codespace에만 적용되므로 새로 하나 만듭니다(기존 Codespace는 예전 값 그대로입니다).
- **Codespace 하나만** — 명령줄에서 만듭니다.

  ```bash
  gh codespace create -R tykimos/agent-native-agent --idle-timeout 3h
  ```

  웹의 **Create codespace** 버튼으로는 이 값을 정할 수 없습니다.

`devcontainer.json`으로는 바꿀 수 없고, 조직 계정이면 조직 정책이 더 짧게 막아 둘 수 있습니다. 유휴 상태여도 켜져 있는 시간 전체가 과금됩니다.

## 데이터와 비용

- ANA의 메모·작업·원장은 저장소의 `.ana/`에 저장됩니다. Claude 로그인과 세션 기록은 Git 저장소 밖의 `/workspaces/.ana-private/`에 보관합니다. 로그인 정보와 개인 대화는 GitHub에 커밋하지 않습니다.
- `/workspaces`는 Codespace 중지·재시작 및 컨테이너 재빌드에도 유지되는 위치입니다. **Codespace를 삭제하면 미백업 데이터도 삭제됩니다.** 코드 백업과 개인 데이터 백업은 별개입니다.
- 일정 시간 사용하지 않으면 Codespace가 자동 중지되고 ANA와 에이전트도 멈춥니다([잠자기 시간 늘리기](#잠자기-시간-늘리기) 참고). 상시 실행 서버로 제공하는 구성은 아닙니다.
- Claude 이용료와 Codespaces 이용료는 별개입니다. GitHub 계정의 포함 사용량을 넘으면 컴퓨팅·저장소 비용이 발생할 수 있습니다. 중지된 Codespace도 저장소를 차지합니다.
- 에이전트가 다루는 파일은 클라우드 환경 안의 파일입니다. 사용자 PC 파일이 자동으로 연결되지는 않습니다.

## 문제가 생겼을 때

| 증상 | 확인할 곳 |
|---|---|
| `Recovery mode`가 표시됨 | 컨테이너 생성 실패입니다. 생성 로그를 확인합니다. 정상 설치 완료로 간주하지 않습니다. |
| Claude가 로그인/초기 안내에서 멈춤 | ANA의 설정 카드를 완료합니다. 화면이 잘못 표시되면 새로고침하고, Terminal view & keys 또는 연결 명령으로 실제 화면을 확인합니다. |
| 채팅이 `Agent input line is not ready`로 실패 | Claude 터미널에 로그인·폴더 신뢰·선택 창이 남아 있는지 확인합니다. |
| ANA 주소가 열리지 않음 | Codespace 실행 상태와 Ports의 8809를 확인합니다. 로컬 PC의 `localhost:8809` 주소가 아닙니다. |
| 다른 계정에서 접속 불가 | Private 포트는 해당 Codespace 접근 권한이 필요합니다. 본인의 GitHub 계정을 확인합니다. |

참고: [GitHub 포트 전달](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace), [재빌드와 데이터 유지](https://docs.github.com/en/codespaces/developing-in-a-codespace/rebuilding-the-container-in-a-codespace), [Codespaces 비용](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces), [Claude 로그인](https://code.claude.com/docs/en/authentication).
