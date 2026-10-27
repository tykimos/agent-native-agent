'use strict';
// graph-index.js — NodeRel 색인: 워크 그래프(메모·할일·일정과 그 연결)와 지식그래프를 한 색인(graph-index.sqlite)에. NodeRel(github:tykimos/NodeRel) 위에 얹는다.
//
// 진실원천은 워크스페이스의 work-graph.json이다(items·events·notes + 명시적 links[]). graph-index.sqlite는
// NodeRel이 거기서 만든 파생 인덱스라 언제 지워도 다시 만들어진다. 읽을 때마다 스냅숏 서명을
// 비교해 달라졌으면 rebuild한다 — 쓰기 경로(수동 라우트·에이전트 diff·파일 직접 수정)를 가리지 않는다.
//
// 관계 어휘(흐름형):
//   Note ─SPAWNED──────▶ Task | Event    메모에서 나온 할일·일정            (명시)
//   Task ─SCHEDULED_AS─▶ Event           할일을 실제로 할 시간을 잡은 일정  (명시)
//   Note|Task|Event ─REFERS_TO─▶ Note|Task|Event   수동 참조              (명시)
//   Task ─DUE_ON─▶ Day,  Event ─ON─▶ Day           due/date 필드에서 파생 (자동)
//
// 지식그래프(워크스페이스의 knowledge-graph.json — 분석 결과를 승인해 쌓은 것)도 같은 스코프에 얹는다 — 개체는 id `kg:<개체 id>`, kind는 온톨로지 클래스,
// 사실은 온톨로지 관계 id를 타입으로, 근거는 개체 ─MENTIONED_IN─▶ Note|Task|Event. 그래서 메모 하나에서 출발해
// 그 안의 개체와 개체 사이의 사실까지 /api/graph/trace 한 번으로 따라갈 수 있다. 원천은 knowledge-graph.json, 틀은 지식 온톨로지다.

const path = require('node:path');
const crypto = require('node:crypto');
// node:sqlite는 처음 불러올 때 'SQLite is an experimental feature' 경고를 한 번 찍는다. NodeRel을 불러오는 동안만
// 그 경고 하나를 걸러 낸다(다른 경고는 그대로 통과, 불러온 뒤에는 원래 emitWarning으로 되돌린다).
const { NodeRel, describeNodeRel } = (() => {
  const emit = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const type = typeof rest[0] === 'string' ? rest[0] : (rest[0] && rest[0].type) || (warning && warning.name);
    if (type === 'ExperimentalWarning' && /SQLite/i.test(String((warning && warning.message) || warning))) return;
    return emit.call(this, warning, ...rest);
  };
  try {
    return { NodeRel: require('@tykimos/noderel').NodeRel, describeNodeRel: require('@tykimos/noderel/describe').describeNodeRel };
  } finally { process.emitWarning = emit; }
})();

// 어휘는 work-ontology.js(워크 종류 — 온톨로지의 워크 층)에서 읽는다. 여기서 따로 적지 않는다.
const WORK = require('./work-ontology.js');
const RULES = Object.fromEntries(WORK.relations.filter((r) => r.made === 'explicit').map((r) => [r.id, { from: r.from, to: r.to }]));
const EXPLICIT = Object.keys(RULES);
const MEANINGS = Object.fromEntries(WORK.relations.map((r) => [r.id, r.desc]));
const BASE_KINDS = new Set(WORK.classes.map((c) => c.id));
// 워크 연결은 렌즈: 워크 종류에 없는 새 연결 종류(BLOCKS 등)도 저장하고 '아직 워크 종류에 없음'으로 보인다. 쓰임이 쌓이면 Evolve의 근거.
// 워크 종류에 있는 연결은 From → To를 지킨다(앱 기능이 그 뜻으로 읽는다). 날짜에서 계산하는 연결은 손으로 못 만든다.
const LINK_TYPE = /^[A-Z][A-Z0-9_]{1,39}$/;
const DERIVED = new Set(WORK.relations.filter((r) => r.made === 'derived').map((r) => r.id));
const isNewLinkType = (t) => typeof t === 'string' && LINK_TYPE.test(t) && !(t in RULES) && !DERIVED.has(t) && t !== 'MENTIONED_IN' && !t.startsWith('KG_');
const BASE_TYPES = new Set(Object.keys(MEANINGS));
const KG_PREFIX = 'kg:';
const kgKind = (c) => (!c ? 'Entity' : BASE_KINDS.has(c) ? `${c}Entity` : c);          // 기본 kind와 겹치지 않게
const kgType = (r) => (BASE_TYPES.has(r) || r === 'MENTIONED_IN' ? `kg_${r}` : r);
const KG_MENTIONED = 'The knowledge-graph entity was found in this note, task or event (derived from the latest analysis)';
const TITLES = Object.fromEntries(WORK.classes.map((c) => [c.id, c.title || c.desc]));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayId = (d) => `day:${d}`;

