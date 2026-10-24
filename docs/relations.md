# Relations in ANA — ontology and knowledge graph

**English** · [한국어](relations.ko.md)

ANA separates **what kinds of things exist** from **what is actually known**:

| | Ontology (schema, TBox) | Knowledge graph (facts, ABox) |
|---|---|---|
| **Scope** | the **System** — one for the whole ANA, shared by every workspace | each **Workspace** — its own entities and facts |
| **Who changes it** | the **admin** (System › Ontology). New concepts proposed by an analysis arrive as approval requests in System › Inbox | **members**, by approving an analysis result (Inbox › Approvals or Knowledge › Analysis) |
| **What it holds** | classes with parents (Client ⊂ Organization), relation types with From → To | entities typed by a class, facts typed by a relation, each citing the notes/tasks/events it came from |
| **Stored in** | `ontology.json` next to `evolve.json` (+ the built-in core) | `kg.json` next to the workspace's `state.json` |
| **Seen in** | System › Ontology (edit) · Knowledge › Ontology (read-only) | Knowledge › Knowledge graph |

The ontology has a **built-in core** fixed by the app: the classes Note, Task, Event, Day and the relations SPAWNED, SCHEDULED_AS, REFERS_TO, DUE_ON, ON (`graph.js` `RULES`/`MEANINGS`). They can't be edited. Everything else (Client, works_for, …) is added by the admin.

```mermaid
flowchart LR
  subgraph SYS["System — ontology (admin)"]
    C1[Organization] --- C2[Client ⊂ Organization]
    R1(["client_of: Client → Organization"])
  end
  subgraph WS["Workspace — knowledge graph (members)"]
    A["Acme (Client)"] -- client_of --> T["Our team (Team)"]
    A -. MENTIONED_IN .-> N[Note: Client feedback]
  end
  SYS -- "types every entity and fact" --> WS
```

---

## How knowledge grows

```mermaid
sequenceDiagram
  participant M as Member (Knowledge › Analysis)
  participant S as ANA server
  participant A as Agent
  participant AD as Admin (System)
  M->>S: POST /api/analysis/start {kinds, focus}
  M->>A: [Analyze] instruction (curls to 127.0.0.1)
  A->>S: GET /api/analysis/input — items + the shared ontology + rules
  A->>S: POST /api/analysis/progress …
  A->>S: POST /api/analysis/result {ontology, graph}
  S->>S: check against the ontology; new concepts → admin approval requests
  S-->>M: "Add analysis #N to the knowledge graph?" (Inbox › Approvals)
  M->>S: POST /api/analysis/apply → kg.json (known concepts only)
  AD->>S: approve "Add class Team" → POST /api/ontology
  S->>S: facts waiting on Team are added to every workspace's knowledge graph
```

1. **Analyze.** A member picks notes / tasks / events (and an optional focus). The agent reads them with the **shared ontology** (`GET /api/analysis/input` → `ontology` + `rules`) and reports progress.
2. **Result.** `POST /api/analysis/result {summary, ontology:{classes, relations}, graph:{entities, facts}}`. The server checks it against the ontology (below) and answers with counts, `issues` and `newConcepts`.
3. **New concepts → admin.** A class or relation the ontology doesn't have becomes an **approval request** in System › Inbox ("Add class "Team" to the ontology", `action: ontology.add`). Approving it adds the concept.
4. **Add to the knowledge graph → member.** The result is not applied by itself. It appears in **Inbox › Approvals** and in Knowledge › Analysis. *Add* merges it into `kg.json`: entities by id (sources merged), facts by from·rel·to. Only entities and facts whose concepts are in the ontology go in; the rest wait in the job (`pending`).
5. **Waiting facts catch up.** When the admin approves a concept, every workspace's waiting entities and facts that use it are added automatically (`applyPendingAll`).
6. *Discard* drops a result; the knowledge graph keeps everything added before. Members can remove a wrong entity or fact (`POST /api/kg {action: remove-entity|remove-fact}`).

## Checking a result against the ontology

`cleanAnalysis(body, itemIds, systemOntology())` — known concepts are the shared ontology plus the concepts proposed in the result:

