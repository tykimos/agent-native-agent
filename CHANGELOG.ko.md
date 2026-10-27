# 변경 기록

ANA의 주요 변경 사항입니다. 버전은 `.claude-plugin/plugin.json`의 Claude Code 플러그인 버전을 따릅니다.
[English](CHANGELOG.md) · **한국어**

이미 쓰고 있는 ANA에 이 변경을 반영하려면 [`ana-update`](skills/ana-update/SKILL.md) 스킬을 쓰세요. 그 ANA를 이 저장소와 기능 단위로 비교하고, 고른 것만 이식합니다.

## [0.12.0] — 2026-10-27

### Changed

- **도메인 = 업무 + 지식.** 정의 문구를 바꿨습니다.
  - **워크 층:** *업무 프로세스가 돌아가는 데 필요한 것*. 업무가 다루는 항목과 그 흐름이고, 설계된 것이라 정확해야 합니다(관문).
  - **지식 층:** *업무를 하면서 쌓이는 것*. 생겨나는 것이라 열려 있어야 합니다(렌즈).
  - 문서 첫머리가 이 관점으로 시작하고, 온톨로지 화면, 분석 지시문, README도 같은 말을 씁니다.

- **진화 제안이 갇히지 않습니다.** 두 진화 지시문 모두 업무*와* 지식을 읽고, 그 도메인에서 다른 곳은 어떻게 일하는지 웹에서 찾아본 뒤, 세 가지 거리로 제안합니다. 거리마다 적어도 하나씩입니다.
  - **정리**(tidy): 지금 어긋난 것을 바로잡기
  - **개선**(improve): 업무 프로세스를 더 낫게
  - **재구상**(reimagine): 쌓인 지식이 시사하는 새로운 일하는 방식
  - 워크스페이스 진화의 "있는 기능만" 제한을 풀었고, 큰 아이디어는 시스템 제안이 됩니다.
  - 제안에 `horizon`, `because`(여기서 본 근거), `sources`(밖의 사례, http(s) 링크만, 지어내지 않음)가 붙습니다. 카드에 거리 표시, *Because*, *Seen elsewhere*로 보이고, 시작할 때 에이전트에게 함께 넘어가며, 시스템으로 올릴 때도 유지됩니다.

## [0.11.0] — 2026-10-27

### Changed

- **이름을 개념에 맞췄습니다.** 파일, 코드, 문서가 모델과 같은 말을 씁니다.

| 개념 | 전 | 지금 |
|---|---|---|
| 워크 온톨로지 | `work-schema.js` | `work-ontology.js` |
| 지식 온톨로지 | `.ana/ontology.json` | `.ana/knowledge-ontology.json` |
| 워크 그래프 | `state.json` | `work-graph.json` |
| 지식그래프 | `kg.json` | `knowledge-graph.json` |
| NodeRel 색인 | `graph.js`, `graph.sqlite` | `graph-index.js`, `graph-index.sqlite` |
| Graph 메뉴 | `relationsView` + `linksView` | `graphView`(`work` · `knowledge`) |
| Work graph drawing | `renderRelations`, `drawRelGraph` | `renderWorkGraph`, `drawWorkGraph` |
| 문서, 스킬 | `docs/relations.md`, `skills/relations` | `docs/work-and-knowledge.md`, `skills/work-and-knowledge` |
| 기능 id | `relations`, `relations-analysis`, `system-ontology` | `work-graph`, `knowledge-analysis`, `ontology` |

- **메뉴가 모델을 따릅니다: 범위 = 메뉴, 층 = 탭.**
  - **워크스페이스 › Graph**에 *Work · Knowledge* 탭이 있습니다. 워크 그래프(예전 Work › Links)와, *Analyze*가 있는 지식그래프(예전 Knowledge 메뉴)입니다.
  - **Work**는 다시 Tasks · Calendar · Notes입니다.
  - **System › Ontology**에 *Work · Knowledge* 탭이 있고, 탭마다 *Classes · Relations · Rules* 전환이 있습니다. *+ Add*는 Knowledge 탭에만 있습니다.
  - Graph 각 탭의 *Ontology*는 그 층의 온톨로지를 엽니다(관리자: System › Ontology, 실무자: 읽기 전용). 워크 클래스 아래의 지식 클래스는 *kind of Task*로 보입니다.
- **기존 데이터는 저절로 옮겨집니다.**
  - 서버가 시작할 때 모든 워크스페이스의 옛 이름 파일을 새 이름으로 바꾸고, 사본을 `<옛 이름>.pre-0.11`로 남깁니다.
  - 옛 `graph.sqlite`는 캐시라 지우고 다시 만듭니다.
  - 직접 지정한 `DATA_FILE`·`ONTOLOGY_FILE`은 그대로 씁니다.
  - 기억해 둔 탭 `relations`, `knowledge`, `links`는 Graph로 열립니다.
- **API 경로는 그대로입니다**(`/api/state`, `/api/kg`, `/api/graph`, `/api/ontology`). 에이전트와 다른 ANA가 쓰는 약속이기 때문입니다.
- **ana-update가 옛 이름을 압니다.** `features.json`의 앵커와 복사 모듈에 대안을 적을 수 있고(`graph-index.js || graph.js`), 기능은 옛 id를 `formerly`에 남깁니다. 그래서 옛 이름을 쓰는 ANA도 기능이 없다고 나오지 않습니다.

## [0.10.0] — 2026-10-27

**워크와 지식.** ANA를 두 층으로 설명하고, 저장하고, 보여 줍니다. 층마다 온톨로지(종류)와 그래프(실제 것)가 짝입니다. [docs/relations.ko.md](docs/work-and-knowledge.ko.md)를 보세요.

| | 워크 층 | 지식 층 |
|---|---|---|
| 실제 것 | 워크 항목(메모·할일·일정)과 그 사이의 연결 | 워크에서 알아낸 개체와 사실 |
| 온톨로지(System) — 클래스, 관계, 규칙 | **워크 온톨로지**: `work-schema.js`, 코드에서 | **지식 온톨로지**: `.ana/ontology.json`, 관리자 |
| 그래프(워크스페이스마다) | **워크 그래프**: `state.json` | **지식그래프**: `kg.json` |
| 앱에서 | **Work**: Tasks · Calendar · Notes · **Links** | **Knowledge**: 한 페이지 |

### Changed

- **"built-in" 핵심이 없어집니다.** 앱이 저장하는 것은 **워크 온톨로지**이고, ANA마다 `work-schema.js`(새 파일)에 선언합니다. 모든 ANA 공통인 것은 없습니다. 할일이 없는 ANA에는 Task가 없습니다.
  - `graph.js`와 *Links by kind* 표가 이 선언을 읽습니다. 앱이 실제로 만드는 노드·연결 종류가 선언과 정확히 같은지 테스트로 확인합니다.
  - System › Ontology에서 워크 온톨로지는 **Work** 표시(읽기 전용)가 붙고, 두 층을 설명합니다. 연결은 잇는 클래스를 모두 보여 줍니다(Note · Task · Event).
  - API: `core` 대신 `source: "work" | "knowledge"`