function kindOf(s, id) {
  if (s.items.some((x) => x.id === id)) return 'Task';
  if (s.events.some((x) => x.id === id)) return 'Event';
  if (s.notes.some((x) => x.id === id)) return 'Note';
  return '';
}
const noteTitle = (n) => (n.title || '').trim() || (n.text || '').trim().split('\n')[0].slice(0, 60) || 'Untitled';

// state → NodeRel 스냅숏. 같은 state는 항상 같은 스냅숏(=같은 서명)이 되도록 순서를 원본 배열 순서로 고정한다.
function snapshot(s, scope, kg) {
  const nodes = [], edges = [], days = new Set(), seen = new Set(), ids = new Set();
  const node = (n) => { if (!ids.has(n.id)) { ids.add(n.id); nodes.push(n); } };   // 중복 id는 첫 항목만(rebuild가 던지지 않게)
  const edge = (from, to, type, properties) => {
    const k = `${from}\u0000${to}\u0000${type}`;
    if (seen.has(k)) return;
    seen.add(k); edges.push({ from, to, type, scope, properties: properties || {} });
  };
  for (const t of s.items) {
    node({ id: t.id, kind: 'Task', scope, no: t.due || '', title: String(t.title || t.text || ''), status: t.done ? 'done' : 'open', updated_at: '' });
    if (DATE.test(t.due || '')) { days.add(t.due); edge(t.id, dayId(t.due), 'DUE_ON'); }
  }
  for (const e of s.events) {
    node({ id: e.id, kind: 'Event', scope, no: `${e.date || ''}${e.time ? ' ' + e.time : ''}`, title: String(e.title || ''), status: e.done ? 'done' : 'open', updated_at: '' });
    if (DATE.test(e.date || '')) { days.add(e.date); edge(e.id, dayId(e.date), 'ON'); }
  }
  for (const n of s.notes) node({ id: n.id, kind: 'Note', scope, no: '', title: noteTitle(n), status: '', updated_at: n.updatedAt || '' });
  for (const d of [...days].sort()) node({ id: dayId(d), kind: 'Day', scope, no: d, title: d, status: '', updated_at: '' });
  for (const l of s.links || []) if (EXPLICIT.includes(l.type) || isNewLinkType(l.type)) edge(l.from, l.to, l.type, { ...(l.at ? { at: l.at } : {}), ...(isNewLinkType(l.type) ? { newType: true } : {}) });
  if (kg && kg.graph) {
    const g = kg.graph;
    for (const e of g.entities || []) node({ id: KG_PREFIX + e.id, kind: kgKind(e.class), scope, no: kg.job === 'kg' ? 'knowledge graph' : `analysis #${kg.job}`, title: String(e.label || e.id), status: '', updated_at: '' });
    for (const e of g.entities || []) for (const src of e.sources || []) if (ids.has(src)) edge(KG_PREFIX + e.id, src, 'MENTIONED_IN');
    for (const f of g.facts || []) edge(KG_PREFIX + f.from, KG_PREFIX + f.to, kgType(f.rel), { ...(f.sources && f.sources.length ? { sources: f.sources } : {}), ...(f.inferred ? { inferred: true, rule: f.rule } : {}) });   // 규칙 추론한 사실은 표시해서
  }
  return [{ nodes, edges }];
}
const signature = (snaps) => crypto.createHash('sha256').update(JSON.stringify(snaps)).digest('hex');

