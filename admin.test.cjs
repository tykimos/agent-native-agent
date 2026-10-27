// 역할(관리자·실무자)과 관리자 함: 실무자가 관리자 전용 동작을 하면 403 needsAdmin, 관리자 함에 승인요청·실행 요청,
// 진화 제안의 시스템/워크스페이스 범위와 승격, 점검 risk → 실행 요청
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const net = require('node:net');

async function startServer(env, prepare) {
  const port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ana-admin-'));
  if (prepare) { fs.mkdirSync(path.join(tmp, 'data'), { recursive: true }); prepare(path.join(tmp, 'data')); }
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: String(port), BIND: '127.0.0.1', ANA_DATA_DIR: path.join(tmp, 'data'),
    EVOLVE_FILE: path.join(tmp, 'data', 'evolve.json'), ANA_SEED: '0', NOTIFY_AGENT: '0', TMUX_SOCKET: 'ana-none-admin', ...env }, stdio: 'ignore' });
  const api = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(api + '/api/state')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  if (child.exitCode !== null) throw new Error('the test server exited at start — check that the code loads');
  return { api, stop: async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); } fs.rmSync(tmp, { recursive: true, force: true }); } };   // 이미 죽은 서버를 기다리며 멈추지 않게
}

test('roles, admin inbox, evolve scope', async (t) => {
  const { api, stop } = await startServer({ ANA_IDENTITY_HEADER: 'x-user', ANA_ADMINS: 'boss@x.com' });
  t.after(stop);
  const as = (user) => ({
    get: (p) => fetch(api + p, { headers: user ? { 'x-user': user } : {} }).then((r) => r.json()),
    post: (p, b) => fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) }, body: JSON.stringify(b) }),
  });
  const boss = as('boss@x.com'), kim = as('kim@x.com'), local = as('');
  assert.equal((await boss.get('/api/me')).role, 'admin');
  assert.equal((await kim.get('/api/me')).role, 'member');
  assert.equal((await local.get('/api/me')).role, 'admin', '신원 없는 로컬 호출(이 컴퓨터의 사람·에이전트)은 관리자');

  // 진화 제안: 범위
  await local.post('/api/evolve', { proposals: [{ title: 'Sys change', type: 'add' }, { title: 'Tidy notes', type: 'improve', scope: 'workspace' }] });
  const sys = (await kim.get('/api/evolve?scope=system')).proposals, wsp = (await kim.get('/api/evolve?scope=workspace')).proposals;
  assert.deepEqual([sys.map((x) => x.title), wsp.map((x) => x.title), wsp[0].ws], [['Sys change'], ['Tidy notes'], 'default']);
  // 실무자: 시스템 제안 시작 불가(403 needsAdmin), 워크스페이스 제안은 가능
  let r = await kim.post('/api/evolve-act', { id: sys[0].id, action: 'do' }); assert.equal(r.status, 403); assert.equal((await r.json()).needsAdmin, true);
  assert.equal((await kim.post('/api/evolve-act', { id: wsp[0].id, action: 'do' })).status, 200);
  // 승격
  const up = await (await kim.post('/api/evolve-act', { id: wsp[0].id, action: 'escalate' })).json();
  assert.equal(up.proposal.scope, 'system'); assert.equal(up.proposal.fromId, wsp[0].id);
  assert.equal((await (await kim.post('/api/evolve-act', { id: wsp[0].id, action: 'escalate' })).json()).existing, true, '열린 승격은 하나');
  // 관리자는 시작 가능, 에이전트(로컬)는 완료 보고 가능
  assert.equal((await boss.post('/api/evolve-act', { id: sys[0].id, action: 'do' })).status, 200);
  assert.equal((await local.post('/api/evolve-act', { id: sys[0].id, action: 'done' })).status, 200);
  // 워크스페이스 삭제·위험 권한은 관리자 전용
  await boss.post('/api/workspaces', { action: 'add', name: 'Team' });
  const wsId = (await boss.get('/api/workspaces')).workspaces.find((w) => w.name === 'Team').id;
  r = await kim.post('/api/workspaces', { action: 'remove', id: wsId }); assert.equal(r.status, 403);

  // 관리자 함: 실무자가 승인요청(동작 포함), 관리자만 처리, 실무자는 자기 것만 보고 취소 가능
  const a1 = (await (await kim.post('/api/admin/requests', { type: 'approval', title: 'Delete workspace Team', action: { kind: 'workspace.remove', id: wsId } })).json()).item;
  assert.deepEqual([a1.status, a1.from.kind, a1.from.by, a1.action.kind], ['open', 'member', 'kim@x.com', 'workspace.remove']);
  assert.equal((await (await kim.post('/api/admin/requests', { type: 'approval', title: 'Delete workspace Team' })).json()).existing, true);
  const w1 = (await (await local.post('/api/admin/requests', { type: 'work', title: 'Connect the CRM' })).json()).item;
  assert.equal(w1.from.kind, 'agent');
  assert.equal((await kim.post('/api/admin/act', { id: a1.id, action: 'approve' })).status, 403);
  assert.deepEqual((await kim.get('/api/admin/inbox')).items.map((x) => x.id), [a1.id], '실무자는 자기가 올린 것만');
  assert.equal((await boss.get('/api/admin/inbox')).items.length, 2);
  assert.equal((await boss.post('/api/admin/act', { id: w1.id, action: 'approve' })).status, 400, '실행 요청은 승인이 아니라 처리');
  assert.equal((await (await boss.post('/api/admin/act', { id: a1.id, action: 'approve' })).json()).item.status, 'done');
  assert.equal((await (await boss.post('/api/admin/act', { id: w1.id, action: 'start' })).json()).item.status, 'doing');
  assert.equal((await (await boss.post('/api/admin/act', { id: w1.id, action: 'done', note: 'Connected' })).json()).item.note, 'Connected');
  const k2 = (await (await kim.post('/api/admin/requests', { type: 'work', title: 'Add a printer' })).json()).item;
  assert.equal((await (await kim.post('/api/admin/act', { id: k2.id, action: 'cancel' })).json()).item.status, 'cancelled', '자기 요청은 취소 가능');
  assert.equal((await kim.post('/api/admin/requests', { type: 'nope', title: 'x' })).status, 400);
  // Files: 워크스페이스마다 자기 폴더, 프로젝트 폴더는 관리자만
  const upF = (who, root, ws, name) => fetch(`${api}/api/files/upload?root=${root}&path=`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user': who, ...(ws ? { 'x-ana-workspace': ws } : {}) }, body: JSON.stringify({ name, data: 'aGk=' }) });
  assert.equal((await upF('kim@x.com', 'files', 'default', 'base.txt')).status, 201);   // 새 워크스페이스를 만들면 그게 활성이라 기본은 이름으로
  assert.equal((await upF('kim@x.com', 'files', wsId, 'team.txt')).status, 201);
  const ls = async (ws) => (await (await fetch(`${api}/api/files?root=files`, { headers: { 'x-user': 'kim@x.com', ...(ws ? { 'x-ana-workspace': ws } : {}) } })).json()).entries.map((e) => e.name);
  assert.deepEqual([await ls('default'), await ls(wsId)], [['base.txt'], ['team.txt']], '워크스페이스마다 따로');
  assert.equal((await fetch(`${api}/api/files?root=project`, { headers: { 'x-user': 'kim@x.com' } })).status, 403, '프로젝트 폴더는 관리자만');
  assert.ok(!(await (await fetch(`${api}/api/files`, { headers: { 'x-user': 'kim@x.com' } })).json()).roots.some((r) => r.key === 'project'));
  assert.equal((await fetch(`${api}/api/files?root=project`, { headers: { 'x-user': 'boss@x.com' } })).status, 200);
  // Health › Tests: 목록은 누구나, 실행은 관리자만
  const tl = await kim.get('/api/tests'); assert.equal(tl.available, true); assert.match(tl.command, /node /);
  assert.equal((await kim.post('/api/tests/run', {})).status, 403);
  // 점검 risk → 관리자 실행 요청(한 번만). 테스트 서버엔 에이전트가 없어 'Agent is not running'이 risk다
  await boss.get('/api/trust'); await boss.get('/api/trust');
  const checks = (await boss.get('/api/admin/inbox')).items.filter((x) => x.from.kind === 'check');
  assert.ok(checks.length >= 1 && checks.every((x) => x.type === 'work' && /^check:/.test(x.ref)), JSON.stringify(checks));
  assert.equal(new Set(checks.map((x) => x.ref)).size, checks.length, '같은 점검은 하나만');
  // 사용 기록
  const act = (await boss.get('/api/activity')).activity.map((x) => x.action);
  for (const a of ['evolve.escalate', 'admin.approval', 'admin.work', 'admin.approve', 'admin.done']) assert.ok(act.includes(a), a);
});