- **화면이 층을 따릅니다.**
  - 워크 그래프(예전 Knowledge › Links)는 **Work › Links**로 옮겼습니다.
  - **Knowledge**는 한 페이지입니다. 지식그래프가 있고, 툴바에 *Analyze*가 있고, 최근 분석이 있습니다(진행 중이거나 승인을 기다리면 그래프 위, 아니면 아래). *Analysis*와 *Ontology* 하위 탭은 없앴습니다.
  - 온톨로지 페이지는 System › Ontology 하나입니다. *Knowledge › Ontology*를 누르면 관리자는 그리로 가고, 실무자는 같은 내용을 읽기 전용 팝업으로 봅니다.
- **워크 연결도 렌즈입니다.** `BLOCKS`(대문자_밑줄) 같은 새 연결 종류도 저장하고 *(new)* / *아직 워크 온톨로지에 없음*으로 보입니다. 그림, 항목 칩, *Links by kind* 모두에 보입니다. 아는 종류는 From → To를 지킵니다(앱 기능이 읽음). DUE_ON, ON은 손으로 못 만듭니다.
- **Inbox: *Work requests* → *Action requests*(실행 요청).** "Work"는 워크 층만 뜻하게 했습니다.
- **끊긴 참조를 숨기지 않습니다.** 종류가 사라졌는데(기능을 빼거나 개념을 지움) 다른 것이 아직 가리키면, `GET /api/ontology`가 `issues`를 돌려줍니다. System › Ontology가 목록을 보여 주고, 그 클래스를 *parent … missing* 표시와 함께 트리에 남깁니다.
- 제거: 0.8.0 이전의 워크스페이스별 분석 온톨로지를 합치는 코드, `pending`으로 붙잡아 두던 사실

### Added

- **규칙: 온톨로지의 세 번째 부분**(System › Ontology › *Rules*). 이제 온톨로지는 **클래스 + 관계 + 규칙**입니다.
  - **연쇄 규칙:** *만약* 관계 1~3개로 이어진 길이 있으면 *그러면* 관계 하나. 예: x attends y, y part_of z ⇒ x involved_in z. 단계를 거꾸로 걸을 수 있고(`^attends`: 같은 워크숍 참석자 ⇒ meets), 한 단계면 하위 관계가 됩니다.
  - **제한 규칙:** From(또는 To) 하나에 그 관계는 최대 N개. 넘는 사실은 남기고 *규칙 위반*으로 표시합니다.
  - 역관계·대칭·전이(관계에 표시)와 연쇄를 한 엔진에서 고정점까지 돌려, 규칙이 서로의 결과 위에서 이어집니다. 추론된 사실에는 `rule`, `ruleLabel`, `because`가 붙습니다. 워크 온톨로지의 계산 규칙(DUE_ON ← Task.due, ON ← Event.date)은 읽기 전용으로 보입니다.
  - OWL로 내보냅니다: `rdfs:subPropertyOf`, `owl:propertyChainAxiom`, `owl:Restriction` + `owl:maxCardinality`. 규칙이 쓰는 관계는 지울 수 없고, 지워진 것을 가리키는 규칙은 `issues`에 나옵니다.
  - API: `POST /api/ontology {kind: "rule"}`. [Analyze] 지시문에 규칙이 사실을 스스로 끌어낸다고 적었습니다.
- **워크 항목의 하위 클래스.** 지식 클래스가 워크 클래스의 하위 클래스(Ticket ⊂ Task, Meeting ⊂ Event)이면 워크 항목에 붙일 수 있습니다(`POST /api/subtype`).
  - 제목 옆 알약은 그런 하위 클래스가 있을 때만 보입니다.
  - 앱은 그대로 할일로 다루고, 지식 쪽은 Ticket으로 읽습니다.
- **승격 근거:** `GET /api/ontology/evidence`
  - 쓰이는 새 연결 종류, 항목에 붙은 하위 클래스, 개체가 주로 한 종류의 항목에서 나오는 지식 클래스를 보여 줍니다.
  - 시스템 [Evolve] 지시문이 이를 가리켜, 쓰임과 지식이 기능으로 올라갈 수 있습니다. 워크 온톨로지를 바꾸는 기능은 같은 변경에서 `work-schema.js`도 고칩니다.
- **System › Inbox의 모든 탭에 *Ask the agent*.** Evolve뿐 아니라 Approvals와 Action requests에도 생겼습니다. 에이전트는 점검, 업데이트, 온톨로지, 사용 기록, 워크스페이스, 열린 관리자 항목을 읽고, 관리자에게 필요한 것을 등록합니다(`/api/admin/requests`).
- **팝업 위에 그리기.** Chip을 켜면 팝업이 떠 있어도 펜을 쓸 수 있습니다. 캡처는 팝업이고, 칩에는 팝업 이름과 표시 아래의 입력창·버튼이 적힙니다. Chip을 켜도 열린 팝업이 닫히지 않습니다.
- **온톨로지 행에 그리기:** `Relation "SCHEDULED_AS (Task → Event)"` 같은 칩이 됩니다. 그린 표시도 대상마다 정한 칩 글을 씁니다.

### Fixed

- **로그인이 풀린 뒤 "Not connected"로 굳던 것.** 로그인 게이트웨이 뒤에서 로그인이 만료되면 API가 `401 {"error":"Sign-in required"}`를 돌려줍니다. 페이지가 이것을 에이전트 상태로 읽어서, 직접 새로고침할 때까지 *Not connected*로 굳어 있었습니다.
  - 이제 **Signed out — tap to sign in**으로 보입니다.
  - 쓰던 글이나 올리는 파일이 없으면 한 번 스스로 새로고침해 다시 인증합니다(1분에 한 번까지).
  - 서버에 닿지 못할 때는 5초가 아니라 2초마다 다시 확인합니다.
- **분석 카드를 워크·지식 말로.**
  - 요약은 "read 2 notes · 5 tasks → found 17 entities · 26 facts · 2 new classes · 1 new relation"처럼 보입니다.
  - 주 버튼은 *Add to the knowledge graph*이고, 보기는 *Entities & facts · Classes & relations*입니다.
  - 내보내기는 카드에서 빼고 지식그래프 도구 줄 한 곳에만 둡니다.
  - 분석 팝업 이름은 *Analyze your work*입니다.
- 팝업의 여러 줄 입력창과 *Send* 버튼에 스타일이 없었습니다.
- 휴대폰 툴바에서 버튼이 화면 밖으로 밀리지 않습니다(짧은 이름, 줄임표, 작은 Open/Done 알약).
- 부모가 사라진 클래스가 온톨로지 트리와 분석 결과 트리에서 사라지던 것을 고쳤습니다. 이제 맨 위에 표시와 함께 남습니다.
- 남아 있던 "Collaborate" 문구, Tests 명령의 가로 밀림, /favicon.ico 404를 고쳤습니다.

## [0.9.0] — 2026-10-25

온톨로지가 **관문이 아니라 렌즈**가 됩니다. 에이전트를 안내하고 ANA가 검사·추론하게 하지만, 에이전트가 찾거나 제안할 수 있는 것을 막지 않습니다. 지식그래프의 **규칙 추론**이 더해지고, 진화 제안은 늘 Inbox에 있습니다.

### Added

