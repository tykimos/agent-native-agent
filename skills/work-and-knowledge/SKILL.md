---
name: work-and-knowledge
description: Port ANA's Work and Knowledge layers — the Work ontology (work-ontology.js) and Work graph (work items and their links in work-graph.json: SPAWNED, SCHEDULED_AS, REFERS_TO, derived DUE_ON / ON, new link kinds as a lens), the Knowledge ontology (classes, relations, rules in .ana/knowledge-ontology.json) and per-workspace knowledge graph (knowledge-graph.json) built by Analyze, rule reasoning, the NodeRel index (graph-index.js) and /api/graph + /api/link + /api/kg + /api/ontology for the agent. Use when the user says "관계", "NodeRel", "온톨로지", "지식그래프", "워크 그래프", "규칙", "메모에서 할일로", "흐름이 끊긴 곳", or when ana-update reports work-graph / knowledge-analysis / ontology (formerly relations) missing.
---

# work-and-knowledge — what people did, and what it means

`work-graph.json` (one per workspace; `state.json` before 0.11) stays the **source of truth**, including a `links[]` array. `graph-index.sqlite` is a **derived index**, built by NodeRel from a snapshot of the state and rebuilt whenever the snapshot signature changes. So any write path (UI, agent diff, hand edit) is covered, and the index can be deleted at any time.

## Vocabulary (base ANA)

| Relation | From → To | Meaning | Kind |
|---|---|---|---|
| `SPAWNED` | Note → Task · Event | where a task/event came from | explicit |
| `SCHEDULED_AS` | Task → Event | time blocked to do the task | explicit |
| `REFERS_TO` | any → any | manual reference | explicit |
| `DUE_ON` | Task → Day | from `task.due` | derived |
| `ON` | Event → Day | from `event.date` | derived |

**A per-user ANA has different items.** Define its own vocabulary in `graph-index.js`: `RULES` (explicit types with allowed from/to kinds), `MEANINGS`, `kindOf()`, and `snapshot()` (which arrays become which kinds, and which fields derive which links). Keep the shape: explicit links live in `state.links[]`, derived ones are computed in `snapshot()`.

## Pieces

| Piece | Upstream |
|---|---|
| Graph module | `graph-index.js` (copy, then adapt `RULES / MEANINGS / TITLES / kindOf / snapshot` to the domain). Exports `createGraph, snapshot, checkLink, addLink, removeLink, pruneLinks`. Silences only Node's "SQLite is experimental" warning while loading NodeRel. |
| Dependency | `"@tykimos/noderel": "github:tykimos/NodeRel#<sha>"`, resolved over **https** in `package-lock.json` (ssh breaks installs without GitHub keys). Needs **Node ≥ 24** (`node:sqlite`). |
| API | `/api/state` returns `links`. `GET /api/graph`, `/api/graph/neighbors?id=`, `/api/graph/trace?id=&depth=&types=`, `/api/graph/schema` (AI-readable vocabulary). `POST /api/link {action:add\|remove, from, to, type}` is validated by `checkLink`. Create routes accept `from` and auto-link (`linkFrom`). `pruneLinks` runs before every save. `graph.close(ws)` runs on workspace delete. |
| UI | Relation chips on items (`function relChips`, "From note · Scheduled · Refers to" with ✕). Clicking a chip calls `gotoNode(id)` (switches tab, `flash()`es the target). `openLinkModal` / `renderLinkList` handle manual links. Relations tab: `#knowledgeView`, `renderWorkGraph`, `drawWorkGraph` (4 columns, bezier edges colored by type, hover dims unrelated nodes, click navigates), `renderRelStats` (gaps), `#relVocab`. |
| Seed | `seed.js`: two example flows so the graph isn't empty on first run (`ANA_SEED=0` disables). |

## Ontology (System) and knowledge graph (Workspace)

See [docs/work-and-knowledge.md](../../docs/work-and-knowledge.md) for the full model. In short:

- **Ontology** — one per ANA, two layers (Work ontology · Knowledge ontology), each made of **classes, relations and rules**. Rules: sub-class, From → To (check), inverse / symmetric / transitive (on the relation), **chain** (`{kind:'chain', if:[rel|^rel ×1–3], then}`) and **limit** (`{kind:'limit', rel, per, max}`) in `ontology.json` `rules`, and Work **compute** rules (`made: 'derived'`). `kgLens` turns inverse/symmetric/transitive into chains and runs all chains to a fixed point; limits set `fit:false` + `why`. TTL: `rdfs:subPropertyOf`, `owl:propertyChainAxiom`, `owl:Restriction`/`owl:maxCardinality`. UI: System › Ontology › Rules (`ontoRuleTable`, `ruleSay`, rule form in `openOntoForm`). **Work layer** = `work-ontology.js`: what this ANA's code stores (classes, relations with `from`/`to`, `made: explicit|derived`); `graph-index.js` reads `RULES`/`MEANINGS`/node kinds from it; read-only at runtime (`APP_ONTOLOGY`, `source: 'app'`). When porting to a domain ANA, **write that ANA's own `work-ontology.js`** for its data model — don't copy base's Note/Task/Event. **Knowledge layer** = `.ana/knowledge-ontology.json`, the admin's concepts (`loadOntology`, `systemOntology`, `GET/POST /api/ontology`, admin only; App and still-used concepts are refused). `ontologyIssues` reports references to concepts that are gone (shown in System › Ontology).
- **Knowledge graph** — one per workspace in `knowledge-graph.json` next to `work-graph.json` (`loadKgStore`, `GET /api/kg`, `POST /api/kg remove-entity|remove-fact`, `GET /api/kg/ttl`). NodeRel indexes it (`createGraph({ loadKg })` → `kg:<id>`, relation-typed facts, `MENTIONED_IN`).
- **Analysis** — input carries the shared ontology; `cleanAnalysis(body, itemIds, systemOntology())` checks it; concepts the ontology lacks become admin approval requests (`action: ontology.add`, executed by `runAdminAction`); the result waits for a member's *Add to the knowledge graph* (`POST /api/analysis/apply`, `mergeIntoKg`) or *Discard*. **The ontology is a lens, not a gate:** nothing is dropped or held back for not fitting (only facts pointing at missing entities); `kgLens` computes `fit`/`why` on read, plus rule reasoning (super-class `types`, inverse / symmetric / transitive relations → `inferred` facts with `rule` and `because`, never stored, dashed in the chart, `inferred` on NodeRel edges, `owl:inverseOf` / `owl:SymmetricProperty` / `owl:TransitiveProperty` in Turtle). Concepts used without being declared go to the admin too.
- **UI** — menus follow the model: **Workspace › Graph** (`#graphView`, sub-tabs `work` / `knowledge`, `openGraphSub`, `onGraph`) and **System › Ontology** (sub-tabs `work` / `knowledge`, pill switch `ontoPart` = classes · relations · rules, `ontoPartHtml`, `ontoLayer`). Graph › Work (`renderWorkGraph`, `drawWorkGraph`): the work graph; new link kinds (`isNewLinkType`, UPPER_SNAKE) are stored and drawn as *(new)*, known kinds keep From → To. Graph › Knowledge: knowledge graph (`renderKg`, `drawKG(g, o, color, host)`), *Analyze* in its toolbar, the latest analysis card (`renderAnalysis` — above the graph while running or waiting, below otherwise), *Ontology* on each Graph tab (`openOntologyFor(layer)`: admin → System › Ontology on that tab; members → read-only `#ontoModal` via `renderOntoRead(layer)`). System › Ontology: `renderOntology`, `openOntoForm` (the + Add button shows only on the Knowledge tab). Sub-classes on work items: `typePill`, `#stypeModal`, `POST /api/subtype`. Promotion evidence: `GET /api/ontology/evidence`. Inbox › Approvals cards (`renderKgApprovals`), OntoAir via `openTtlInOntoAir`.

## Porting

1. Add the dependency (https URL). Check `node -v` ≥ 24. Copy `graph-index.js` and adapt the vocabulary to the domain. Write the vocabulary table for the user first and confirm it.
2. Add `links: []` to the target's state schema. Call `pruneLinks` in its save path.
3. Add the routes to the extraApi module; add `graph.view(ws, s)` output to its state endpoint.
4. UI: relation chips on the domain's item cards, `gotoNode` for the domain's tabs, and the Relations view. If the target has app-shell areas, it goes under **System**.
5. Tests: port G1–G4 and C14 from upstream `test.cjs`. They cover snapshot/day nodes, link rules, prune, rebuild-on-change, and route integration.

## Verify

- Create an item from another item → the chip appears on both ends → click it to jump.
- Delete one end → the link is gone after save.
- Edit work-graph.json by hand → the next `/api/graph` reflects it (rebuild).
- Relations tab: hovering highlights the chain; "Where the flow breaks" lists items with no follow-up.