test('no identity header or empty admin list: everyone is admin (single-user installs unchanged)', async (t) => {
  const { api, stop } = await startServer({ ANA_IDENTITY_HEADER: 'x-user', ANA_ADMINS: '' });
  t.after(stop);
  assert.equal((await (await fetch(api + '/api/me', { headers: { 'x-user': 'anyone@x.com' } })).json()).role, 'admin');
});

test('Work layer: the Work ontology comes from work-ontology.js, match what the app really produces, and broken references are reported', async (t) => {
  const A = require('./work-ontology.js'), G = require('./graph-index.js');
  // graph.js는 선언에서 읽는다 — 따로 적은 목록이 없다
  assert.deepEqual(Object.keys(G.MEANINGS).sort(), A.relations.map((r) => r.id).sort());
  assert.deepEqual(Object.keys(G.RULES).sort(), A.relations.filter((r) => r.made === 'explicit').map((r) => r.id).sort());
  for (const r of A.relations) for (const c of [...r.from, ...r.to]) assert.ok(A.classes.some((k) => k.id === c), `${r.id} points at undeclared class ${c}`);
  // 앱이 실제로 만드는 노드 종류·관계 종류 ⊆ 선언(기능을 바꾸고 선언을 안 고치면 여기서 걸린다)
  const s = { items: [{ id: 't1', title: 'T', due: '2026-01-02' }], events: [{ id: 'e1', title: 'E', date: '2026-01-03' }], notes: [{ id: 'n1', title: 'N' }],
    links: [{ from: 'n1', to: 't1', type: 'SPAWNED' }, { from: 't1', to: 'e1', type: 'SCHEDULED_AS' }, { from: 'e1', to: 'n1', type: 'REFERS_TO' }] };
  const snap = G.snapshot(s, 'default')[0];
  const kinds = new Set(snap.nodes.map((n) => n.kind)), types = new Set(snap.edges.map((e) => e.type));
  assert.deepEqual([...kinds].sort(), A.classes.map((c) => c.id).sort(), 'every declared class is produced, nothing else');
  assert.deepEqual([...types].sort(), A.relations.map((r) => r.id).sort(), 'every declared relation is produced, nothing else');
  // 지식 종류가 사라진 개념을 가리키면: 막지 않고 issues로 알린다. 지식 파일에 워크 종류 id가 있어도 워크 종류가 이긴다
  const { api, stop } = await startServer({}, (dir) => fs.writeFileSync(path.join(dir, 'knowledge-ontology.json'), JSON.stringify({ version: 1,
    classes: [{ id: 'Ticket', label: 'Ticket', parent: 'Task' }, { id: 'Gadget', label: 'Gadget', parent: 'Ghost' }, { id: 'Note', label: 'Shadow' }],
    relations: [{ id: 'blocks', label: 'blocks', domain: 'Ticket', range: 'Vanished', inverse: 'gone' }] })));
  t.after(stop);
  const o = await (await fetch(api + '/api/ontology')).json();
  assert.equal(o.classes.filter((c) => c.id === 'Note').length, 1); assert.equal(o.classes.find((c) => c.id === 'Note').source, 'work');
  assert.equal(o.classes.find((c) => c.id === 'Ticket').source, 'knowledge');
  assert.deepEqual(o.issues.map((x) => x.id).sort(), ['Gadget', 'blocks', 'blocks']);
  assert.match(o.issues.map((x) => x.msg).join('\n'), /parent Ghost is no longer in the ontology/);
});