- **지식그래프의 규칙 추론.** 관계 종류에 *역관계*, *대칭*, *전이*를 표시할 수 있습니다(System › Ontology › Relations). 지식그래프를 읽을 때 그 규칙이 뜻하는 사실을 끌어냅니다(pat *works_for* acme에서 acme *employs* pat, 이어진 사슬에서 o1 *part_of* o3). 개체의 상위 클래스도 함께 붙입니다. 추론한 사실은 저장하지 않습니다.
  - `inferred`로 오고, `rule`과 근거가 된 사실(`because`)이 붙습니다.
  - 점선으로 보입니다(*Inferred* 토글).
  - NodeRel에도 `inferred` 표시와 함께 들어갑니다.
  - `owl:inverseOf` / `owl:SymmetricProperty` / `owl:TransitiveProperty`로 내보냅니다.

### Changed

- **온톨로지는 관문이 아니라 렌즈입니다.** 에이전트를 안내할 뿐, 말할 수 있는 것을 막지 않습니다.
  - 분석에서 틀에 안 맞는 것(모르는 클래스나 관계, From → To가 어긋난 사실)을 버리지 않습니다. 남기고 *아직 온톨로지에 없음*(주황)으로 표시합니다. 버리는 것은 없는 개체를 가리키는 사실뿐입니다.
  - 지식그래프에 더할 때 관리자를 기다리게 하지 않습니다. 맞는지는 지식그래프를 읽을 때 계산하므로, 관리자가 개념을 더하면 바로 '맞음'이 됩니다.
  - 분석이 선언 없이 쓴 개념도 관리자에게 갑니다. 관리자 요청은 막는 승인이 아니라 정리입니다.
  - [Analyze]와 [Evolve] 지시문에 적었습니다: 맞으면 온톨로지를 쓰고, 안 맞으면 실제로 찾은 것을 말하고, 온톨로지 자체를 바꾸자고 제안해도 된다.

- **진화 제안은 늘 Inbox에.** 시스템 제안을 Roadmap에서 **System › Inbox › Evolve**로 옮겼습니다. Workspace › Inbox › Evolve와 같은 자리이고, 카드와 버튼도 같습니다(관리자는 *Start*, 실무자는 *Request approval*). Roadmap은 진행만 봅니다: *Requirements · Updates*(요구사항에서 나온 제안은 그 줄에 계속 보임).


## [0.8.0] — 2026-10-24

새 구조입니다.
- **범위 둘**: 실무자의 Workspace와 관리자의 System. 범위마다 받은함이 하나씩 있습니다.
- **역할**: 관리자와 실무자
- **System 온톨로지와 워크스페이스별 지식그래프**
- **Health › Tests**

### 추가

- **범위 둘, 받은함 하나씩.** 세 영역(Workspace / Collaborate / System)을 둘로 줄였고, 화면 맨 위에 지금 어느 범위인지 늘 보입니다.
  - **Workspace**(실무자): **Work**(할일·일정·메모) · **Knowledge** · **Files** · **Inbox**
  - **System**(관리자만, 위쪽이 어두운 띠): **Inbox** · **Roadmap** · **Ontology** · **Health**
  - **휴대폰:** 범위마다 하단 메뉴가 다릅니다(Work · Knowledge · Files · Inbox · System / Inbox · Roadmap · Ontology · Health · Workspace). 위쪽 탭 줄은 할일·일정·메모에서만 보입니다.
  - **데스크톱:** 로고 옆 전환 버튼으로 범위를 바꿉니다.
  - **한 화면에는 한 가지만.** 여러 가지가 있는 화면은 하위 탭으로 나누고, 하위 탭마다 나를 기다리는 수를 보여 줍니다.
    - Workspace Inbox: *Approvals · Work requests · Evolve · Sent*
    - System Inbox: *Approvals · Work requests*
    - Knowledge: *Links · Knowledge graph · Analysis · Ontology*
    - Roadmap: *Requirements · Evolve · Updates*
    - Ontology: *Classes · Relations*
    - Health: *Trustworthiness · Safety · Security · Tests · Usage*
  - **목록:** *Open / Done*으로 거르고, 각 카드는 자기 상태를 그대로 보여 줍니다.
  - **줄어든 탭:** 16개에서 범위마다 많아야 6개입니다.
  - **휴대폰 메뉴:** 두 줄로 접히지 않습니다. 하위 탭과 도구 줄은 옆으로 밀리고, 좁은 화면에서는 System 머리글의 부제가 숨겨집니다.
- **관리자와 실무자.** `ANA_ADMINS=이메일,…`로 관리자를 정합니다. 다음 경우에는 모두 관리자이므로 혼자 쓰는 설치는 예전과 같습니다.
  - 목록이 비어 있을 때
  - 신원 헤더가 없는 단일 사용자 설치
  - 이 컴퓨터에서 신원 없이 들어온 호출
  - **관리자 전용(서버에서 확인):**
    - 시스템 제안의 시작·취소·재시도
    - Update 반영
    - Bypass / Full Access로 바꾸기
    - 워크스페이스 삭제
    - 프로젝트 파일
    - 온톨로지 변경
    - 테스트 실행

    실무자가 누르면 **System › Inbox의 승인요청**이 되고, 관리자가 승인하면 그 동작이 실행됩니다.
  - **System › Inbox**에 승인요청과 작업요청이 모입니다. 보내는 쪽은 다음과 같습니다.
    - 실무자(*Ask the admin*)
    - 에이전트(`POST /api/admin/requests`)
    - 시스템 점검(risk면 작업요청을 열고, 고쳐지면 닫음)
  - 실무자는 자기 요청을 Inbox › *Sent*에서 봅니다. 프로필 메뉴에 내 역할이 보입니다.
- **진화 제안은 두 곳에 있습니다.**
  - Workspace › Inbox › *Evolve*: 이미 있는 기능으로 이 워크스페이스를 더 잘 쓰는 방법입니다. 실무자가 시작하고, 에이전트에게는 그 워크스페이스 데이터만 바꾸라고 지시합니다.
  - System › Roadmap › *Evolve*: 시스템 자체를 바꾸는 제안입니다. 관리자만 시작합니다.
  - 새 기능이 필요한 워크스페이스 제안은 *Propose to the system*으로 올립니다.
- **Roadmap.** 요구사항, 시스템 제안, 업스트림 업데이트를 한 줄씩 단계(*Request → Proposal → Building → Checked*)와 다음 할 일(*Check*, *Propose*, *Start*, *Check again*, *Bring in*)로 보여 줍니다. 실무자는 *Request a feature*로 요구사항을 보냅니다.
- **요구사항 → 제안 → 다시 확인.** *반영 안 됨*이나 *일부 반영*인 요구사항을 한 번에 시스템 제안으로 만듭니다(다음 단계와 이유가 함께 들어감). 그 제안이 완료되면 요구사항이 다시 확인해 달라고 표시됩니다.
- **온톨로지는 System에, 지식그래프는 워크스페이스마다.** 자세한 내용은 [docs/relations.ko.md](docs/work-and-knowledge.ko.md)에 있습니다.
  - **System › Ontology:** 모든 워크스페이스가 공유하는 온톨로지 하나입니다.
    - 핵심(Note · Task · Event · Day와 앱 관계)은 처음부터 있고 잠겨 있습니다.
    - 나머지는 관리자가 더하고, 고치고, 지웁니다.
    - 지식그래프가 아직 쓰는 개념은 지울 수 없습니다.
  - **워크스페이스별 지식그래프**(`kg.json`)
    - Knowledge › *Knowledge graph*에서 봅니다.
    - OntoAir로 열거나 Turtle로 내려받습니다(공용 온톨로지가 TBox, 워크스페이스 사실이 ABox).
  - **분석**은 공용 온톨로지를 읽습니다. 결과에 새 클래스나 관계가 있으면 관리자 승인요청이 됩니다.
  - **결과는 실무자가 승인해야 들어갑니다.** Inbox › Approvals 또는 Knowledge › Analysis에서 *Add to the knowledge graph* / *Discard*를 고릅니다.
  - **승인 대기 개념을 쓰는 사실**은 관리자가 그 개념을 승인하면 모든 워크스페이스에 저절로 들어갑니다. 틀린 개체나 사실은 실무자가 지울 수 있습니다.
  - **NodeRel 색인:** 지식그래프는 NodeRel에 들어갑니다(`kg:<id>`, 관계 타입의 사실, 근거 항목으로 `MENTIONED_IN`). 그래서 `/api/graph/trace · neighbors · schema`로 따라갈 수 있습니다.