| Check | If it fails |
|---|---|
| sizes (80 classes, 80 relations, 400 entities, 1200 facts) | the rest is cut |
| `class.parent`, `relation.domain/range` exist | cleared, issue |
| `entity.class` exists | class cleared, entity kept, issue |
| `fact.from/to` are entities, `fact.rel` exists | fact dropped, issue |
| `from`'s class is the domain **or a sub-class of it**, likewise `to` and range | fact dropped, issue |
| sources are items of this job | those ids removed |

Adding to the knowledge graph checks domain → range again against the **current** ontology.

## The knowledge graph inside NodeRel

Each workspace's `kg.json` is indexed in the same `graph.sqlite` as the app links: entities as `kg:<id>` (kind = class), facts typed by relation id, and `MENTIONED_IN` entity → source item. So the agent can trace from a note to the people in it:

```bash
curl -s "http://127.0.0.1:8811/api/graph/trace?id=n-ex-acme&depth=2"
curl -s "http://127.0.0.1:8811/api/graph/neighbors?id=kg:acme"
curl -s "http://127.0.0.1:8811/api/graph/schema"     # built-in vocabulary + the ontology's relations
```

The Links chart and "where the flow breaks" use only the built-in relations.

## Export and OntoAir

- **Knowledge graph:** `GET /api/kg/ttl` writes OWL Turtle — the shared ontology as TBox (`owl:Class` + `rdfs:subClassOf`, `owl:ObjectProperty` + `rdfs:domain/range`) and the workspace's knowledge graph as ABox. Knowledge › Knowledge graph has *Open in OntoAir ↗* and *Download .ttl*.
- **One analysis result:** `GET /api/analysis/ttl?id=` (Knowledge › Analysis).
- OntoAir receives the Turtle inside the link (`#data:text/turtle,…`), so it works behind a sign-in gateway. Only a very large analysis falls back to a 24-hour token link (`/api/analysis/shared/<token>/<name>.ttl`), then to a download. A `#` in a label becomes `＃` because line-based parsers cut at `#`.

## Existing installs

The first time the ontology is read, the per-workspace analysis ontologies from earlier versions (`analysis.json` → `ontology` and finished jobs) are merged into `ontology.json`, skipping anything that clashes with the core. Earlier analysis results can then be added to each workspace's knowledge graph from Knowledge › Analysis.

## API summary

| Endpoint | Who | Purpose |
|---|---|---|
| `GET /api/ontology` | anyone | core + added classes and relations |
| `POST /api/ontology {action: add\|update\|remove, kind: class\|relation, item}` | admin | change the ontology; core is refused; a concept still used is refused |
| `POST /api/analysis/start {kinds, openOnly?, focus?}` · `GET /api/analysis/input?id=` · `POST /api/analysis/progress` · `POST /api/analysis/result` · `/fail` · `/cancel` | member · agent | run an analysis |
| `POST /api/analysis/apply {id}` · `POST /api/analysis/discard {id}` | member | add a result to the knowledge graph, or drop it |
| `GET /api/analysis` | anyone | jobs, the shared ontology, knowledge-graph size |
| `GET /api/kg` · `GET /api/kg/ttl` · `POST /api/kg {action: remove-entity\|remove-fact}` | member | the workspace's knowledge graph |
| `GET /api/graph/neighbors · trace · schema` | anyone | both layers through NodeRel |

Code: `dashboard-api.js` (`CORE_ONTOLOGY`, `loadOntology`, `systemOntology`, `cleanAnalysis`, `mergeIntoKg`, `applyPendingAll`, `analysisTurtle`), `graph.js` (`snapshot` with `kg`, `KG_PREFIX`), `dashboard.html` (System › Ontology `renderOntology`, Knowledge `renderKg` / `renderOntoRead`, `renderKgApprovals`, `drawKG`, `openTtlInOntoAir`). Tests: `test.cjs` C14 (app links), C16 and C18 (analysis, checks, approvals, pending facts, NodeRel, export), `admin.test.cjs` (migration).
