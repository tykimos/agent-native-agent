---
name: ontology
description: Write and keep this ANA's work ontology (work-ontology.js) — classes with Datatype Properties, Object Properties (lowerCamelCase, functional, aligned to standard vocabularies), rules (SHACL) checked against the real data, a version, and a human-readable Description whose sentences point at the ontology. Knowledge › Ontology shows it and exports OWL 2 + SHACL (.ttl, OntoAir). Use when the agent builds or changes a kind of work, when someone says "온톨로지", "ontology", "클래스", "관계", "규칙", "OWL", "ttl", "SHACL", or when ana-update reports the ontology format missing.
---

# ontology — one declaration people can read, standards can read, and the data is checked against

`work-ontology.js` declares the kinds of work items and how they connect. `graph-index.js` builds the graph from it; **Knowledge › Ontology** shows it top to bottom:

1. **Description** — paragraphs people read; every sentence carries numbered references. Pressing a number opens that Class / Object Property / Datatype Property / Rule. A reference that no longer exists is struck through — a stale description shows itself.
2. **Version** line · **View in OntoAir ↗** · **Download .ttl**.
3. **Classes** — list on the left, detail on the right: aligned standards, Datatype Properties (name · code · type with allowed values · who sees it · description, fields inside JSON indented), Object Properties (direction · other class · how many · made by).
4. **Object Properties** — a diagram (boxes = classes, named arrows = relations; automatic layered layout, drag to move, *Reset layout*) and the same as a table.
5. **Rules** — each rule, its class, and what the current data does: kept · broken (first 30, with why) · could not check (counted by reason).

## Format

```js
// one Datatype Property. type is an XSD/RDF name. 'T[]' = many values, 'xsd:string|a,b' = allowed values (owl:oneOf)
const p = (id, label, type, desc, who, sub) => {
  const [t, vals] = String(type).split('|');
  return { id, label, type: t.replace(/\[\]$/, ''), ...(/\[\]$/.test(t) ? { many: true } : {}), ...(vals ? { values: vals.split(',') } : {}), desc, ...(who ? { who } : {}), ...(sub ? { sub } : {}) };
};

module.exports = {
  meta: { version: '1.1.0', modified: '2026-11-23', creator: '<company or service — not a person>', lang: 'en' },
  description: [
    ['Overview', [
      ['A quote is a price we sent to one lead.', ['C:Quote', 'R:quoteFor', 'C:Lead']],
      ['Once sent, its amount does not change.', ['P:Quote.amount', 'RULE:R1']],
    ]],
  ],
  classes: [
    { id: 'Lead', label: 'Lead', list: 'leads', desc: 'A company that asked for a price', title: (x) => x.name, align: ['prov:Agent'],
      props: [p('name', 'Name', 'xsd:string', 'Company name'), p('apiKey', 'API key', 'xsd:string', 'Their key', 'serverSecret')] },
    { id: 'Quote', label: 'Quote', list: 'quotes', desc: 'A price we sent', align: ['prov:Entity'],
      props: [p('amount', 'Amount', 'xsd:integer', 'In KRW'), p('state', 'State', 'xsd:string|draft,sent,won,lost', ''),
              p('lines', 'Lines', 'rdf:JSON[]', 'Line items', 'all', [p('sku', 'SKU', 'xsd:string', '')])] },
    { id: 'Day', label: 'Day', desc: 'A calendar day (computed from dates)' },
  ],
  relations: [
    { id: 'quoteFor', label: 'quote for', from: ['Quote'], to: ['Lead'], made: 'derived', field: 'Quote.lead', functional: true, align: ['prov:wasAttributedTo'], desc: 'The lead this quote was sent to' },
    { id: 'sentOn', label: 'sent on', from: ['Quote'], to: ['Day'], made: 'derived', field: 'Quote.sentAt', functional: true },
    { id: 'refersTo', label: 'refers to', from: ['*'], to: ['*'], made: 'explicit', desc: 'Manual reference between two work items' },
  ],
  rules: [
    { id: 'R1', label: 'A sent quote has an amount', on: ['Quote'], desc: 'Nobody can accept a price that is not there.',
      shacl: 'sh:targetClass {C:Quote} ; sh:property [ sh:path {P:Quote.amount} ; sh:minCount 1 ]' },
    { id: 'R2', label: 'A won quote is for a lead that still exists', on: ['Quote'] },   // no shacl → exported as a comment only
  ],
};
```