function createGraph({ loadData, dataFileOf, loadKg }) {
  const kgOf = (ws) => { try { return loadKg ? loadKg(ws) : null; } catch { return null; } };
  const open = new Map();   // ws → NodeRel (SQLite 핸들은 워크스페이스마다 하나)
  const fileOf = (ws) => path.join(path.dirname(dataFileOf(ws)), 'graph-index.sqlite');
  function handle(ws) {
    if (!open.has(ws)) open.set(ws, new NodeRel(fileOf(ws)));
    return open.get(ws);
  }
  // 원천과 서명이 다르면 다시 만든다. 반환: 최신 NodeRel 핸들.
  function ensure(ws, s) {
    const g = handle(ws);
    const snaps = snapshot(s || loadData(ws), ws, kgOf(ws));
    const cur = g.db.prepare("SELECT value FROM sync_meta WHERE key='signature'").get();
    if (!cur || cur.value !== signature(snaps)) g.rebuild(snaps);
    return g;
  }
  // 워크스페이스를 지울 때 파일 핸들을 먼저 닫는다.
  function close(ws) { const g = open.get(ws); if (g) { try { g.close(); } catch {} open.delete(ws); } }

  // 화면용: 스코프 전체 관계(Day 제외 노드 정보는 클라이언트가 이미 가지고 있다)
  function view(ws, s) {
    const g = ensure(ws, s);
    const { links } = g.graph(ws);
    const extra = new Set(((s || loadData(ws)).links || []).map((l) => l.type).filter(isNewLinkType));   // 지식그래프 사실과 섞이지 않게 원천(work-graph.json)에서
    return { links: links.filter((l) => BASE_TYPES.has(l.type) || extra.has(l.type)).map((l) => ({ from: l.from_id, to: l.to_id, type: l.type, ...(BASE_TYPES.has(l.type) ? {} : { newType: true }) })) };
  }
  function nodeRows(g, ws) {
    const m = new Map();
    for (const r of g.db.prepare('SELECT id,kind,no,title,status FROM items WHERE scope=?').all(ws)) m.set(r.id, r);
    return m;
  }
  function neighbors(ws, id) {
    const g = ensure(ws), rows = nodeRows(g, ws);
    if (!rows.has(id)) return null;
    return {
      node: rows.get(id),
      links: g.neighbors(id, ws).map((l) => {
        const out = l.from_id === id, other = rows.get(out ? l.to_id : l.from_id);
        return { type: l.type, direction: out ? 'out' : 'in', other, properties: l.properties };
      }),
    };
  }
  function trace(ws, opts) {
    const g = ensure(ws);
    return g.trace({ id: opts.id, scope: ws, direction: opts.direction || 'both', maxDepth: opts.maxDepth ?? 2, types: opts.types || [] });
  }
  // 통계 탭: 관계 종류별 개수 + '흐름이 끊긴 곳'
  function stats(ws) {
    const g = ensure(ws), rows = nodeRows(g, ws);
    const st = g.stats(ws);
    const openOnly = (list) => list.filter((x) => (rows.get(x.id) || {}).status === 'open');
    const extra = new Set((loadData(ws).links || []).map((l) => l.type).filter(isNewLinkType));   // 워크 쪽의 새 연결 종류
    const isWork = (t) => BASE_TYPES.has(t) || extra.has(t);
    const kgKinds = st.kinds.filter((k) => !BASE_KINDS.has(k.kind)), kgTypes = st.types.filter((t) => !isWork(t.type));
    return {
      kinds: st.kinds.filter((k) => BASE_KINDS.has(k.kind)), types: st.types.filter((t) => isWork(t.type)),
      newLinkTypes: st.types.filter((t) => extra.has(t.type)),
      kg: { entities: kgKinds.reduce((n, k) => n + k.count, 0), facts: kgTypes.filter((t) => t.type !== 'MENTIONED_IN').reduce((n, t) => n + t.count, 0) },
      gaps: {
        notesUnused: g.orphans({ scope: ws, kind: 'Note', type: 'SPAWNED', side: 'out' }),
        tasksNoDue: openOnly(g.orphans({ scope: ws, kind: 'Task', type: 'DUE_ON', side: 'out' })),
        tasksUnscheduled: openOnly(g.orphans({ scope: ws, kind: 'Task', type: 'SCHEDULED_AS', side: 'out' })),
      },
    };
  }
  // AI용 스키마 — NodeRel이 관찰한 모양에 이 앱의 관계 의미를 덧입힌다.
  function describe(ws) {
    ensure(ws);
    const d = describeNodeRel(fileOf(ws));
    d.provenance.businessMeanings = 'Supplied by the ANA base for its Notes/Tasks/Calendar graph; knowledge-graph kinds and relations come from the latest Relations analysis ontology.';
    const kg = kgOf(ws), o0 = (kg && kg.ontology) || { classes: [], relations: [] };
    const o = { classes: o0.classes.filter((c) => c.source !== 'work'), relations: o0.relations.filter((r) => r.source !== 'work') };   // 워크 층(Note·SPAWNED…)은 위 기본 어휘가 이미 설명한다
    const clsDesc = new Map(o.classes.map((c) => [kgKind(c.id), c.desc || c.label])), relDesc = new Map(o.relations.map((r) => [kgType(r.id), r]));
    d.scopes = d.scopes.filter((x) => x.scope === ws).map((sc) => ({
      ...sc,
      nodeKinds: sc.nodeKinds.map((k) => ({ ...k, titleMeaning: TITLES[k.kind] || (clsDesc.has(k.kind) || !BASE_KINDS.has(k.kind) ? `Knowledge-graph entity label (class ${k.kind}${clsDesc.get(k.kind) ? ': ' + clsDesc.get(k.kind) : ''}); id is kg:<entity id>` : k.titleMeaning) })),
      observedRelationships: sc.observedRelationships.map((r) => ({ ...r, meaning: MEANINGS[r.type] || (r.type === 'MENTIONED_IN' ? KG_MENTIONED : relDesc.has(r.type) ? `Knowledge-graph fact: ${relDesc.get(r.type).label}${relDesc.get(r.type).desc ? ' — ' + relDesc.get(r.type).desc : ''}` : r.meaning) })),
    }));
    d.vocabulary = Object.fromEntries(Object.entries(MEANINGS).map(([t, m]) => [t, { meaning: m, ...(RULES[t] ? { from: RULES[t].from, to: RULES[t].to, editable: true } : { editable: false }) }]));
    if (kg) {
      d.vocabulary.MENTIONED_IN = { meaning: KG_MENTIONED, from: ['<entity>'], to: ['Note', 'Task', 'Event'], editable: false };
      for (const r of o.relations) d.vocabulary[kgType(r.id)] = { meaning: [r.label, r.desc].filter(Boolean).join(' — '), from: [r.domain || 'any'], to: [r.range || 'any'], editable: false, source: `analysis #${kg.job}` };
      d.knowledgeGraph = { source: kg.job === 'kg' ? 'knowledge-graph.json (approved analyses)' : `analysis #${kg.job}`, classes: o.classes.map((c) => ({ kind: kgKind(c.id), label: c.label, parent: c.parent ? kgKind(c.parent) : '', desc: c.desc })),
        note: 'Entities have ids kg:<entity id>. They grow when an analysis is approved into the knowledge graph (Graph › Knowledge › Analyze); change them there, not with /api/link.' };
    }
    return d;
  }
  return { ensure, close, view, neighbors, trace, stats, describe, fileOf };
}

