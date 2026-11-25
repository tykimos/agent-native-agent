'use strict';
// graph-index.js — 이 ANA의 모든 것을 한 그래프로. NodeRel(github:tykimos/NodeRel)에 색인한다(graph-index.sqlite).
//
// 노드: 업무 항목(work-graph.json의 배열 — 종류는 work-ontology.js가 선언), 날짜(Day, 날짜 필드에서 계산),
//       개체(knowledge.json, id `kg:<개체 id>`), 문서(doc-N).
// 연결: 사람·에이전트가 만든 연결(work-graph.json links[]), 필드에서 계산한 연결(Task.due → dueOn …),
//       사실(knowledge.json facts — 끝점은 개체나 업무 항목), 언급(개체 ─mentionedIn─▶ 업무 항목 | 문서).
// 종류와 연결 어휘는 work-ontology.js와 knowledge.json의 classes·relations를 합친 하나다 — 나누지 않는다.
//
// 진실원천은 그 파일들이다. graph-index.sqlite는 거기서 만든 파생 색인이라 언제 지워도 다시 만들어진다.
// 읽을 때마다 스냅숏 서명을 비교해 달라졌으면 rebuild한다 — 어느 경로로 고쳤든.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// node:sqlite는 처음 불러올 때 'SQLite is an experimental feature' 경고를 한 번 찍는다. NodeRel을 불러오는 동안만 그 경고를 걸러 낸다.
const { NodeRel, describeNodeRel } = (() => {
  const emit = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const type = typeof rest[0] === 'string' ? rest[0] : (rest[0] && rest[0].type) || (warning && warning.name);
    if (type === 'ExperimentalWarning' && /SQLite/i.test(String((warning && warning.message) || warning))) return;
    return emit.call(this, warning, ...rest);
  };
  try { return { NodeRel: require('@tykimos/noderel').NodeRel, describeNodeRel: require('@tykimos/noderel/describe').describeNodeRel }; }
  finally { process.emitWarning = emit; }
})();

// work-ontology.js는 에이전트가 고친다 — 바뀌면 서버를 다시 띄우지 않아도 다음 읽기에서 새로 읽는다.
const ONTO_FILE = process.env.ANA_WORK_ONTOLOGY || path.join(__dirname, 'work-ontology.js');   // 시험은 다른 선언 파일을 쓸 수 있다
let onto = null, ontoAt = 0, override = null;
function work() {
  if (override) return override;
  let at = 0; try { at = fs.statSync(ONTO_FILE).mtimeMs; } catch {}
  if (!onto || at !== ontoAt) {
    try { delete require.cache[require.resolve(ONTO_FILE)]; const o = require(ONTO_FILE); onto = norm(o); ontoAt = at; }
    catch (e) { if (!onto) throw e; console.error(`[ana] work-ontology.js: ${e.message} — keeping the previous one`); }
  }
  return onto;
}
function norm(o) {
  const classes = (o.classes || []).filter((c) => c && /^[A-Za-z][\w]{0,39}$/.test(c.id));
  // 관계 코드는 OWL 관례 lowerCamelCase(dueOn, belongsToService). 옛 UPPER_SNAKE(DUE_ON)로 적힌 선언도 읽을 때 바꿔서 받는다
  const relations = (o.relations || []).filter((r) => r && typeof r.id === 'string').map((r) => ({ ...r, id: relCode(r.id) })).filter((r) => LINK_TYPE.test(r.id));
  return {
    classes, relations,
    meta: o.meta && typeof o.meta === 'object' ? o.meta : null,                           // 온톨로지 버전·고친 날·만든 곳(.ttl의 owl:versionInfo …)
    description: Array.isArray(o.description) ? o.description : null,                     // 사람이 읽는 설명 글 [[소제목, [[문장, [참조…]], …]], …]
    rules: Array.isArray(o.rules) ? o.rules.filter((r) => r && r.id && r.label) : [],    // 규칙 선언(SHACL 자리표) — 검사는 ANA의 work-rules.js가

    byId: new Map(classes.map((c) => [c.id, c])),
    lists: classes.filter((c) => c.list).map((c) => c.list),
    explicit: new Map(relations.filter((r) => r.made !== 'derived').map((r) => [r.id, r])),
    derived: relations.filter((r) => r.made === 'derived' && /^[A-Za-z]\w*\.\w+$/.test(r.field || '')),
  };
}
const LINK_TYPE = /^[a-z][A-Za-z0-9]{1,39}$/;   // 관계 코드: OWL 관례 lowerCamelCase
// 옛 UPPER_SNAKE 코드(DUE_ON, MENTIONED_IN) → lowerCamelCase(dueOn, mentionedIn). 이미 camelCase면 그대로
const relCode = (t) => (typeof t === 'string' && /^[A-Z][A-Z0-9_]*$/.test(t) && /[A-Z]/.test(t) ? t.toLowerCase().replace(/_+([a-z0-9])/g, (m, c) => c.toUpperCase()) : t);
const MENTIONED_IN = 'mentionedIn';
const KG = 'kg:';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayId = (d) => `day:${d}`;
const isNewLinkType = (t) => { const W = work(); return typeof t === 'string' && LINK_TYPE.test(t) && !W.explicit.has(t) && !W.derived.some((r) => r.id === t) && t !== MENTIONED_IN; };
const titleOf = (c, x) => { try { if (c.title) return String(c.title(x) || '').slice(0, 120); } catch {} return String(x.title || x.name || String(x.text || '').split('\n')[0] || x.id).slice(0, 120); };
const listOf = (s, c) => (s && Array.isArray(s[c.list]) ? s[c.list] : []);