test('Work links are a lens, sub-types on work items, and promotion evidence', async (t) => {
  const { api, stop } = await startServer({}, (dir) => fs.writeFileSync(path.join(dir, 'knowledge-ontology.json'), JSON.stringify({ version: 1,
    classes: [{ id: 'Ticket', label: 'Ticket', parent: 'Task' }, { id: 'Bug', label: 'Bug', parent: 'Ticket' }, { id: 'Client', label: 'Client' }], relations: [] })));
  t.after(stop);
  const post = (p, b) => fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const t1 = (await (await post('/api/todo', { title: 'Fix login' })).json()).id, t2 = (await (await post('/api/todo', { title: 'Ship release' })).json()).id;
  await post('/api/note', { action: 'add', title: 'Call notes' }); const n1 = (await (await fetch(api + '/api/state')).json()).notes.find((n) => n.title === 'Call notes').id;
  // 새 연결 종류는 저장된다(렌즈) — 워크 종류의 연결은 From → To를 지키고, 계산 연결·형식이 틀린 이름은 거절
  assert.equal((await post('/api/link', { action: 'add', from: t1, to: t2, type: 'BLOCKS' })).status, 200);
  assert.equal((await post('/api/link', { action: 'add', from: t1, to: t2, type: 'DUE_ON' })).status, 400);
  assert.equal((await post('/api/link', { action: 'add', from: t1, to: t2, type: 'blocks' })).status, 400);
  assert.equal((await post('/api/link', { action: 'add', from: t1, to: n1, type: 'SPAWNED' })).status, 400, 'SPAWNED goes Note → Task|Event');
  const view = await (await fetch(api + '/api/graph')).json();
  assert.ok(view.links.some((l) => l.type === 'BLOCKS' && l.newType && l.from === t1), 'the work graph shows the new kind, marked');
  const st = await (await fetch(api + '/api/stats')).json();
  assert.deepEqual(st.graph.newLinkTypes.map((x) => [x.type, x.count]), [['BLOCKS', 1]]);
  assert.equal(st.graph.kg.facts, 0, 'a new work link is not a knowledge fact');
  // 하위 종류: 지식 종류 중 그 워크 종류의 하위 종류만(손자도), 아니면 거절. ''이면 뗀다
  assert.equal((await post('/api/subtype', { id: t1, type: 'Bug' })).status, 200);
  assert.equal((await post('/api/subtype', { id: n1, type: 'Ticket' })).status, 400, 'Ticket is not a kind of Note');
  assert.equal((await post('/api/subtype', { id: t2, type: 'Client' })).status, 400);
  assert.equal((await post('/api/subtype', { id: t2, type: 'Task' })).status, 400, 'a Work class is not a sub-class');
  let s = await (await fetch(api + '/api/state')).json();
  assert.equal(s.items.find((x) => x.id === t1).subtype, 'Bug');
  // 승격 증거
  const ev = await (await fetch(api + '/api/ontology/evidence')).json();
  assert.deepEqual(ev.newLinkTypes.map((x) => [x.type, x.count]), [['BLOCKS', 1]]);
  assert.deepEqual(ev.subtypes, [{ type: 'Bug', of: 'Task', count: 1 }]);
  assert.equal((await post('/api/subtype', { id: t1, type: '' })).status, 200);
  s = await (await fetch(api + '/api/state')).json(); assert.equal(s.items.find((x) => x.id === t1).subtype, undefined);
});

