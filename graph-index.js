'use strict';
// graph-index.js — 워크와 지식을 한 그래프로. 의존성 없이 메모리에서 계산한다(파일·캐시 없음).
//
// 층 셋이 한 그래프에 들어간다:
//   work      업무 항목 — work-graph.json의 배열(종류는 work-ontology.js가 선언) + 연결
//             explicit: links[] (SPAWNED · SCHEDULED_AS · REFERS_TO · 새 종류 BLOCKS…)
//             derived : 필드에서 계산(Task.due → DUE_ON Day, Quote.lead → QUOTE_FOR Lead …)
//   knowledge 지식 — knowledge.json의 개체(id `kg:<개체 id>`)와 사실(관계 id가 연결 종류)
//             사실의 끝점이 개체가 아니라 업무 항목 id면 그 항목에 바로 잇는다(지식 ↔ 워크)
//   mention   개체 ─MENTIONED_IN─▶ 업무 항목 | 문서(doc-N) — 개체의 items에서
// 그래서 메모 하나에서 출발해 그 안의 개체, 개체 사이의 사실, 그 사실이 가리키는 다른 업무까지 /api/graph/trace 한 번으로 따라간다.

const fs = require('node:fs');
const path = require('node:path');

// work-ontology.js는 에이전트가 고친다 — 바뀌면 서버를 다시 띄우지 않아도 다음 읽기에서 새로 읽는다.
const ONTO_FILE = path.join(__dirname, 'work-ontology.js');
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
  // 0.21 전의 선언(list 없음)도 읽는다 — 메모·할일·일정은 원래 배열 이름으로
  const OLD = { Note: 'notes', Task: 'items', Event: 'events' };
  for (const c of classes) if (!c.list && OLD[c.id]) c.list = OLD[c.id];
  const relations = (o.relations || []).filter((r) => r && /^[A-Z][A-Z0-9_]{1,39}$/.test(r.id));
  return {
    classes, relations,
    byId: new Map(classes.map((c) => [c.id, c])),
    lists: classes.filter((c) => c.list).map((c) => c.list),
    explicit: new Map(relations.filter((r) => r.made !== 'derived').map((r) => [r.id, r])),
    derived: relations.filter((r) => r.made === 'derived' && /^[A-Za-z]\w*\.\w+$/.test(r.field || '')),
  };
}
const LINK_TYPE = /^[A-Z][A-Z0-9_]{1,39}$/;
const MENTIONED_IN = 'MENTIONED_IN';
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

// 세 층을 한 그래프로. nodes: Map id → {id, kind, layer, title, status}, edges: [{from, to, type, layer, made}]
function build(s, k, docs) {
  const W = work(), nodes = new Map(), edges = [], seen = new Set();
  const node = (n) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  const edge = (from, to, type, layer, made, extra) => {
    if (!nodes.has(from) || !nodes.has(to) || from === to) return;
    const key = `${from}\u0000${to}\u0000${type}`; if (seen.has(key)) return;
    seen.add(key); edges.push({ from, to, type, layer, made, ...(extra || {}) });
  };
  // 워크: 항목
  for (const c of W.classes) for (const x of listOf(s, c)) if (x && x.id != null) node({ id: String(x.id), kind: c.id, layer: 'work', title: titleOf(c, x), status: x.done === true ? 'done' : x.done === false ? 'open' : (x.status ? String(x.status) : '') });
  // 워크: 필드에서 계산한 연결(날짜 → Day, id → 다른 항목)
  for (const r of W.derived) {
    const [cls, prop] = r.field.split('.'), c = W.byId.get(cls); if (!c || !c.list) continue;
    const toDay = (r.to || []).includes('Day');
    for (const x of listOf(s, c)) {
      const vals = [].concat(x[prop] == null ? [] : x[prop]).map(String);
      for (const v of vals) {
        if (toDay) { if (!DATE.test(v)) continue; node({ id: dayId(v), kind: 'Day', layer: 'day', title: v, status: '' }); edge(String(x.id), dayId(v), r.id, 'work', 'derived'); }
        else edge(String(x.id), v, r.id, 'work', 'derived');
      }
    }
  }
  // 워크: 명시한 연결
  for (const l of (s && s.links) || []) if (W.explicit.has(l.type) || isNewLinkType(l.type)) edge(l.from, l.to, l.type, 'work', 'explicit', isNewLinkType(l.type) ? { newType: true } : null);
  // 문서
  for (const d of (docs && docs.items) || []) node({ id: d.id, kind: 'Document', layer: 'document', title: String(d.name || d.id), status: '' });
  // 지식: 개체 · 언급 · 사실
  const ent = (k && k.entities) || [], entIds = new Set(ent.map((e) => e.id));
  for (const e of ent) node({ id: KG + e.id, kind: e.class || 'Thing', layer: 'knowledge', title: String(e.label || e.id), status: '' });
  for (const e of ent) for (const it of e.items || []) edge(KG + e.id, String(it), MENTIONED_IN, 'mention', 'derived');
  const end = (id) => (entIds.has(id) ? KG + id : nodes.has(id) && nodes.get(id).layer === 'work' ? id : KG + id);   // 개체가 아니면 업무 항목
  for (const f of (k && k.facts) || []) edge(end(f.from), end(f.to), f.rel, 'knowledge', 'explicit', (f.items || []).length ? { items: f.items } : null);
  return { nodes, edges };
}