// ---- 원천(state.links) 편집 — 라우트가 부른다. 오류면 문자열, 성공이면 null ----
function checkLink(s, { from, to, type }) {
  if (DERIVED.has(type)) return `${type} is computed from dates — it can't be added by hand`;
  if (!EXPLICIT.includes(type) && !isNewLinkType(type)) return `type: one of ${EXPLICIT.join('|')}, or a new kind in UPPER_SNAKE_CASE (e.g. BLOCKS)`;
  if (typeof from !== 'string' || typeof to !== 'string' || !from || !to) return 'from and to are required';
  if (from === to) return 'cannot link an item to itself';
  const fk = kindOf(s, from), tk = kindOf(s, to);
  if (!fk || !tk) return 'from/to not found';
  if (RULES[type] && (!RULES[type].from.includes(fk) || !RULES[type].to.includes(tk))) return `${type} goes ${RULES[type].from.join('|')} → ${RULES[type].to.join('|')}, not ${fk} → ${tk}`;
  return null;
}
function addLink(s, link, by) {
  const err = checkLink(s, link);
  if (err) return err;
  if (!Array.isArray(s.links)) s.links = [];
  if (!s.links.some((l) => l.from === link.from && l.to === link.to && l.type === link.type))
    s.links.push({ from: link.from, to: link.to, type: link.type, at: new Date().toISOString(), by: by || 'ana' });
  return null;
}
function removeLink(s, { from, to, type }) {
  const before = (s.links || []).length;
  s.links = (s.links || []).filter((l) => !(l.from === from && l.to === to && l.type === type));
  return s.links.length < before;
}
// 끝점이 사라진 관계는 저장 직전에 걷어낸다(어느 경로로 지웠든).
function pruneLinks(s) {
  if (!Array.isArray(s.links)) { s.links = []; return; }
  const ids = new Set([...s.items, ...s.events, ...s.notes].map((x) => x.id));
  s.links = s.links.filter((l) => ids.has(l.from) && ids.has(l.to));
}

module.exports = { createGraph, snapshot, checkLink, addLink, removeLink, pruneLinks, kindOf, isNewLinkType, EXPLICIT, RULES, MEANINGS };