test('Rules: chain rules (with reverse steps and sub-relations) infer, limit rules mark, broken ones are reported, OWL export', async (t) => {
  const { api, stop } = await startServer({}, (dir) => fs.writeFileSync(path.join(dir, 'knowledge-ontology.json'), JSON.stringify({ version: 1,
    classes: [{ id: 'Person', label: 'Person' }, { id: 'Workshop', label: 'Workshop' }, { id: 'Project', label: 'Project' }],
    relations: [{ id: 'attends', label: 'attends', domain: 'Person', range: 'Workshop' }, { id: 'part_of', label: 'part of', domain: 'Workshop', range: 'Project' },
      { id: 'involved_in', label: 'involved in', domain: 'Person', range: 'Project' }, { id: 'related_to', label: 'related to' }, { id: 'meets', label: 'meets', domain: 'Person', range: 'Person' },
      { id: 'leads', label: 'leads', domain: 'Person', range: 'Project' }] })));
  t.after(stop);
  const post = (p, b) => fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const rule = (item, action = 'add') => post('/api/ontology', { action, kind: 'rule', item });
  // 검증
  assert.equal((await rule({ id: 'r0', kind: 'chain', if: ['attends', 'nope'], then: 'involved_in' })).status, 400, 'unknown relation');
  assert.equal((await rule({ id: 'r0', kind: 'chain', if: ['a', 'b', 'c', 'd'], then: 'involved_in' })).status, 400, 'at most 3 steps');
  assert.equal((await rule({ id: 'r0', kind: 'chain', if: ['meets'], then: 'meets' })).status, 400, 'says nothing new');
  assert.equal((await rule({ id: 'r0', kind: 'limit', rel: 'leads', max: 0 })).status, 400);
  assert.equal((await rule({ id: 'r0', kind: 'chain', if: ['SPAWNED'], then: 'involved_in' })).status, 400, 'Work relations are not Knowledge relations');
  // 규칙 넷: 두 단계 연쇄 · 반대 방향 걷기(같은 워크숍 참석자 → 만남) · 하위 관계 · 개수 제한
  assert.equal((await rule({ id: 'joins', label: 'joins the project', kind: 'chain', if: ['attends', 'part_of'], then: 'involved_in' })).status, 200);
  assert.equal((await rule({ id: 'cohort', kind: 'chain', if: ['attends', '^attends'], then: 'meets' })).status, 200);
  assert.equal((await rule({ id: 'sub', kind: 'chain', if: ['involved_in'], then: 'related_to' })).status, 200);
  assert.equal((await rule({ id: 'onelead', label: 'one lead', kind: 'limit', rel: 'leads', per: 'to', max: 1 })).status, 200);
  let o = await (await fetch(api + '/api/ontology')).json();
  assert.deepEqual(o.rules.filter((x) => x.source === 'work').map((x) => x.id).sort(), ['DUE_ON', 'ON'], 'Work rules: what the app computes');
  assert.equal(o.rules.filter((x) => x.source === 'knowledge').length, 4);
  assert.equal((await post('/api/ontology', { action: 'remove', kind: 'relation', item: { id: 'part_of' } })).status, 409, 'a relation a rule uses can\'t be removed');
  // 지식그래프에 사실을 넣고 읽기
  await post('/api/todo', { title: 'Workshop prep' });
  const j = (await (await post('/api/analysis/start', { kinds: ['tasks'] })).json()).job;
  await post('/api/analysis/result', { id: j.id, graph: { entities: [{ id: 'pat', label: 'Pat', class: 'Person' }, { id: 'kim', label: 'Kim', class: 'Person' }, { id: 'ws1', label: 'Spring workshop', class: 'Workshop' }, { id: 'p1', label: 'Onboarding', class: 'Project' }],
    facts: [{ from: 'pat', rel: 'attends', to: 'ws1' }, { from: 'kim', rel: 'attends', to: 'ws1' }, { from: 'ws1', rel: 'part_of', to: 'p1' }, { from: 'pat', rel: 'leads', to: 'p1' }, { from: 'kim', rel: 'leads', to: 'p1' }] } });
  await post('/api/analysis/apply', { id: j.id });
  const kg = await (await fetch(api + '/api/kg')).json();
  const inf = (a, r, b) => kg.inferred.find((f) => f.from === a && f.rel === r && f.to === b);
  assert.equal(inf('pat', 'involved_in', 'p1').rule, 'rule:joins'); assert.equal(inf('pat', 'involved_in', 'p1').ruleLabel, 'joins the project');
  assert.equal(inf('pat', 'involved_in', 'p1').because.length, 2);
  assert.ok(inf('pat', 'meets', 'kim') && inf('kim', 'meets', 'pat'), 'reverse step: people at the same workshop meet');
  assert.ok(inf('pat', 'related_to', 'p1'), 'rules build on inferred facts (sub-relation of an inferred fact)');
  const leads = kg.facts.filter((f) => f.rel === 'leads');
  assert.ok(leads.every((f) => f.fit === false && /one lead: at most 1 leads per To/.test(f.why)), 'limit rule marks, does not delete');
  // 끊긴 규칙은 issues로(파일에서 관계가 사라진 경우)
  const ttl = await (await fetch(api + '/api/kg/ttl')).text();
  assert.match(ttl, /ana:involved_in owl:propertyChainAxiom \( ana:attends ana:part_of \) \./);
  assert.match(ttl, /ana:meets owl:propertyChainAxiom \( ana:attends \[ owl:inverseOf ana:attends \] \) \./);
  assert.match(ttl, /ana:involved_in rdfs:subPropertyOf ana:related_to \./);
  assert.match(ttl, /ana:Project rdfs:subClassOf \[ rdf:type owl:Restriction ; owl:onProperty \[ owl:inverseOf ana:leads \] ; owl:maxCardinality "1"/);
  assert.equal((await rule({ id: 'joins' }, 'remove')).status, 200);
  o = await (await fetch(api + '/api/ontology')).json(); assert.ok(!o.rules.some((x) => x.id === 'joins'));
});

test('0.11 data names: state.json, kg.json, ontology.json move to work-graph.json, knowledge-graph.json, knowledge-ontology.json (copies kept); old index cache removed', async (t) => {
  let dir0;
  const { api, stop } = await startServer({}, (dir) => {
    dir0 = dir;
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 3, items: [{ id: 'a1', title: 'Old task', done: false }], events: [], notes: [], links: [] }));
    fs.writeFileSync(path.join(dir, 'kg.json'), JSON.stringify({ entities: [{ id: 'acme', label: 'Acme', class: 'Client' }], facts: [] }));
    fs.writeFileSync(path.join(dir, 'ontology.json'), JSON.stringify({ version: 1, classes: [{ id: 'Client', label: 'Client' }], relations: [] }));
    fs.writeFileSync(path.join(dir, 'graph.sqlite'), 'old cache');
  });
  t.after(stop);
  const s = await (await fetch(api + '/api/state')).json();
  assert.ok(s.items.some((x) => x.id === 'a1' && x.title === 'Old task'), 'the work graph came along');
  assert.ok((await (await fetch(api + '/api/kg')).json()).entities.some((e) => e.id === 'acme'), 'the knowledge graph came along');
  assert.ok((await (await fetch(api + '/api/ontology')).json()).classes.some((c) => c.id === 'Client' && c.source === 'knowledge'), 'the knowledge ontology came along');
  for (const [oldName, newName] of [['state.json', 'work-graph.json'], ['kg.json', 'knowledge-graph.json'], ['ontology.json', 'knowledge-ontology.json']]) {
    assert.ok(fs.existsSync(path.join(dir0, newName)), newName); assert.ok(!fs.existsSync(path.join(dir0, oldName)), `${oldName} moved`);
    assert.ok(fs.existsSync(path.join(dir0, oldName + '.pre-0.11')), `${oldName} copy kept`);
  }
  assert.ok(!fs.existsSync(path.join(dir0, 'graph.sqlite')), 'old index cache removed');
});