- **Health › Tests.** 관리자가 이 ANA의 테스트(`package.json` scripts.test)를 돌립니다.
  - 결과 화면: 묶음별 통과·실패, 실패한 테스트, 출력, 지난 실행
  - 실패하면 Health 배지에 셉니다.
- **예제 배너.** 첫 실행 예제가 남아 있는 동안 Workspace에 *These are examples — Clear them / Keep*이 뜹니다. 예제는 설치당 한 번만 넣습니다(`.seeded`). 그래서 지워도 다시 생기지 않습니다.
- **ANA가 대신 보낸 지시문은 채팅에서 카드로 보입니다.** 내 말풍선 대신 *Asked the agent to analyze 10 items · #1* 같은 카드가 뜨고, **Open**(그 탭으로 이동)과 *Show instruction*이 있습니다. 사용 기록에도 `chat.send` 대신 `analysis.request`, `evolve.request` 등으로 남습니다.

### 변경

- **Files**
  - 워크스페이스마다 폴더가 따로 있습니다(기본 워크스페이스는 `.ana/files`, 또는 `ANA_FILES_ROOT`).
  - *From chat*은 채팅 첨부를 읽기 전용으로 보여 줍니다.
  - *Project files*는 관리자만 보며, `.ana/`·`.git/`에는 쓸 수 없습니다.
- **Health**는 통계와 세 점검 영역을 한곳에 모았습니다. 영역마다 위험한 것부터 보이고, 괜찮은 점검은 접어 둡니다.
- **사용 기록**에 앱에서 한 일을 남깁니다.
  - 탭과 하위 탭 방문
  - 승인, 제안·요청 처리, 요구사항 수정
  - 업로드(폴더 또는 종류와 크기만, 이름은 남기지 않음)
  - OntoAir 열기, `.ttl` 내려받기, 테스트 실행

  `chat.send`에는 앞 60자와 길이만 남깁니다.
- README 휴대폰 이미지를 새 구조로 바꿨습니다.

### 업그레이드 안내

- 기존 진화 제안은 **시스템** 제안이 됩니다. 기존 요청은 자기 워크스페이스에 그대로 남습니다.
- 온톨로지를 처음 읽을 때 각 워크스페이스의 예전 분석 온톨로지를 `ontology.json`으로 합칩니다. 핵심과 겹치는 개념은 건너뜁니다. 예전 분석 결과는 실무자가 승인(Inbox › Approvals)하기 전까지 지식그래프에 **들어가지 않습니다**.
- 실무자 역할을 주려면 `ANA_IDENTITY_HEADER`(게이트웨이가 보내는 신원 헤더)와 `ANA_ADMINS`를 설정합니다. 그전까지는 모두 관리자입니다.
- **새 API:** `/api/admin/inbox · requests · act`, `/api/ontology`, `/api/kg`, `/api/kg/ttl`, `/api/analysis/apply · discard`, `/api/tests`, `/api/tests/run`, `POST /api/activity`
- **바뀐 API:** `/api/evolve`는 `scope`를 받고, `/api/evolve-act`에는 `escalate`가 생겼습니다.
- **없어진 것:** `/api/analysis/ontology/reset`과 `useBase`

## [0.7.0] — 2026-10-24

### 추가

