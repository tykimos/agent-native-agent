# ANA의 관계 — 온톨로지와 지식그래프

[English](relations.md) · **한국어**

ANA는 **어떤 종류의 것이 있는가(틀)**와 **실제로 무엇을 아는가(사실)**를 나눕니다.

| | 온톨로지(틀, TBox) | 지식그래프(사실, ABox) |
|---|---|---|
| **범위** | **System** — ANA 전체에 하나, 모든 워크스페이스가 공유 | **워크스페이스**마다 — 자기 개체와 사실 |
| **누가 바꾸나** | **관리자**(System › Ontology). 분석이 제안한 새 개념은 System › Inbox에 승인요청으로 옴 | **실무자**가 분석 결과를 승인해서(Inbox › Approvals 또는 Knowledge › Analysis) |
| **담는 것** | 부모가 있는 클래스(Client ⊂ Organization), From → To가 있는 관계 종류 | 클래스로 타입이 정해진 개체, 관계로 이어진 사실. 각각 근거 메모·할일·일정을 가리킴 |
| **저장** | `evolve.json` 옆의 `ontology.json`(+ 앱이 정한 핵심) | 워크스페이스 `state.json` 옆의 `kg.json` |
| **보는 곳** | System › Ontology(편집) · Knowledge › Ontology(읽기 전용) | Knowledge › Knowledge graph |

온톨로지에는 **앱이 정한 핵심**이 있습니다. 클래스 Note, Task, Event, Day와 관계 SPAWNED, SCHEDULED_AS, REFERS_TO, DUE_ON, ON입니다(`graph.js`의 `RULES`/`MEANINGS`). 핵심은 고칠 수 없습니다. 그 밖의 것(Client, works_for 등)은 관리자가 더합니다.

```mermaid
flowchart LR
  subgraph SYS["System — 온톨로지(관리자)"]
    C1[Organization] --- C2[Client ⊂ Organization]
    R1(["client_of: Client → Organization"])
  end
  subgraph WS["워크스페이스 — 지식그래프(실무자)"]
    A["Acme (Client)"] -- client_of --> T["우리 팀 (Team)"]
    A -. MENTIONED_IN .-> N[메모: Client feedback]
  end
  SYS -- "모든 개체와 사실의 타입" --> WS
```

---

## 지식이 쌓이는 과정

```mermaid
sequenceDiagram
  participant M as 실무자(Knowledge › Analysis)
  participant S as ANA 서버
  participant A as 에이전트
  participant AD as 관리자(System)
  M->>S: POST /api/analysis/start {kinds, focus}
  M->>A: [Analyze] 지시(127.0.0.1로 가는 curl)
  A->>S: GET /api/analysis/input — 항목 + 공용 온톨로지 + 규칙
  A->>S: POST /api/analysis/progress …
  A->>S: POST /api/analysis/result {ontology, graph}
  S->>S: 온톨로지로 검사, 새 개념 → 관리자 승인요청
  S-->>M: "분석 #N을 지식그래프에 더할까요?"(Inbox › Approvals)
  M->>S: POST /api/analysis/apply → kg.json(아는 개념만)
  AD->>S: "Add class Team" 승인 → POST /api/ontology
  S->>S: Team을 기다리던 사실을 모든 워크스페이스 지식그래프에 더함
```

1. **분석.** 실무자가 메모·할일·일정과 (선택) 초점을 고릅니다. 에이전트는 **공용 온톨로지**와 함께 항목을 읽고(`GET /api/analysis/input` → `ontology` + `rules`), 진행률을 보고합니다.
2. **결과.** `POST /api/analysis/result {summary, ontology:{classes, relations}, graph:{entities, facts}}`. 서버가 온톨로지로 검사하고(아래), 개수와 `issues`, `newConcepts`를 돌려줍니다.
3. **새 개념은 관리자에게.** 온톨로지에 없는 클래스나 관계는 System › Inbox의 **승인요청**이 됩니다("Add class "Team" to the ontology", `action: ontology.add`). 승인하면 그 개념이 더해집니다.
4. **지식그래프에 더하기는 실무자가.** 결과는 저절로 들어가지 않습니다.
   - **Inbox › Approvals**와 Knowledge › Analysis에 뜹니다.
   - *Add*를 누르면 `kg.json`에 합칩니다. 개체는 id로 합치고(근거도 합침), 사실은 from·rel·to로 합칩니다.
   - 온톨로지에 있는 개념을 쓰는 개체와 사실만 들어가고, 나머지는 작업에 남아 기다립니다(`pending`).
5. **기다리던 사실이 따라 들어갑니다.** 관리자가 개념을 승인하면, 모든 워크스페이스에서 그 개념을 기다리던 개체와 사실이 저절로 더해집니다(`applyPendingAll`).
6. **버리기와 지우기.** *Discard*는 그 결과만 버리고, 이미 더한 지식은 남깁니다. 틀린 개체나 사실은 실무자가 지울 수 있습니다(`POST /api/kg {action: remove-entity|remove-fact}`).

## 결과를 온톨로지로 검사하기

`cleanAnalysis(body, itemIds, systemOntology())`. 아는 개념은 공용 온톨로지에 결과가 제안한 개념을 더한 것입니다.

