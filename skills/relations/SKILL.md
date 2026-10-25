---
name: relations
description: Port ANA's item relations — a NodeRel (SQLite) graph over the ANA's own items with explicit links (SPAWNED, SCHEDULED_AS, REFERS_TO) and derived day links (DUE_ON, ON), relation chips on each item, the Relations tab (flow graph, "where the flow breaks", vocabulary) and /api/graph + /api/link for the agent. Use when the user says "관계", "NodeRel", "메모에서 할일로", "연결 관계", "흐름이 끊긴 곳", "Relations 탭", or when ana-update reports relations missing.
---

# relations — how one thing led to another

state.json stays the **source of truth**, including a `links[]` array. `graph.sqlite` is a **derived index**, built by NodeRel from a snapshot of the state and rebuilt whenever the snapshot signature changes. So any write path (UI, agent diff, hand edit) is covered, and the index can be deleted at any time.

## Vocabulary (base ANA)

| Relation | From → To | Meaning | Kind |
|---|---|---|---|
| `SPAWNED` | Note → Task · Event | where a task/event came from | explicit |
| `SCHEDULED_AS` | Task → Event | time blocked to do the task | explicit |
| `REFERS_TO` | any → any | manual reference | explicit |
| `DUE_ON` | Task → Day | from `task.due` | derived |
| `ON` | Event → Day | from `event.date` | derived |

**A per-user ANA has different items.** Define its own vocabulary in `graph.js`: `RULES` (explicit types with allowed from/to kinds), `MEANINGS`, `kindOf()`, and `snapshot()` (which arrays become which kinds, and which fields derive which links). Keep the shape: explicit links live in `state.links[]`, derived ones are computed in `snapshot()`.

## Pieces

| Piece | Upstream |
|---|---|
| Graph module | `graph.js` (copy, then adapt `RULES / MEANINGS / TITLES / kindOf / snapshot` to the domain). Exports `createGraph, snapshot, checkLink, addLink, removeLink, pruneLinks`. Silences only Node's "SQLite is experimental" warning while loading NodeRel. |
| Dependency | `"@tykimos/noderel": "github:tykimos/NodeRel#<sha>"`, resolved over **https** in `package-lock.json` (ssh breaks installs without GitHub keys). Needs **Node ≥ 24** (`node:sqlite`). |
| API | `/api/state` returns `links`. `GET /api/graph`, `/api/graph/neighbors?id=`, `/api/graph/trace?id=&depth=&types=`, `/api/graph/schema` (AI-readable vocabulary). `POST /api/link {action:add\|remove, from, to, type}` is validated by `checkLink`. Create routes accept `from` and auto-link (`linkFrom`). `pruneLinks` runs before every save. `graph.close(ws)` runs on workspace delete. |
| UI | Relation chips on items (`function relChips`, "From note · Scheduled · Refers to" with ✕). Clicking a chip calls `gotoNode(id)` (switches tab, `flash()`es the target). `openLinkModal` / `renderLinkList` handle manual links. Relations tab: `#relationsView`, `renderRelations`, `drawRelGraph` (4 columns, bezier edges colored by type, hover dims unrelated nodes, click navigates), `renderRelStats` (gaps), `#relVocab`. |
| Seed | `seed.js`: two example flows so the graph isn't empty on first run (`ANA_SEED=0` disables). |

## Ontology (System) and knowledge graph (Workspace)

See [docs/relations.md](../../docs/relations.md) for the full model. In short:

- **Ontology** — one per ANA: `CORE_ONTOLOGY` (Note·Task·Event·Day + this graph's relations, built in) plus admin-added concepts in `ontology.json` (`loadOntology`, `systemOntology`, `GET/POST /api/ontology`, admin only to change; core and still-used concepts are refused). On first read, earlier per-workspace analysis ontologies are merged in.
- **Knowledge graph** — one per workspace in `kg.json` next to `state.json` (`loadKgStore`, `GET /api/kg`, `POST /api/kg remove-entity|remove-fact`, `GET /api/kg/ttl`). NodeRel indexes it (`createGraph({ loadKg })` → `kg:<id>`, relation-typed facts, `MENTIONED_IN`).
- **Analysis** — input carries the shared ontology; `cleanAnalysis(body, itemIds, systemOntology())` checks it; concepts the ontology lacks become admin approval requests (`action: ontology.add`, executed by `runAdminAction`); the result waits for a member's *Add to the knowledge graph* (`POST /api/analysis/apply`, `mergeIntoKg`) or *Discard*. **The ontology is a lens, not a gate:** nothing is dropped or held back for not fitting (only facts pointing at missing entities); `kgLens` computes `fit`/`why` on read, plus rule reasoning (super-class `types`, inverse / symmetric / transitive relations → `inferred` facts with `rule` and `because`, never stored, dashed in the chart, `inferred` on NodeRel edges, `owl:inverseOf` / `owl:SymmetricProperty` / `owl:TransitiveProperty` in Turtle). Concepts used without being declared go to the admin too.
- **UI** — System › Ontology (`renderOntology`, `openOntoForm`), Knowledge sub-tabs *Links · Knowledge graph · Analysis · Ontology* (`renderKg`, `renderOntoRead`, `renderAnalysis`, `drawKG(g, o, color, host)`), Inbox › Approvals cards (`renderKgApprovals`), OntoAir via `openTtlInOntoAir`.

## Porting

1. Add the dependency (https URL). Check `node -v` ≥ 24. Copy `graph.js` and adapt the vocabulary to the domain. Write the vocabulary table for the user first and confirm it.
2. Add `links: []` to the target's state schema. Call `pruneLinks` in its save path.
3. Add the routes to the extraApi module; add `graph.view(ws, s)` output to its state endpoint.
4. UI: relation chips on the domain's item cards, `gotoNode` for the domain's tabs, and the Relations view. If the target has app-shell areas, it goes under **System**.
5. Tests: port G1–G4 and C14 from upstream `test.cjs`. They cover snapshot/day nodes, link rules, prune, rebuild-on-change, and route integration.

## Verify

- Create an item from another item → the chip appears on both ends → click it to jump.
- Delete one end → the link is gone after save.
- Edit state.json by hand → the next `/api/graph` reflects it (rebuild).
- Relations tab: hovering highlights the chain; "Where the flow breaks" lists items with no follow-up.