- **Windows x64 오프라인판 (LLM·인터넷·tmux 없이).** `node scripts/package-offline.mjs`로 `dist/ANA-offline-win-x64-<버전>.zip`을 만듭니다. 안에는 체크섬을 확인한 포터블 Node 24 LTS, ANA 베이스, `node_modules`, `start.bat`이 들어 있습니다. 압축을 풀고 `start.bat`을 더블클릭하면 브라우저에 `http://127.0.0.1:8809/`가 열립니다. 데이터는 `data\`, 올린 파일은 `files\`에 저장됩니다. [docs/offline.ko.md](docs/offline.ko.md)를 보세요.
  - `ANA_OFFLINE=1`을 주면 어떤 ANA든 이렇게 돌릴 수 있습니다. 화면에서는 채팅, Chip과 그리기, Analyze, Open in OntoAir, Requirements › Analyze, 그리고 Evolve · Approvals · Requests · Trustworthiness · Safety · Update 탭이 숨겨집니다. tmux 폴링은 멈추고, 에이전트나 인터넷이 필요한 라우트는 503으로 거절합니다.
  - `ANA_OPEN=1`을 주면 서버가 뜬 뒤 기본 브라우저를 엽니다.
- **세션을 바꿀 때 무엇을 기다리는지 보여 줍니다.** 채팅 콤보에서 세션을 고르면 대화 자리에 진행 카드가 뜹니다. 단계마다 걸린 시간이 붙습니다.
  1. *Connect to the session*: 세션 연결
  2. *Find the conversation log*: 대화 기록 찾기(Claude Code / Codex와 대화 제목)
  3. *Read the log*: 기록 읽기(읽은 MB와 진행 막대)
  4. *Show the latest messages*: 최근 메시지 표시(N개 중 최근 40개)

  셸 세션은 구조화된 기록이 없다고 알리고 터미널 화면 미러를 보여 줍니다. 실행 중이 아닌 세션은 그렇다고 알립니다. 긴 대화가 있는 세션에서 페이지를 처음 열 때도 같은 카드가 뜹니다.
  - 불러오는 동안에는 채팅 컨트롤도 로딩 중임을 드러냅니다.
    - 입력창은 *Loading <세션>…*으로 잠깁니다.
    - 모델 자리에는 스피너와 *Loading…*이 뜹니다.
    - 나머지 버튼은 흐려지고 눌리지 않습니다.
    - 세션 점이 돌고, 입력창 위로 진행 막대가 흐릅니다.
    - 대화가 표시될 때까지 보내기를 막습니다.
- **휴대폰에서 제안 글 받기.** 채팅 입력창의 회색 제안 글(터미널에 입력만 하고 보내지 않은 글)에 누를 수 있는 **Tab** 버튼이 붙습니다. 터치 화면에서는 더 큰 알약 모양이고, 누르면 그 글이 입력되며 키보드는 그대로 열려 있습니다. 데스크톱에서는 Tab 키도 그대로 됩니다.
- **업로드 진행률.** 첨부하는 동안 칩에 *Uploading 42%*와 채워지는 막대가 보입니다. 그림은 같은 칩에서 *Capturing… → Compressing… → Uploading %* 순서로 진행됩니다.

- **ANA가 대신 보낸 지시문은 내 말풍선이 아니라 카드로 보입니다** (진화 제안 #1).
  - 화면이 대신 보내는 긴 지시문은 한 줄 카드로 바뀝니다. 카드에는 태그, 무엇을 시켰는지, 그 탭으로 가는 **Open**, 원문을 펼치는 *Show instruction*이 있습니다.
  - 대상은 `[Analyze]`, `[Evolve]`, `[Requirements]`, `[Update]`, `[Requests]`, `[Approvals]`, `[Request #n]`입니다.
  - 예: *Asked the agent to analyze 10 items · #1*, *Asked the agent to do proposal #1 · …*, *Answered request #7 · B*
  - 에이전트 기록에서 보일 때와 화면 미러에서 보일 때 모두 적용됩니다.
  - 사용 기록에도 `chat.send` 대신 `analysis.request`, `evolve.request`, `requirements.request`, `update.request`, `requests.request`, `approvals.request`, `request.answer`로 남습니다.

- **요구사항 → 진화 제안 → 다시 확인** (진화 제안 #3).
  - *반영 안 됨*이나 *일부 반영*으로 판정된 요구사항에 **Propose this**가 생깁니다. 누르면 분석의 다음 단계와 이유를 담은 진화 제안 "Requirement #N: …"이 만들어집니다.
  - 요구사항 카드에는 그 제안의 상태와 *Open in Evolve*가 보이고, 제안 카드에는 *From requirement #N*이 붙습니다.
  - 제안이 완료되면 요구사항에 *Proposal #N is done — check again*이 뜨고, 버튼이 **Check again**으로 바뀝니다.
  - 요구사항마다 열린 제안은 하나만 둡니다.
- **"These are examples — Clear them"** (진화 제안 #5).
  - 첫 실행 예제 메모·할일·일정이 남아 있는 동안 Workspace에 배너가 뜹니다.
  - **Clear them**은 예제와 그 관계를 지우고, **Keep**은 배너만 숨깁니다.
  - 예제는 설치당 한 번만 넣습니다(`.seeded` 표시). 그래서 지우거나 상태 파일을 지워도 다시 생기지 않습니다.
  - `ANA_SEED=0`이면 처음부터 넣지 않는 것은 그대로입니다.
- **Files에 전용 폴더** (진화 제안 #6).
  - System › Files는 이제 **Files**(`.ana/files`, 또는 `ANA_FILES_ROOT`)에서 열립니다.
  - **From chat**은 채팅 첨부 파일을 읽기 전용으로 보여 줍니다.
  - 프로젝트 전체는 *Show project files*를 켜야 **Project files**로 보입니다. `.ana/`와 `.git/` 안에는 올릴 수 없습니다(`?root=files|chat|project`).
- **사용 기록이 채팅만이 아니라 앱에서 한 일을 남깁니다** (진화 제안 #7). 새로 남기는 것은 다음과 같습니다.
  - 탭 열기(`tab.view`, 탭마다 1분에 한 번)
  - 승인·거절(`approval.approve|reject`)과 제안 처리(`evolve.do|done|fail|ignore|reopen`)
  - 요청 처리(`#id`로)와 요구사항 수정
  - Files 업로드(`files.upload`, 폴더와 크기)와 채팅 첨부(`upload.attach`, 종류와 크기만, 이름은 남기지 않음)
  - OntoAir 열기와 `.ttl` 내려받기

  `chat.send`에는 앞 60자와 길이만 남깁니다. 화면 안에서 생기는 일은 `POST /api/activity`로 받는데, 정해 둔 종류만 받습니다.

### 변경

- **그림을 그려 올리는 스크린샷이 훨씬 작아졌습니다.** 원래 해상도 PNG 대신, 긴 변 1600px 이하(최대 2배율)로 찍어 JPEG로 저장합니다. 품질은 0.82이고, 그래도 900KB를 넘으면 0.7로 낮춥니다. 같은 화면에서 iPhone은 497KB에서 62KB로, Retina Mac은 285KB에서 61KB로 줄었습니다. 펜 자국과 글자는 그대로 읽힙니다.

- **긴 대화는 백그라운드에서 읽습니다.** 큰 에이전트 기록(4MB 초과)을 처음 읽을 때 4MB씩 나눠 읽어 서버를 멈추지 않습니다. 다 읽을 때까지 `/api/agentlog`는 `loading {done, total}`을 돌려줍니다. 줄은 바이트 단위로 잘라서, 청크 경계에 걸린 한글 같은 여러 바이트 글자도 깨지지 않습니다. 99MB 기록을 약 0.6초에 읽습니다.
- **전환이 빨라졌습니다.**
  - 전환 직후 다음 상태 확인을 기다리지 않고 바로 기록을 받습니다.
  - 진행 중이던 이전 요청 때문에 2초를 더 기다리던 문제를 없앴습니다.
  - 콤보를 열면 다른 에이전트 세션의 기록을 미리 읽어 둡니다(`/api/agentlog?prefetch=1`). 그래서 고르는 즉시 보입니다.
  - 기록이 뜨기 전에 터미널 미러 이력이 잠깐 보였다 바뀌던 깜빡임도 없앴습니다.

### 수정

- 채팅의 "No agent connected / Start a conversation" 안내가 메시지 위에 남을 수 있던 문제. 주석이 그 안내를 숨기는 줄까지 삼키고 있었습니다.

## [0.6.0] — 2026-10-15

### 추가

- **협업 › Requirements.** 이 ANA에 바라는 것을 적어 둡니다. *Analyze*를 누르면 에이전트가 요구사항마다 실제 시스템을 확인해 **반영 / 일부 반영 / 미반영**을 판정합니다. 어떻게 반영됐는지, 또는 왜 안 됐는지(아직 안 만듦, 충돌, 정보 부족, 범위 밖, 막힘)를 근거·다음 단계와 함께 작성합니다.
  - 분석하는 동안 진행률 막대가 보입니다.
  - 상태별로 걸러 볼 수 있습니다. 요구사항을 고치면 그 분석은 다시 봐야 함으로 표시됩니다.
- **관계 › Open in OntoAir.** 끝난 분석을 [OntoAir](https://poc.aifactory.space/ontoair/)에서 3D 온톨로지·지식그래프로 엽니다. *Download .ttl*은 같은 OWL/Turtle 파일을 내려받습니다. 그래프 내용을 링크 안(`#` 뒤의 `data:` URL — 브라우저가 서버로 보내지 않는 부분)에 담아 넘기므로, ANA가 로그인 게이트웨이 뒤에 있어도 공개 링크나 OntoAir 수정 없이 열립니다. 아주 큰 그래프(링크 약 1.5MB 초과)만 24시간 토큰 링크로, 그것도 막히면 파일을 내려받아 OntoAir의 📄 File로 엽니다.
- **[docs/relations.ko.md](docs/work-and-knowledge.ko.md)** 관계의 두 층(고정된 앱 링크와 분석으로 발견한 층), 분석 과정, 온톨로지, 지식그래프, 검사, NodeRel 색인, 내보내기를 정리했습니다.

### 변경

- **분석 결과는 온톨로지 틀을 지켜야 합니다.** 개체의 클래스와 사실의 관계가 온톨로지에 있어야 하고, 사실은 관계의 From → To를 지켜야 합니다(하위 클래스 포함). 맞지 않는 사실은 버리고, 클래스를 모르는 개체는 클래스만 비웁니다. 둘 다 *N items didn't fit the ontology*에 보이고 에이전트에게 `issues`로 돌아갑니다.
- **온톨로지를 이어 씁니다.** 워크스페이스마다 지금까지 만든 클래스와 관계 종류를 쌓아 두고, 다음 분석이 거기서 시작합니다. 같은 개념이 회차마다 다른 이름으로 생기지 않습니다. 앞 회차에서 가져온 클래스는 *(earlier)*로 표시됩니다. *Start fresh*로 비웁니다.
- **지식그래프가 관계 그래프에 들어갑니다.** 최신 분석을 메모·할일·일정과 같은 NodeRel에 넣습니다. 개체는 `kg:<id>`, 사실은 관계 종류로, 근거 항목과는 `MENTIONED_IN`으로 잇습니다. 에이전트는 `/api/graph/trace`로 메모에서 그 안의 사람·조직까지 따라갈 수 있고, `/api/graph/schema`가 지식그래프 어휘를 설명합니다. Links 흐름 그림은 그대로입니다.

### 수정

- **에이전트에게 보내는 지시문이 브라우저 주소를 쓰던 문제.** 로그인 게이트웨이(예: `base.anahub.io`)를 거치면 에이전트의 `curl`이 401을 받아 분석·요구사항·진화 제안·요청·업데이트 결과를 보고하지 못했습니다. 이제 화면이 서버의 로컬 주소(`/api/agent-base` → `127.0.0.1:<포트>`)를 받아 모든 지시문에 넣습니다.
- **"Agent input line is not ready … waiting on a dialog"로 전송이 실패하던 문제.** 에이전트 입력줄에 `0.5.1 기준으로…`, `3.14 …`처럼 숫자와 점으로 시작하는 글이 남아 있으면 생겼습니다(world-ana 보고). 판정이 이를 메뉴 항목(`❯ 1. Yes`)으로 오인했습니다. 이제 점 뒤에 공백(또는 줄 끝)이 있어야 메뉴로 봅니다. `channel-core.js`의 네 곳을 모두 고쳤습니다. 진짜 메뉴는 여전히 막고, 채팅 전송은 남은 글을 지운 뒤 메시지를 보냅니다. 회귀 테스트는 D9에 있습니다.
  - **번호 목록 모양 입력**(`1. 먼저 테스트를 돌리고…`)은 입력 상자 아래 행으로 메뉴와 구별합니다. 평소 입력 상자 밑에는 모드 상태줄(`⏵⏵ auto mode on (shift+tab to cycle)`, `⏸ plan mode on`, `? for shortcuts`)이 있습니다. 메뉴가 뜨면 상자가 메뉴로 바뀌고 상태줄 대신 조작 안내(`Enter to select · Esc to cancel`)가 붙습니다. 실제 Claude Code 화면으로 확인했습니다. 입력해 둔 번호 목록은 준비 상태로, `/model` 선택 메뉴는 여전히 메뉴로 판정됩니다.
- **에이전트 내부 알림이 내 말풍선으로 보이던 문제.** Claude Code의 `<task-notification>`(백그라운드 작업 끝남)을 *Background task completed: …* 같은 한 줄 시스템 표시로 보여 줍니다. 기록 보기와 화면 미러 모두에 적용됩니다.

## [0.5.1] — 2026-10-14

### 변경

- **긴 대화도 빨리 열립니다.** 세션을 바꾸면 최근 메시지 40개만 먼저 불러옵니다. 위로 스크롤하면 이전 메시지를 40개씩 이어서 불러오고, 보던 메시지는 제자리에 있습니다. 맨 위에는 *Loading earlier messages…*가 보이고, 다 불러오면 *Beginning of the conversation*이 나옵니다. 아직 안 불러온 이전 메시지가 갱신돼도 맨 아래에 끼어들지 않습니다(`/api/agentlog?before=&limit=`).

## [0.5.0] — 2026-10-14

### 추가

- **GitHub Codespaces로 시작.** 아무것도 설치하지 않고 브라우저에서 ANA를 실행합니다. 코드스페이스를 열고 Ports에서 **ANA / 8809**를 연 뒤, ANA 채팅에서 Claude 설정을 마치면 됩니다([안내](docs/codespaces.md)). 코드스페이스를 다시 켜면 대화가 이어집니다.
- **채팅에서 Claude Code 첫 설정.** 처음 실행할 때의 화면을 카드로 보여 줍니다: 테마 선택(번호 없는 일곱 가지, 화살표로 선택), 로그인 방식, OAuth 링크, 비밀번호 형식의 코드 입력칸. 로그인 코드는 열려 있는 입력 프롬프트에만 보내고 저장하지 않습니다.
- **System › Files.** 이 ANA 폴더를 탐색하고(`ANA_FILES_ROOT`로 바꿀 수 있음), 지금 폴더에 업로드(파일당 25MB, 같은 이름은 덮어쓰지 않음)하고 내려받습니다. 심볼릭 링크와 폴더 밖 경로는 거부합니다. 목록은 탐색기처럼 한 줄에 이름·크기·수정 시각·다운로드를 보여 줍니다(폰에서는 수정 시각을 숨김).
- **협업 목록을 상태별로.** Evolve, Approvals, Requests 탭마다 **대기 · 처리 중 · 완료 · 실패 · 취소** 필터와 개수가 생겼습니다. 고른 상태는 탭마다 기억합니다. 휴대폰에서는 다섯 칸 격자로 보입니다.
  - **실패:** 처리 중인 제안과 요청에 *Failed* 버튼이 생겼고, 에이전트도 이유와 함께 실패를 알릴 수 있습니다(`action: fail`). 적용하지 못한 데이터 변경은 대기로 슬쩍 돌아가지 않고 오류와 함께 **실패**로 남으며, *다시 시도*할 수 있습니다.
  - 끝났거나 취소한 항목도 더 이상 숨기지 않고, 최근 것부터 시각과 함께 보여 줍니다.
  - **Evolve:** 처리 중인 카드에 *완료*·*취소* 버튼이 생겼습니다. 완료한 것은 *다시 열기*, 취소한 것은 *복원*할 수 있습니다(`/api/evolve-act` → `reopen`).
  - **Approvals:** 데이터 변경도 적용·거절된 것까지 보입니다(`GET /api/proposals`).

- **입력창의 권한 방패 아이콘.** 모델 알약 옆의 방패로 에이전트의 권한 모드를 한눈에 봅니다. 확인 없이 실행하는 모드(Bypass, Full Access)면 빨간 "!" 방패가 됩니다. 누르면 권한만 고르는 시트가 열립니다.

- **System › Update.** *Check for updates*를 누르면 GitHub의 최신 agent-native-agent와 이 ANA를 기능 단위로 비교해, 들여올 만한 것(없거나 일부만 있는 기능, 더 새 모듈, 더 새 공유 런타임)을 목록으로 보여 줍니다.
  - *Update*를 누르면 해당 스킬·빠진 부분·업스트림 위치와 함께 에이전트에게 맡깁니다. 에이전트가 이식한 뒤 완료나 실패를 보고합니다.
  - *Cancel*한 항목은 다음 체크부터 나오지 않습니다.
  - 항목은 같은 다섯 목록(대기 · 처리 중 · 완료 · 실패 · 취소)으로 나뉩니다.
  - `ANA_UPDATE_TARGET` / `ANA_UPSTREAM_URL`로 비교 대상을 바꿀 수 있습니다.
- 휴대폰에서 System 탭바가 고른 탭으로 스크롤되고, 옆에 탭이 더 있으면 가장자리가 흐려집니다.

- **관계 분석.** Relations 탭의 *Analyze*를 누르면 메모·할일·일정(과 집중할 것)을 고를 수 있습니다. 에이전트가 **온톨로지**(개념과 관계의 종류)와 **지식그래프**(실제 개체와 사실, 각각 근거 항목 표시)를 만듭니다.
  - 분석하는 동안 진행률 막대에 에이전트의 단계가 보입니다.
  - 결과는 *Ontology*와 *Knowledge graph* 두 화면으로 나뉘고, 개체를 누르면 사실과 근거가 보입니다.

### 변경

- **System › Reliability 탭 이름을 Trustworthiness로 바꿨습니다.** 점검 내용은 같고, 탭과 문서의 이름만 바뀝니다.

### 수정

- **Codex 다이얼로그 선택지**를 채팅에서 올바르게 읽고 고릅니다.
- **신뢰 질문:** 안전 안내 문구를 번호 없는 신뢰 선택지로 잘못 읽지 않습니다.
- **Files 탭이 생기기 전에 켠 서버에서는 업로드가 실패하던 문제**(화면은 새 버전, API는 옛 버전). 서버를 재시작하면 됩니다.
- **폰에서 채팅 버튼이 목록 마지막 줄의 Download 버튼을 가리던 문제.** 화면 아래 여백을 버튼 높이만큼 늘렸습니다.
- **한 폴더에서 Claude 세션 여럿이 돌 때 채팅 기록이 고른 tmux 세션을 따라간다.** 지금까지는 그 폴더에서 가장 최근에 바뀐 대화 파일을 읽어, 모든 세션(예: `<이름>-ana-claude-1`·`-2`, 사람별 세션)이 같은 대화를 보였다. 이제 그 팬에서 도는 Claude 프로세스의 대화(`~/.claude/sessions/<pid>.json`)를 먼저, 다음은 팬의 `@ana_session_id` 표시, 둘 다 없을 때만 최근 파일을 읽는다. 아직 한 마디도 안 한 새 세션은 남의 대화 대신 빈 채팅을 보인다(`agent-log.js`).

- **Codex 채팅에 답변·모델명·사용량이 안 나오던 문제.** 세션을 켠 지 일주일이 넘으면 생겼습니다. Codex는 세션을 시작한 날짜 폴더의 기록 파일에 계속 이어 쓰는데, 찾을 때는 최근 7일 폴더만 봤습니다. 이제 같은 폴더의 기록 중 가장 최근에 수정된 파일을 고릅니다.

- **입력창의 모델명이 잘리던 문제("Opus 5…").** 방패와 사용량 링이 추가된 뒤 PC 채팅 패널과 좁은 폰에서 생겼습니다. 이제 모델 알약은 줄어들지 않습니다. 둥근 버튼이 화면 폭이 아니라 입력창 폭에 맞춰 40 → 34 → 31px로 작아지므로, PC 패널과 폰에 같은 규칙이 적용됩니다.

- **다크 모드에서 선택된 상태 필터가 안 보이던 문제**(밝은 바탕에 흰 글씨). 선택 표시에 테마 반전색을 써서 라이트·다크 모두에서 읽힙니다.

## [0.4.2] — 2026-10-06

### 추가

- **권한 모드 선택.** 채팅의 모델 시트에서 Effort 아래에 **Permissions** 줄이 생겼습니다.
  - **Claude Code:** Manual · Accept edits · Plan · Auto · Bypass permissions. 현재 모드는 상태줄에서 읽고, 바꿀 때는 그 모드가 보일 때까지 Shift+Tab을 누릅니다. 이 세션에만 적용됩니다.
  - **Codex:** Ask for approval · Approve for me · Full Access. Codex 자체 `/permissions` 메뉴로 바꾸고, Codex는 이 선택을 기본값으로도 저장합니다.
  - 확인 없이 실행하는 모드(Bypass, Full Access)는 한 번 더 확인합니다. **System › Safety**는 시작 옵션 대신 지금 모드를 보고합니다.
  - 새 모듈 `permission-mode.js`, API `/api/agent-permission`.

## [0.4.1] — 2026-10-04

모든 ANA에 같은 이름 규칙을 씁니다. 폴더가 이름을 정하고, 이름이 tmux 세션을 정합니다.

### 변경

- **폴더 → ANA 이름.** 모든 ANA는 `~/ana/<xxx>-ana`(또는 `/ana/<xxx>-ana`)에 설치하고, 폴더명이 ANA의 이름입니다. `<xxx>`에는 하이픈이 들어가도 됩니다. 이 저장소의 샘플은 `base-ana`이며 `~/ana/base-ana`에 설치합니다. 폴더명이 `-ana`로 끝나지 않으면 `base-ana`로 보고, `ANA_NAME`으로 덮어쓸 수 있습니다.
- **기본 tmux 세션이 `<이름>-claude`입니다**(이전 `ana`). 예: `base-ana-claude`. `TMUX_SESSION`은 그대로 우선하므로 기존 배포는 세션이 바뀌지 않습니다.
- **채팅의 세션 목록에는 이 ANA의 세션만 보입니다:** `<xxx>-ana-<yyy>`, `yyy`는 에이전트 라벨(`claude`, `codex`, 하이픈이 들어간 아무 라벨). 지금 연결된 세션과 기본 세션은 항상 남습니다. `ANA_TMUX_ALL=1`이면 모든 tmux 세션을 보여 줍니다. `/api/config`와 `/api/health`가 `ana`를 알려 줍니다.
- **설치 스크립트.** `install.sh`와 `install-wsl.ps1`은 `~/ana/base-ana`로 clone합니다. `run.sh`와 `check-env.sh`는 폴더에서 세션 이름을 정하고, `run.sh`의 서버 세션은 `srv-<세션>`이라 채팅 목록에 뜨지 않습니다. `<세션>-server`로 떠 있는 기존 서버는 그대로 이어 씁니다.
- `channel-core.js`가 `anaNameOf`, `defaultSession`, `isAnaSession`을 내보냅니다.
- README, `install` 스킬, `ana` 스킬을 새 경로·세션 이름으로 고치고 짧은 "이름 규칙" 절을 넣었습니다.

### 수정

- **에이전트가 실제로 떠 있는데 채팅 상단이 "Not connected"로 굳고, 새로고침해야 풀리던 문제.**
  - **원인:** iPhone 화면이 꺼지거나 탭이 백그라운드로 가면 Safari가 연결을 반쯤 죽은 채로 남길 수 있습니다. 그러면 상태·세션 목록·실시간 스트림 요청이 실패도 응답도 없이 멈췄습니다. 요청에 시간 제한이 없어서 상단 표시와 세션 팝업(기본 안내 문구 "Start an agent in tmux…")이 그대로 굳었습니다.
  - **지금:** 모든 조회에 시간 제한이 있습니다. 화면으로 돌아오면 바로 다시 확인합니다(`visibilitychange`, `pageshow`, `online`). 실시간 스트림이 40초 넘게 조용하면 다시 연결합니다(서버는 15초마다 ping을 보냅니다).
  - 서버에 닿지 못하는 동안은 **Reconnecting…**, 서버가 에이전트가 없다고 할 때만 **Not connected**로 표시합니다.

## [0.4.0] — 2026-10-02

base가 코딩 에이전트와 함께 운영하는 1인 업무 보드가 되었습니다. 화면은 세 영역으로 나뉘고, 채팅은 Claude 앱과 같은 모습입니다. 이미 있는 ANA에도 이 기능들을 가져갈 수 있는 스킬이 함께 들어갑니다.

### 추가

- **세 영역.** 휴대폰은 하단 메뉴, PC는 로고 옆 전환 버튼입니다.
  - **Workspace:** Tasks · Calendar · Notes와 워크스페이스 콤보
  - **Collaborate:** Evolve · Approvals · Requests. 배지는 나를 기다리는 것의 수입니다.
  - **System:** Stats · Relations · Reliability · Safety · Security. 배지는 위험 점검의 수입니다.
- **NodeRel 관계.** 메모·할일·일정을 `SPAWNED`, `SCHEDULED_AS`, `REFERS_TO`로 잇고, `DUE_ON` / `ON` 날짜 관계는 자동으로 만들어집니다.
  - 항목마다 관계 칩이 붙고, 누르면 그 항목으로 이동합니다.
  - **System › Relations**에서 흐름 그래프와 흐름이 끊긴 곳을 보여 줍니다.
  - 새 API: `/api/graph`, `/api/graph/neighbors`, `/api/graph/trace`, `/api/graph/schema`, `/api/link`
  - 진실원천은 그대로 `state.json`이고, `graph.sqlite`는 다시 만들어지는 인덱스입니다.
- **협업.**
  - **진화 제안:** 기능, 데이터, 사용 로그를 근거로 앱이 어떻게 진화하면 좋을지 제안합니다.
  - **승인 요청:** 대기 중인 데이터 변경(diff)과 `approval`, `decision`, `access` 요청
  - **작업 요청:** `action`, `info` 요청
  - 탭마다 "에이전트에게 요청" 버튼이 있습니다. 요청 종류에 `approval`이 새로 생겼습니다.
- **AI 신뢰성 · 안전 · 보안 점검**(`GET /api/trust`). 실제 상태로 계산합니다.
  - **신뢰성:** 에이전트 동작 여부, 구조화된 기록 사용 여부, 도구 실패율, 중단, 요금제 사용량
  - **안전:** 권한 확인을 건너뛰는 실행 옵션, 실제로 실행한 위험 명령
  - **보안:** 바인드 주소, 로그인, CSRF, 토큰 처리, 인증 파일 권한, 메모에 붙여 넣은 비밀값. 비밀값은 값이 아니라 위치만 알립니다.
- **Claude 앱 같은 채팅.**
  - **기록 기반 표시:** 에이전트 자신의 기록(Claude Code 기록, Codex rollout)으로 그립니다(`agent-log.js`). 그래서 말풍선, 마크다운 응답, 접히는 `Ran 3 commands ›` 묶음, 이미지 썸네일이 정확하게 나옵니다.
  - **세션 콤보:** 전체 폭으로 펼쳐지고, 세션마다 대화가 따로 남습니다.
  - **모델 알약:** 실제 모델명을 보여 주고, 누르면 모델·추론 강도 시트가 열립니다. Claude는 `/model`·`/effort`를 보낸 뒤 화면에서 결과를 확인하고, Codex는 Codex 자체 메뉴로 바꿉니다(`codex-settings.js`).
  - **사용량 링:** 5시간·주간. Claude는 로컬 로그인으로 `api/oauth/usage`를 서버에서만 읽고, Codex는 `rate_limits`를 읽습니다.
  - **입력창:** 음성 받아쓰기, 파일 첨부. 떠 있는 입력창에 ↓ 버튼이 있고, iOS 키보드 바로 위에 붙습니다.
- **컨텍스트 칩.** 칩 모드에서 항목을 누르면 다음 메시지에 붙습니다. ✎로 화면에 그리면(빨강·마젠타·파랑) 표시한 캡처가 첨부되고, ⟳는 새 종류의 요소를 칩 대상으로 등록합니다.
- **기존 ANA용 스킬과 업데이트.**
  - 새 스킬: `ana-update`, `chat-window`, `context-chips`, `relations`, `app-shell`, `agent-requests`, `trust-checks`
  - `features.json`에 기능별 앵커가 있습니다. `ana-diff.mjs`가 이를 기준으로 있음/일부/없음, 오래된 모듈, 런타임 차이를 보고하고, 동기화한 커밋을 `.ana-sync.json`에 남깁니다.
  - 플러그인 마켓플레이스: `claude plugin install ana@agent-native-agent`
- `seed.js`: 첫 실행 때 예제 흐름 두 개가 들어갑니다(`ANA_SEED=0`이면 빈 보드로 시작).

### 변경

- Meetings와 Members 탭을 없앴습니다. base는 1인용이고, 로그인은 여전히 게이트웨이 헤더로 할 수 있습니다.
- **Node 24 이상**이 필요합니다(`node:sqlite`).
- README를 세 영역과 스킬 중심으로 다시 쓰고 스크린샷을 새로 넣었습니다(WebP, 합쳐서 약 130KB).

### 수정

- **가짜 질문 카드.** 응답에 "Select model"이나 "Esc to cancel"이 들어 있으면 Claude Code 질문 창으로 오인해 채팅 입력이 막혔습니다. 이제 입력 상자가 보이면 질문 창이 아닌 것으로 보고, 질문 창 표시는 화면 아래 20줄에서 줄 맨 앞에 있을 때만 인정합니다.
- **iOS 끝 당김.** 채팅 끝에서 더 당겨도 채팅창 전체가 밀려 내려가지 않습니다. 키보드가 떠 있을 때만 보이는 영역을 따라가고, 뒤 페이지 스크롤을 막습니다.
- GitHub SSH 키가 없어도 `npm install`이 됩니다(NodeRel을 HTTPS로 받음).
- **전송 상태.** 에이전트가 `[Pasted text]`로 받은 메시지에 "Unconfirmed / Resend"가 뜨던 문제를 고쳤습니다.
- **작은 UI 수정.**
  - 세션 목록에 "You"가 두 번 보이던 문제
  - "New version available" 버튼이 눌리지 않던 문제
  - 세션 팝업이 화면 밖으로 넘치던 문제
  - 처음 열 때 배지 수가 틀리던 문제

## [0.3.0] 이전

`d690eda`까지의 [커밋 기록](https://github.com/tykimos/agent-native-agent/commits/main)을 보세요. 워크스페이스, 칩 모드, install 스킬, 세션별 원장, 구조화된 AskUserQuestion 카드가 들어 있습니다.

[0.8.0]: https://github.com/tykimos/agent-native-agent/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/tykimos/agent-native-agent/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/tykimos/agent-native-agent/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/tykimos/agent-native-agent/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/tykimos/agent-native-agent/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/tykimos/agent-native-agent/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/tykimos/agent-native-agent/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/tykimos/agent-native-agent/compare/d690eda...v0.4.0
[0.3.0]: https://github.com/tykimos/agent-native-agent/commits/d690eda