// 이 id는 어느 업무 종류인가('' = 업무 항목이 아님)
function kindOf(s, id) {
  for (const c of work().classes) if (c.list && listOf(s, c).some((x) => x && x.id === id)) return c.id;
  return '';
}

// 한 그래프. nodes: Map id → {id, kind, title, status}, edges: [{from, to, type, made, src, …}]
//   made: 'explicit'(사람·에이전트가 만든 것) | 'derived'(필드·언급에서 계산)
//   src : 'link'(work-graph.json links[]) | 'field' | 'fact'(knowledge.json facts) | 'mention' — 어디를 고치면 바뀌는지
function build(s, k, docs) {
  const W = work(), nodes = new Map(), edges = [], seen = new Set(), items = new Set();
  const node = (n) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  const edge = (from, to, type, made, src, extra) => {
    if (!nodes.has(from) || !nodes.has(to) || from === to) return;
    const key = `${from}\u0000${to}\u0000${type}`; if (seen.has(key)) return;
    seen.add(key); edges.push({ from, to, type, made, src, ...(extra || {}) });
  };
  // 업무 항목
  for (const c of W.classes) for (const x of listOf(s, c)) if (x && x.id != null) { items.add(String(x.id)); node({ id: String(x.id), kind: c.id, title: titleOf(c, x), status: x.done === true ? 'done' : x.done === false ? 'open' : (x.status ? String(x.status) : '') }); }
  // 필드에서 계산한 연결(날짜 → Day, id → 다른 항목)
  for (const r of W.derived) {
    const [cls, prop] = r.field.split('.'), c = W.byId.get(cls); if (!c || !c.list) continue;
    const toDay = (r.to || []).includes('Day');
    for (const x of listOf(s, c)) {
      for (const v of [].concat(x[prop] == null ? [] : x[prop]).map(String)) {
        if (toDay) { if (!DATE.test(v)) continue; node({ id: dayId(v), kind: 'Day', title: v, status: '' }); edge(String(x.id), dayId(v), r.id, 'derived', 'field'); }
        else edge(String(x.id), v, r.id, 'derived', 'field');
      }
    }
  }
  // 사람·에이전트가 만든 연결
  for (const l of (s && s.links) || []) { const t = relCode(l.type); if (W.explicit.has(t) || isNewLinkType(t)) edge(l.from, l.to, t, 'explicit', 'link', isNewLinkType(t) ? { newType: true } : null); }
  // 문서
  for (const d of (docs && docs.items) || []) node({ id: d.id, kind: 'Document', title: String(d.name || d.id), status: '' });
  // 개체 · 언급 · 사실
  const ent = (k && k.entities) || [], entIds = new Set(ent.map((e) => e.id));
  for (const e of ent) node({ id: KG + e.id, kind: e.class || 'Thing', title: String(e.label || e.id), status: '' });
  for (const e of ent) for (const it of e.items || []) edge(KG + e.id, String(it), MENTIONED_IN, 'derived', 'mention');
  const end = (id) => (entIds.has(id) ? KG + id : items.has(id) ? id : KG + id);   // 개체가 아니면 업무 항목
  const declared = new Set(((k && k.relations) || []).map((r) => relCode(r.id)));
  for (const f of (k && k.facts) || []) { const rel = relCode(f.rel); edge(end(f.from), end(f.to), rel, 'explicit', 'fact', { fact: { from: f.from, rel: f.rel, to: f.to }, ...((f.items || []).length ? { items: f.items } : {}), ...(declared.has(rel) ? {} : { newType: true }) }); }
  return { nodes, edges, items };
}