function createGraph({ loadData, loadKnowledge, loadDocs }) {
  const safe = (fn) => { try { return fn ? fn() : null; } catch { return null; } };
  const g = (ws, s) => build(s || loadData(ws), safe(() => loadKnowledge && loadKnowledge(ws)), safe(() => loadDocs && loadDocs(ws)));
  const pub = (n) => n && { id: n.id, kind: n.kind, layer: n.layer, title: n.title, status: n.status };

  // 화면용(/api/state): 워크 층의 연결(명시한 것 + 필드에서 계산한 것, Day 포함)
  function view(ws, s) {
    return { links: g(ws, s).edges.filter((e) => e.layer === 'work').map((e) => ({ from: e.from, to: e.to, type: e.type, ...(e.newType ? { newType: true } : {}) })) };
  }
  function neighbors(ws, id) {
    const { nodes, edges } = g(ws); if (!nodes.has(id)) return null;
    return { node: pub(nodes.get(id)), links: edges.filter((e) => e.from === id || e.to === id).map((e) => {
      const out = e.from === id; return { type: e.type, layer: e.layer, direction: out ? 'out' : 'in', other: pub(nodes.get(out ? e.to : e.from)), ...(e.items ? { items: e.items } : {}) };
    }) };
  }
  // 너비 우선으로 maxDepth까지. 반환: 시작점을 뺀 닿은 노드들(가까운 순) + 어떻게 닿았는지
  function trace(ws, { id, direction = 'both', maxDepth = 2, types = [] } = {}) {
    const { nodes, edges } = g(ws); if (!nodes.has(id)) throw new Error(`not found: ${id}`);
    const depthMax = Math.max(1, Math.min(6, Number(maxDepth) || 2)), only = new Set(types || []);
    const out = [], seen = new Set([id]); let frontier = [id];
    for (let d = 1; d <= depthMax && frontier.length; d++) {
      const next = [];
      for (const cur of frontier) for (const e of edges) {
        if (only.size && !only.has(e.type)) continue;
        const fwd = e.from === cur && direction !== 'in', back = e.to === cur && direction !== 'out';
        const other = fwd ? e.to : back ? e.from : null;
        if (!other || seen.has(other)) continue;
        seen.add(other); next.push(other); out.push({ ...pub(nodes.get(other)), depth: d, via: { from: cur, type: e.type, direction: fwd ? 'out' : 'in' } });
      }
      frontier = next;
    }
    return out;
  }
  // 종류별 개수와 '흐름이 끊긴 곳'
  function stats(ws) {
    const s = loadData(ws), { nodes, edges } = g(ws, s);
    const count = (arr, key) => Object.entries(arr.reduce((m, x) => ((m[x[key]] = (m[x[key]] || 0) + 1), m), {})).map(([k, n]) => ({ [key]: k, count: n }));
    const wn = [...nodes.values()].filter((n) => n.layer === 'work' || n.layer === 'day'), we = edges.filter((e) => e.layer === 'work');
    const has = (id, type, side) => edges.some((e) => e.type === type && (side === 'out' ? e.from : e.to) === id);
    const brief = (n) => ({ id: n.id, title: n.title });
    const W = work();
    return {
      kinds: count(wn, 'kind'), types: count(we, 'type'),
      newLinkTypes: count(we.filter((e) => e.newType), 'type'),
      kg: { entities: [...nodes.values()].filter((n) => n.layer === 'knowledge').length, facts: edges.filter((e) => e.layer === 'knowledge').length, mentions: edges.filter((e) => e.layer === 'mention').length },
      gaps: W.byId.has('Note') && W.byId.has('Task') ? {
        notesUnused: wn.filter((n) => n.kind === 'Note' && !has(n.id, 'SPAWNED', 'out')).map(brief),
        tasksNoDue: wn.filter((n) => n.kind === 'Task' && n.status === 'open' && !has(n.id, 'DUE_ON', 'out')).map(brief),
        tasksUnscheduled: wn.filter((n) => n.kind === 'Task' && n.status === 'open' && !has(n.id, 'SCHEDULED_AS', 'out')).map(brief),
      } : {},
    };
  }
  // Knowledge 탭의 워크 층: 종류·연결의 선언과 개수, 항목과 연결(Day 제외)
  function workLayer(ws) {
    const W = work(), { nodes, edges } = g(ws);
    const items = [...nodes.values()].filter((n) => n.layer === 'work');
    const links = edges.filter((e) => e.layer === 'work' && !e.to.startsWith('day:'));
    return {
      classes: W.classes.map((c) => ({ id: c.id, label: c.label || c.id, desc: c.desc || '', list: c.list || '', count: c.id === 'Day' ? [...nodes.values()].filter((n) => n.kind === 'Day').length : items.filter((n) => n.kind === c.id).length })),
      relations: W.relations.map((r) => ({ id: r.id, label: r.label || r.id.toLowerCase().replace(/_/g, ' '), desc: r.desc || '', from: r.from || [], to: r.to || [], made: r.made || 'explicit', field: r.field || '', count: edges.filter((e) => e.type === r.id).length }))
        .concat(count(edges.filter((e) => e.newType)).map(([t, n]) => ({ id: t, label: t.toLowerCase().replace(/_/g, ' '), desc: 'Used in links but not declared in work-ontology.js yet', from: [], to: [], made: 'explicit', field: '', count: n, newType: true }))),
      items: items.map((n) => ({ id: n.id, kind: n.kind, label: n.title, status: n.status })),
      links: links.map((e) => ({ from: e.from, to: e.to, type: e.type, made: e.made })),
    };
  }
  const count = (arr) => Object.entries(arr.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {}));
  // AI용 스키마: 층·노드 종류·연결 어휘와 그 뜻, 실제 개수
  function describe(ws) {
    const W = work(), k = safe(() => loadKnowledge && loadKnowledge(ws)) || {}, { nodes, edges } = g(ws);
    const nCount = (kind) => [...nodes.values()].filter((n) => n.kind === kind).length, eCount = (t) => edges.filter((e) => e.type === t).length;
    const kc = k.classes || [], kr = k.relations || [];
    return {
      about: 'One graph of this ANA: work items and their links (work-ontology.js + work-graph.json) and the knowledge about them (knowledge.json), joined by MENTIONED_IN and by facts whose end is a work item.',
      layers: { work: 'work items (ids as stored)', day: 'calendar days computed from date fields (day:YYYY-MM-DD)', knowledge: 'entities (kg:<entity id>)', document: 'documents people added (doc-N)' },
      nodeKinds: [
        ...W.classes.map((c) => ({ kind: c.id, layer: c.list ? 'work' : 'day', label: c.label || c.id, meaning: c.desc || '', storedIn: c.list ? `work-graph.json → ${c.list}[]` : 'computed', count: nCount(c.id) })),
        ...kc.map((c) => ({ kind: c.id, layer: 'knowledge', label: c.label || c.id, meaning: c.desc || '', parent: c.parent || '', storedIn: 'knowledge.json → entities[]', count: nCount(c.id) })),
        { kind: 'Document', layer: 'document', meaning: 'A file people added (Knowledge › Documents)', count: nCount('Document') },
      ],
      vocabulary: {
        ...Object.fromEntries(W.relations.map((r) => [r.id, { layer: 'work', meaning: r.desc || '', from: r.from, to: r.to, made: r.made || 'explicit', ...(r.field ? { field: r.field } : {}), editable: r.made !== 'derived', count: eCount(r.id) }])),
        ...Object.fromEntries(kr.map((r) => [r.id, { layer: 'knowledge', meaning: [r.label, r.desc].filter(Boolean).join(' — '), from: [r.domain || 'any'], to: [r.range || 'any'], editable: false, count: eCount(r.id) }])),
        [MENTIONED_IN]: { layer: 'mention', meaning: 'The entity appears in this work item or document (from the entity\'s items)', from: ['<entity>'], to: ['<work item>', 'Document'], editable: false, count: eCount(MENTIONED_IN) },
      },
      how: {
        follow: 'GET /api/graph/neighbors?id= · GET /api/graph/trace?id=&depth=&direction=out|in|both&types=A,B',
        linkWork: 'POST /api/link {action:"add"|"remove", from, to, type} — work items only; a new UPPER_SNAKE type is kept and shown as new',
        addKnowledge: 'POST /api/knowledge {classes, relations, entities:[{id,label,class,items:[work item ids|doc-N]}], facts:[{from,rel,to,items}]} — a fact end may be a work item id',
        newKindOfWork: 'Keep its items in work-graph.json as one array per kind and declare the kind in work-ontology.js (list, title, and derived relations for fields that point at other items).',
      },
    };
  }
  return { view, neighbors, trace, stats, workLayer, describe, build: (ws) => g(ws) };
}