| 검사 | 어기면 |
|---|---|
| 크기(클래스 80, 관계 80, 개체 400, 사실 1200) | 나머지는 잘림 |
| `class.parent`, `relation.domain/range`가 있는가 | 비우고 issue |
| `entity.class`가 있는가 | 클래스만 비우고 개체는 남김, issue |
| `fact.from/to`가 개체인가, `fact.rel`이 있는가 | 사실 버림, issue |
| `from`의 클래스가 domain **또는 그 하위 클래스**인가, `to`와 range도 같은 방식 | 사실 버림, issue |
| 근거가 이 작업의 항목인가 | 해당 id 제거 |

지식그래프에 더할 때 domain → range를 **지금의** 온톨로지로 한 번 더 확인합니다.

## NodeRel 안의 지식그래프

워크스페이스마다 `kg.json`이 앱 링크와 같은 `graph.sqlite`에 들어갑니다.
- 개체는 `kg:<id>`이고, kind는 클래스입니다.
- 사실은 관계 id를 타입으로 갖습니다.
- 개체와 근거 항목은 `MENTIONED_IN`으로 이어집니다.

그래서 에이전트가 메모에서 그 안의 사람까지 따라갈 수 있습니다.

```bash
curl -s "http://127.0.0.1:8811/api/graph/trace?id=n-ex-acme&depth=2"
curl -s "http://127.0.0.1:8811/api/graph/neighbors?id=kg:acme"
curl -s "http://127.0.0.1:8811/api/graph/schema"     # 기본 어휘 + 온톨로지의 관계
```

Links 그림과 "흐름이 끊긴 곳"은 기본 관계만 씁니다.

## 내보내기와 OntoAir

- **지식그래프:** `GET /api/kg/ttl`이 OWL Turtle을 씁니다.
  - 공용 온톨로지는 TBox입니다: `owl:Class` + `rdfs:subClassOf`, `owl:ObjectProperty` + `rdfs:domain/range`.
  - 워크스페이스 지식그래프는 ABox입니다.
  - Knowledge › Knowledge graph에 *Open in OntoAir ↗*와 *Download .ttl*이 있습니다.
- **분석 결과 하나:** `GET /api/analysis/ttl?id=`(Knowledge › Analysis)
- **OntoAir로 넘기는 방식:**
  - Turtle을 링크 안(`#data:text/turtle,…`)에 담아 넘기므로, 로그인 게이트웨이 뒤에서도 열립니다.
  - 아주 큰 분석만 24시간 토큰 링크(`/api/analysis/shared/<토큰>/<이름>.ttl`)로, 그것도 안 되면 내려받기로 넘어갑니다.
  - 라벨의 `#`은 `＃`로 바꿉니다. 줄 단위 파서가 `#`에서 줄을 잘라 버리기 때문입니다.

## 기존 설치

온톨로지를 처음 읽을 때, 예전 버전의 워크스페이스별 분석 온톨로지(`analysis.json`의 `ontology`와 끝난 작업들)를 `ontology.json`으로 합칩니다. 핵심과 겹치는 것은 건너뜁니다. 그 뒤에는 예전 분석 결과도 Knowledge › Analysis에서 각 워크스페이스 지식그래프에 더할 수 있습니다.

## API 요약

| 엔드포인트 | 누가 | 용도 |
|---|---|---|
| `GET /api/ontology` | 누구나 | 핵심 + 더해진 클래스와 관계 |
| `POST /api/ontology {action: add\|update\|remove, kind: class\|relation, item}` | 관리자 | 온톨로지 바꾸기. 핵심은 거절, 아직 쓰이는 개념도 거절 |
| `POST /api/analysis/start {kinds, openOnly?, focus?}` · `GET /api/analysis/input?id=` · `POST /api/analysis/progress` · `POST /api/analysis/result` · `/fail` · `/cancel` | 실무자 · 에이전트 | 분석 실행 |
| `POST /api/analysis/apply {id}` · `POST /api/analysis/discard {id}` | 실무자 | 결과를 지식그래프에 더하기 / 버리기 |
| `GET /api/analysis` | 누구나 | 작업 목록, 공용 온톨로지, 지식그래프 크기 |
| `GET /api/kg` · `GET /api/kg/ttl` · `POST /api/kg {action: remove-entity\|remove-fact}` | 실무자 | 워크스페이스 지식그래프 |
| `GET /api/graph/neighbors · trace · schema` | 누구나 | NodeRel로 두 층 모두 |

코드:
- `dashboard-api.js`: `CORE_ONTOLOGY`, `loadOntology`, `systemOntology`, `cleanAnalysis`, `mergeIntoKg`, `applyPendingAll`, `analysisTurtle`
- `graph.js`: `kg`를 받는 `snapshot`, `KG_PREFIX`
- `dashboard.html`: System › Ontology `renderOntology`, Knowledge `renderKg` / `renderOntoRead`, `renderKgApprovals`, `drawKG`, `openTtlInOntoAir`

테스트는 `test.cjs`의 C14(앱 링크), C16·C18(분석, 검사, 승인, 대기 사실, NodeRel, 내보내기)과 `admin.test.cjs`(예전 설치 이전)입니다.
