// 역할(관리자·실무자)과 관리자 함: 실무자가 관리자 전용 동작을 하면 403 needsAdmin, 관리자 함에 승인요청·작업요청,
// 진화 제안의 시스템/워크스페이스 범위와 승격, 점검 risk → 작업요청
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const net = require('node:net');

async function startServer(env) {
  const port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ana-admin-'));
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: String(port), BIND: '127.0.0.1', ANA_DATA_DIR: path.join(tmp, 'data'),
    EVOLVE_FILE: path.join(tmp, 'data', 'evolve.json'), ANA_SEED: '0', NOTIFY_AGENT: '0', TMUX_SOCKET: 'ana-none-admin', ...env }, stdio: 'ignore' });
  const api = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(api + '/api/state')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  return { api, stop: async () => { child.kill(); await new Promise((r) => child.once('exit', r)); fs.rmSync(tmp, { recursive: true, force: true }); } };
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
  assert.equal((await boss.post('/api/admin/act', { id: w1.id, action: 'approve' })).status, 400, '작업요청은 승인이 아니라 처리');
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
  // 점검 risk → 관리자 작업요청(한 번만). 테스트 서버엔 에이전트가 없어 'Agent is not running'이 risk다
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