test('Evolve proposals carry a horizon, the reason and outside sources (http(s) links only), and keep them when escalated', async (t) => {
  const { api, stop } = await startServer({});
  t.after(stop);
  const post = (p, b) => fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await post('/api/evolve', { proposals: [{ title: 'x', horizon: 'moonshot' }] })).status, 400, 'horizon is tidy|improve|reimagine');
  const r = await (await post('/api/evolve?ws=default', { proposals: [{ scope: 'workspace', horizon: 'reimagine', type: 'add', title: 'A client room per client',
    desc: 'Group each client\'s notes, tasks and calls', because: '14 of 20 tasks mention Acme; the same call → quote → follow-up flow repeats',
    sources: [{ title: 'Account-based workspaces', url: 'https://example.com/case', note: 'one space per account' }, { url: 'javascript:alert(1)' }, 'https://example.org/b'] }] })).json();
  const list = (await (await fetch(api + '/api/evolve')).json()).proposals || [];
  const pr = list.find((x) => x.id === r.ids[0]);
  assert.equal(pr.horizon, 'reimagine'); assert.match(pr.because, /14 of 20/);
  assert.deepEqual(pr.sources.map((x) => x.url), ['https://example.com/case', 'https://example.org/b'], 'only http(s) links are kept');
  const esc = await (await post('/api/evolve-act', { id: pr.id, action: 'escalate' })).json();
  const sys = ((await (await fetch(api + '/api/evolve')).json()).proposals || []).find((x) => x.id === (esc.proposal || {}).id);
  assert.ok(sys && sys.scope === 'system' && sys.horizon === 'reimagine' && sys.sources.length === 2 && /14 of 20/.test(sys.because), 'escalation keeps the insight');
});