| Key | Meaning | In the .ttl |
|---|---|---|
| `classes[].props[]` | Datatype Properties: `id`, `label`, `type`, `desc` | `owl:DatatypeProperty`, `rdfs:range` |
| `props[].type` | `xsd:string` · `xsd:integer` · `xsd:decimal` · `xsd:boolean` · `xsd:date` · `xsd:dateTime` · `rdf:JSON` · `rdfs:Literal` | `rdfs:range` |
| `props[].values` | allowed values | `owl:oneOf` (an `owl:Restriction` per class when classes allow different values) |
| `props[].many` | the field holds several values | comment |
| `props[].who` | who sees the value — a short code: `all` (default), `serverSecret`, `internal`, … | annotation `ana:visibility` |
| `props[].sub` | fields inside a JSON value | `# Properties inside JSON` |
| `classes[].align` / `relations[].align` | standard parent (PROV-O, Dublin Core, DCAT, EARL, schema.org …) | `rdfs:subClassOf` / `rdfs:subPropertyOf` |
| `relations[].functional` | `true` = one only, `false` = many | `owl:FunctionalProperty` |
| `rules[].shacl` | SHACL body with placeholders `{C:Class}` `{P:Class.field}` `{R:relation}` | `sh:NodeShape` |
| `meta` | `version`, `modified`, `creator`, `lang` (language tag for labels) | `owl:versionInfo`, `owl:versionIRI`, `dcterms:creator`, `dcterms:modified` |
| `description` | `[[heading, [[sentence, [refs]], …]], …]` — refs `C:Class` · `R:relation` · `P:Class.field` · `RULE:id` | — |

- **Codes.** Class ids are UpperCamelCase (`Quote`), relation ids lowerCamelCase (`quoteFor`) — the OWL convention. Old `UPPER_SNAKE` codes (`QUOTE_FOR`) are still read (and links are rewritten on the next save), but write new ones in camelCase.
- **One name, one relation.** Don't give two relations the same label ("belongs to" ×4) — say what it belongs to.
- **Same code on several lines** (e.g. `producedIn` from both `Response` and `Result`, with different fields) is merged into one relation (domains, ranges and fields collected).
- **Same field code in several classes** with the same type, `who` and `many` becomes one shared property in the .ttl (`ana:name`, domain = all those classes).
- Work classes (those with a `list`) are exported as `owl:AllDisjointClasses`.

## Version — bump it every time you change the ontology

Rename or remove → major (`2.0.0`) · add → minor (`1.2.0`) · wording or labels only → patch (`1.1.1`). Set `modified` to today. Fix the Description in the same change — a struck-through reference means you forgot.

## Rules — check them against the data, don't just declare them

`GET /api/knowledge` returns `rules`: the declarations, merged with what `work-rules.js` (next to `work-ontology.js`, optional) finds:

```js
// work-rules.js — checkRules(lists) gets work-graph.json ({ quotes: [...], leads: [...] }) and returns, per rule id:
module.exports = { checkRules(L) {
  const q = L.quotes || [], bad = q.filter((x) => x.state === 'sent' && x.amount == null);
  return { R1: { checked: q.filter((x) => x.state === 'sent').length, bad: bad.length, unknown: 0, unknownWhy: {},
                 examples: bad.slice(0, 30).map((x) => ({ id: x.id, name: x.title, why: 'sent without an amount' })) } };
} };
```

A rule with no result shows `—` (not checked). What we learned the first time rules ran on real data: most "broken" results were the checker's fault. A value that is also in the input is not a leak; a re-check under a new version of the same criterion is not a mismatch; things you cannot see (imported runs, deleted items) are *could not check, because …*, not *broken*.

## Method — in this order, one short question at a time with the person

1. **Competency questions.** Write the questions the ontology must answer (Q1 … Qn), each with a SPARQL sketch. Drop classes and fields no question uses; widen where a question cannot be answered.
2. **Align to standards.** Keep your names; hang them under standard terms with `align`. Don't force a match that isn't there.
3. **Shared properties and missing declarations.** Same field name → same meaning; one name per relation; `functional`; version and creator.
4. **Unpack JSON and add taxonomies** when a question needs what is inside (a review list → a `Review` class).
5. **Verify.** The .ttl parses; a reasoner finds no contradiction; each question's SPARQL returns what you expect.

## API

- `GET /api/knowledge` → `{ …knowledge.json, graph: { kinds (with props, align), relations (with functional, align), meta, description, nodes, edges }, rules }` — gzip when large (the page shows a progress bar and a log).
- `GET /api/agent-base` gives this ANA's address; the .ttl namespace is `<address>/ontology#`.