// build → NodeRel 스냅숏. 같은 원천은 항상 같은 스냅숏(=같은 서명)이 된다.
function snapshot(G, scope) {
  return [{
    nodes: [...G.nodes.values()].map((n) => ({ id: n.id, kind: n.kind, scope, no: '', title: n.title, status: n.status || '', updated_at: '' })),
    edges: G.edges.map((e) => ({ from: e.from, to: e.to, type: e.type, scope, properties: { made: e.made, src: e.src, ...(e.newType ? { newType: true } : {}), ...(e.items ? { items: e.items } : {}) } })),
  }];
}
const signature = (snaps) => crypto.createHash('sha256').update(JSON.stringify(snaps)).digest('hex');
const tally = (arr, key) => arr.reduce((m, x) => m.set(x[key], (m.get(x[key]) || 0) + 1), new Map());
const words = (id) => id.toLowerCase().replace(/_/g, ' ');

function createGraph({ loadData, loadKnowledge, loadDocs, dataFileOf }) {
  const safe = (fn) => { try { return fn ? fn() : null; } catch { return null; } };
  const kOf = (ws) => safe(() => loadKnowledge && loadKnowledge(ws));
  const g = (ws, s) => build(s || loadData(ws), kOf(ws), safe(() => loadDocs && loadDocs(ws)));
  const open = new Map();   // ws → NodeRel (SQLite 핸들은 워크스페이스마다 하나)
  const fileOf = (ws) => path.join(path.dirname(dataFileOf(ws)), 'graph-index.sqlite');
  function handle(ws) { if (!open.has(ws)) open.set(ws, new NodeRel(fileOf(ws))); return open.get(ws); }
  // 원천과 서명이 다르면 다시 만든다. 반환: 최신 NodeRel 핸들과 메모리 그래프
  function ensure(ws, s) {
    const G = g(ws, s), db = handle(ws), snaps = snapshot(G, ws);
    const cur = db.db.prepare("SELECT value FROM sync_meta WHERE key='signature'").get();
    if (!cur || cur.value !== signature(snaps)) db.rebuild(snaps);
    return { db, G };
  }
  function close(ws) { const h = open.get(ws); if (h) { try { h.close(); } catch {} open.delete(ws); } }
  const pub = (r) => r && { id: r.id, kind: r.kind, title: r.title, status: r.status };
  function rows(db, ws) { const m = new Map(); for (const r of db.db.prepare('SELECT id,kind,title,status FROM items WHERE scope=?').all(ws)) m.set(r.id, r); return m; }

  // 화면용(/api/state): 업무 항목끼리의 연결(Day 포함) — Work 화면이 쓴다
  function view(ws, s) {
    const G = g(ws, s), isItem = (id) => G.items.has(id) || id.startsWith('day:');
    return { links: G.edges.filter((e) => (e.src === 'link' || e.src === 'field') && isItem(e.from) && isItem(e.to)).map((e) => ({ from: e.from, to: e.to, type: e.type, ...(e.newType ? { newType: true } : {}) })) };
  }
  function neighbors(ws, id) {
    const { db } = ensure(ws), r = rows(db, ws); if (!r.has(id)) return null;
    return { node: pub(r.get(id)), links: db.neighbors(id, ws).map((l) => {
      const out = l.from_id === id; return { type: l.type, direction: out ? 'out' : 'in', other: pub(r.get(out ? l.to_id : l.from_id)), properties: l.properties };
    }) };
  }
  // NodeRel trace — 시작점을 뺀 닿은 노드들(가까운 순)
  function trace(ws, { id, direction = 'both', maxDepth = 2, types = [] } = {}) {
    const { db } = ensure(ws), r = rows(db, ws); if (!r.has(id)) throw new Error(`not found: ${id}`);
    const depth = Math.max(1, Math.min(6, Math.floor(Number(maxDepth)) || 2));
    return db.trace({ id, scope: ws, direction, maxDepth: depth, types: types || [] }).map((x) => ({ ...pub(r.get(x.id)), depth: x.depth }));
  }
  // 종류별 개수와 '흐름이 끊긴 곳'
  function stats(ws) {
    const { db } = ensure(ws), r = rows(db, ws), st = db.stats(ws), W = work();
    const openOnly = (list) => list.filter((x) => (r.get(x.id) || {}).status !== 'done');   // 끝난 항목은 끊긴 곳으로 세지 않는다(상태가 없는 종류는 모두 센다)
    const newTypes = [...tally(g(ws).edges.filter((e) => e.newType), 'type')].map(([type, count]) => ({ type, count }));
    return {
      kinds: st.kinds, types: st.types, newLinkTypes: newTypes,
      // 흐름이 끊긴 곳 = 선언된 관계마다, 출발 종류의 항목 중 그 관계가 하나도 없는 것(열린 것만) — { dueOn: [{id,title}…], … }
      gaps: Object.fromEntries(W.relations.filter((r) => (r.from || []).length && !r.from.includes('*')).map((r) => [r.id,
        openOnly(r.from.flatMap((kind) => db.orphans({ scope: ws, kind, type: r.id, side: 'out' }))).slice(0, 50)]).filter(([, v]) => v.length)),
    };
  }
  // Knowledge 탭: 한 온톨로지(종류 · 연결 — 선언과 개수)와 한 그래프(노드 · 연결, Day 제외)
  function ontology(ws) {
    const W = work(), k = kOf(ws) || {}, { G } = ensure(ws);
    const nodes = [...G.nodes.values()], kc = tally(nodes, 'kind'), ec = tally(G.edges, 'type');
    const kinds = [], seenK = new Set(), addK = (x) => { if (seenK.has(x.id)) return; seenK.add(x.id); kinds.push({ count: kc.get(x.id) || 0, ...x }); };
    // 종류의 속성(props = Datatype Property)과 표준 정렬(align)도 Ontology 화면에 넘긴다
    for (const c of W.classes) addK({ id: c.id, label: c.label || c.id, desc: c.desc || '', where: c.list ? `work-graph.json → ${c.list}` : 'computed from dates', removable: false, ...(Array.isArray(c.props) ? { props: c.props } : {}), ...(Array.isArray(c.align) ? { align: c.align } : {}) });
    for (const c of k.classes || []) addK({ id: c.id, label: c.label || c.id, desc: c.desc || '', parent: c.parent || '', where: 'knowledge.json', removable: true });
    if (kc.get('Document')) addK({ id: 'Document', label: 'Document', desc: 'A file people added (Knowledge › Documents)', where: 'documents', removable: false });
    for (const [id] of kc) addK({ id, label: id, desc: '', where: 'knowledge.json', removable: false, newType: true });
    // 같은 코드의 선언이 여러 줄이면(Class마다 필드가 달라서) 한 관계로 합쳐 보인다 — Domain·Range·필드를 모은다
    const rels = [], seenR = new Map(), addR = (x) => { const p = seenR.get(x.id); if (p) { if (!x.newType && p.removable === false && x.removable === false) { for (const k of ['from', 'to']) for (const v of x[k] || []) if (!p[k].includes(v)) p[k].push(v); if (x.field && !p.field.split(', ').includes(x.field)) p.field = p.field ? `${p.field}, ${x.field}` : x.field; if (!p.desc && x.desc) p.desc = x.desc; } return; } const r = { count: ec.get(x.id) || 0, field: '', ...x, from: [...(x.from || [])], to: [...(x.to || [])] }; seenR.set(x.id, r); rels.push(r); };
    for (const r of W.relations) addR({ id: r.id, label: r.label || words(r.id), desc: r.desc || '', from: r.from || [], to: r.to || [], made: r.made || 'explicit', field: r.field || '', removable: false, ...(typeof r.functional === 'boolean' ? { functional: r.functional } : {}), ...(Array.isArray(r.align) ? { align: r.align } : {}) });   // functional: true = 하나만(owl:FunctionalProperty)
    for (const r of k.relations || []) addR({ id: relCode(r.id), label: r.label || words(r.id), desc: r.desc || '', from: r.domain ? [r.domain] : ['*'], to: r.range ? [r.range] : ['*'], made: 'explicit', removable: true });
    if (ec.get(MENTIONED_IN)) addR({ id: MENTIONED_IN, label: 'mentioned in', desc: 'The thing appears in this item or document', from: ['*'], to: ['*'], made: 'derived', field: 'items', removable: false });
    for (const [id] of ec) addR({ id, label: words(id), desc: 'Used in the graph but not declared yet', from: [], to: [], made: 'explicit', removable: false, newType: true });
    const linked = new Set(G.edges.flatMap((e) => [e.from, e.to]));
    return {
      kinds, relations: rels, ...(W.meta ? { meta: W.meta } : {}), ...(W.description ? { description: W.description } : {}),
      nodes: nodes.filter((n) => n.kind !== 'Day' && (n.kind !== 'Document' || linked.has(n.id))).map((n) => ({ id: n.id, kind: n.kind, title: n.title, status: n.status })),
      edges: G.edges.filter((e) => !e.to.startsWith('day:')).map((e) => ({ from: e.from, to: e.to, type: e.type, made: e.made, src: e.src, ...(e.fact ? { fact: e.fact } : {}), ...(e.items ? { items: e.items } : {}), ...(e.newType ? { newType: true } : {}) })),
    };
  }
  // AI용 스키마: NodeRel이 관찰한 모양 + 종류·연결 어휘의 뜻(한 목록)
  function describe(ws) {
    const o = ontology(ws), d = describeNodeRel(fileOf(ws));
    return {
      about: 'One graph of this ANA, indexed with NodeRel: work items (work-graph.json, kinds declared in work-ontology.js), days computed from date fields (day:YYYY-MM-DD), things the work is about (knowledge.json, ids kg:<entity id>) and documents (doc-N). Links are made by people and the agent (work-graph.json links[]), computed from fields, facts (knowledge.json — an end may be a work item), and mentionedIn (a thing appears in an item or document).',
      nodeKinds: o.kinds.map((c) => ({ kind: c.id, label: c.label, meaning: c.desc, storedIn: c.where, ...(c.parent ? { parent: c.parent } : {}), count: c.count })),
      vocabulary: Object.fromEntries(o.relations.map((r) => {
        const src = new Set(o.edges.filter((e) => e.type === r.id).map((e) => e.src));
        const editWith = r.made === 'derived' ? 'computed — change the field it comes from' : src.has('fact') || (r.removable && !src.size) ? 'POST /api/knowledge (facts)' : 'POST /api/link';
        return [r.id, { meaning: [r.label, r.desc].filter(Boolean).join(' — '), from: r.from, to: r.to, made: r.made, ...(r.field ? { field: r.field } : {}), editable: r.made !== 'derived', editWith, count: r.count }];
      })),
      observed: (d.scopes || []).filter((x) => x.scope === ws).map(({ nodeKinds, observedRelationships }) => ({ nodeKinds, observedRelationships }))[0] || null,
      how: {
        follow: 'GET /api/graph/neighbors?id= · GET /api/graph/trace?id=&depth=&direction=out|in|both&types=A,B',
        linkItems: 'POST /api/link {action:"add"|"remove", from, to, type} — between work items; a new lowerCamelCase type is kept and shown as new',
        addKnowledge: 'POST /api/knowledge {classes, relations, entities:[{id,label,class,items:[work item ids|doc-N]}], facts:[{from,rel,to,items}]} — a fact end may be a work item id',
        newKindOfWork: 'Keep its items in work-graph.json as one array per kind and declare the kind in work-ontology.js (list, title, and derived relations for fields that point at other items).',
      },
    };
  }
  return { ensure, close, fileOf, view, neighbors, trace, stats, ontology, describe, build: (ws) => g(ws) };
}