test('Evolve insights come first: stored, linked to the proposals that follow, dismissable', async (t) => {
  const { api, stop } = await startServer({});
  t.after(stop);
  const post = (p, b) => fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const r = await (await post('/api/evolve?ws=default', {
    insights: [{ scope: 'workspace', title: 'The workshop day has passed but its prep tasks are still open', detail: 'Venue, invitations and slides are open; the day was Oct 9.', items: ['a1', 'bad id!'], decide: 'Did it happen, or was it moved?' }],
    proposals: [{ insight: 0, scope: 'workspace', horizon: 'tidy', title: 'Close or move the workshop prep', because: 'Oct 9 passed, 3 prep tasks open', outcome: 'One decision closes or moves all three', how: 'POST /api/done for each' },
      { insight: 0, scope: 'system', horizon: 'improve', title: 'When an event passes, ask how it went', outcome: 'Prep tasks get tidied in one go', how: 'an event.after hook in the Work ontology' }] })).json();
  assert.equal(r.insights.length, 1);
  const ev = await (await fetch(api + '/api/evolve')).json();
  const ins = ev.insights.find((x) => x.id === r.insights[0]);
  assert.deepEqual(ins.items, ['a1'], 'only plain ids'); assert.match(ins.decide, /moved/);
  const ps = ev.proposals.filter((x) => r.ids.includes(x.id));
  assert.ok(ps.every((x) => x.insightId === ins.id), 'proposals point at their insight');
  assert.equal(ps.find((x) => x.scope === 'system').how, 'an event.after hook in the Work ontology');
  assert.equal(ps.find((x) => x.scope === 'workspace').outcome, 'One decision closes or moves all three');
  assert.equal((await post('/api/insight-act', { id: ins.id, action: 'dismiss' })).status, 200);
  assert.equal((await (await fetch(api + '/api/evolve')).json()).insights.find((x) => x.id === ins.id).status, 'dismissed');
  assert.equal((await post('/api/evolve', { insights: [{ title: '' }] })).status, 400, 'needs a proposal or an insight with a title');
});