// ---- 원천(work-graph.json links[]) 편집 — 라우트가 부른다. 오류면 문자열, 성공이면 null ----
function checkLink(s, { from, to, type }) {
  const W = work();
  if (W.derived.some((r) => r.id === type)) return `${type} is computed from a field — it can't be added by hand`;
  if (!W.explicit.has(type) && !isNewLinkType(type)) return `type: one of ${[...W.explicit.keys()].join('|')}, or a new kind in UPPER_SNAKE_CASE (e.g. BLOCKS)`;
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
  if (!s.links.some((l) => l.from === link.from && l.to === link.to && l.type === link.type))
    s.links.push({ from: link.from, to: link.to, type: link.type, at: new Date().toISOString(), by: by || 'ana' });
  return null;
}
function removeLink(s, { from, to, type }) {
  const before = (s.links || []).length;
  s.links = (s.links || []).filter((l) => !(l.from === from && l.to === to && l.type === type));
  return s.links.length < before;
}
// 끝점이 사라진 연결은 저장 직전에 걷어낸다(어느 경로로 지웠든).
function pruneLinks(s) {
  if (!Array.isArray(s.links)) { s.links = []; return; }
  const ids = new Set(); for (const c of work().classes) if (c.list) for (const x of listOf(s, c)) if (x) ids.add(String(x.id));
  s.links = s.links.filter((l) => ids.has(l.from) && ids.has(l.to));
}
const workLists = () => work().lists;
// 시험용: 다른 워크 온톨로지로 바꿔 끼운다(null이면 work-ontology.js로 돌아간다)
const useOntology = (o) => { override = o ? norm(o) : null; };

module.exports = { createGraph, build, checkLink, addLink, removeLink, pruneLinks, kindOf, isNewLinkType, workLists, work, useOntology, MENTIONED_IN };