// ---- 원천(work-graph.json links[]) 편집 — 라우트가 부른다. 오류면 문자열, 성공이면 null ----
function checkLink(s, { from, to, type }) {
  const W = work(); type = relCode(type);
  if (W.derived.some((r) => r.id === type)) return `${type} is computed from a field — it can't be added by hand`;
  if (!W.explicit.has(type) && !isNewLinkType(type)) return `type: one of ${[...W.explicit.keys()].join('|')}, or a new kind in lowerCamelCase (e.g. blocks)`;
  if (typeof from !== 'string' || typeof to !== 'string' || !from || !to) return 'from and to are required';
  if (from === to) return 'cannot link an item to itself';
  const fk = kindOf(s, from), tk = kindOf(s, to);
  if (!fk || !tk) return 'from/to not found';
  const r = W.explicit.get(type), ok = (list, k) => !list || !list.length || list.includes('*') || list.includes(k);
  if (r && (!ok(r.from, fk) || !ok(r.to, tk))) return `${type} goes ${r.from.join('|')} → ${r.to.join('|')}, not ${fk} → ${tk}`;
  return null;
}
function addLink(s, link, by) {
  const err = checkLink(s, link);
  if (err) return err;
  if (!Array.isArray(s.links)) s.links = [];
  const type = relCode(link.type);
  if (!s.links.some((l) => l.from === link.from && l.to === link.to && relCode(l.type) === type))
    s.links.push({ from: link.from, to: link.to, type, at: new Date().toISOString(), by: by || 'ana' });
  return null;
}
function removeLink(s, { from, to, type }) {
  const before = (s.links || []).length;
  s.links = (s.links || []).filter((l) => !(l.from === from && l.to === to && relCode(l.type) === relCode(type)));
  return s.links.length < before;
}
// 끝점이 사라진 연결은 저장 직전에 걷어낸다(어느 경로로 지웠든).
function pruneLinks(s) {
  if (!Array.isArray(s.links)) { s.links = []; return; }
  const ids = new Set(); for (const c of work().classes) if (c.list) for (const x of listOf(s, c)) if (x) ids.add(String(x.id));
  s.links = s.links.filter((l) => ids.has(l.from) && ids.has(l.to));
  for (const l of s.links) l.type = relCode(l.type);   // 옛 UPPER_SNAKE 코드는 저장할 때 camelCase로 옮겨 적는다
}
const workLists = () => work().lists;
// 시험용: 다른 워크 온톨로지로 바꿔 끼운다(null이면 work-ontology.js로 돌아간다)
const useOntology = (o) => { override = o ? norm(o) : null; };

module.exports = { createGraph, build, checkLink, addLink, removeLink, pruneLinks, kindOf, isNewLinkType, workLists, work, useOntology, relCode, MENTIONED_IN };
