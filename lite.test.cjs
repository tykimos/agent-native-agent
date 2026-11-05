// 간소화판(Agent-Native Agent): Pro 기능이 빠졌는지, 남은 받은함·진화가 그대로 동작하는지
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const net = require('node:net');

async function startServer(env, prepare) {
  const port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ana-lite-'));
  if (prepare) { fs.mkdirSync(path.join(tmp, 'data'), { recursive: true }); prepare(path.join(tmp, 'data')); }
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, PORT: String(port), BIND: '127.0.0.1', ANA_DATA_DIR: path.join(tmp, 'data'),
    EVOLVE_FILE: path.join(tmp, 'data', 'evolve.json'), ANA_SEED: '0', NOTIFY_AGENT: '0', TMUX_SOCKET: 'ana-none-lite', ...env }, stdio: 'ignore' });
  const api = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(api + '/api/state')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  if (child.exitCode !== null) throw new Error('the test server exited at start — check that the code loads');
  return { api, stop: async () => { if (child.exitCode === null && child.signalCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); } fs.rmSync(tmp, { recursive: true, force: true }); } };   // 이미 죽은 서버를 기다리며 멈추지 않게
}

test('Pro-only routes are not here (knowledge, ontology, admin inbox, workspaces, requirements, health, files)', async (t) => {
  const { api, stop } = await startServer({});
  t.after(stop);
  for (const p of ['/api/kg', '/api/ontology', '/api/analysis', '/api/admin/inbox', '/api/workspaces', '/api/requirements', '/api/trust', '/api/tests', '/api/files/list']) {
    const r = await fetch(api + p);
    assert.equal(r.status, 404, `${p} is Pro-only`);
  }
  const me = await (await fetch(api + '/api/me')).json();
  assert.ok(!('role' in me), 'no roles: one person decides everything');
});

test('0.11 data names: state.json moves to work-graph.json (copy kept); old index cache removed', async (t) => {
  let dir0;
  const { api, stop } = await startServer({}, (dir) => {
    dir0 = dir;
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 3, items: [{ id: 'a1', title: 'Old task', done: false }], events: [], notes: [], links: [] }));
    fs.writeFileSync(path.join(dir, 'graph.sqlite'), 'old cache');
  });
  t.after(stop);
  const s = await (await fetch(api + '/api/state')).json();
  assert.ok(s.items.some((x) => x.id === 'a1' && x.title === 'Old task'), 'the work graph came along');
  assert.ok(fs.existsSync(path.join(dir0, 'work-graph.json')) && !fs.existsSync(path.join(dir0, 'state.json')), 'state.json moved');
  assert.ok(fs.existsSync(path.join(dir0, 'state.json.pre-0.11')), 'copy kept');
  assert.ok(!fs.existsSync(path.join(dir0, 'graph.sqlite')), 'old index cache removed');
});

test('Evolve proposals carry a horizon, the reason and outside sources (http(s) links only); one list, no scopes', async (t) => {
  const { api, stop } = await startServer({});
  t.after(stop);
  const post = (p, b) => fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await post('/api/evolve', { proposals: [{ title: 'x', horizon: 'moonshot' }] })).status, 400, 'horizon is tidy|improve|reimagine');
  const r = await (await post('/api/evolve', { proposals: [{ horizon: 'reimagine', type: 'add', title: 'A client room per client',
    desc: 'Group each client\'s notes, tasks and calls', because: '14 of 20 tasks mention Acme; the same call → quote → follow-up flow repeats',
    sources: [{ title: 'Account-based workspaces', url: 'https://example.com/case', note: 'one space per account' }, { url: 'javascript:alert(1)' }, 'https://example.org/b'] }] })).json();
  const pr = ((await (await fetch(api + '/api/evolve')).json()).proposals || []).find((x) => x.id === r.ids[0]);
  assert.equal(pr.horizon, 'reimagine'); assert.match(pr.because, /14 of 20/); assert.ok(!('scope' in pr), 'no system/workspace scope');
  assert.deepEqual(pr.sources.map((x) => x.url), ['https://example.com/case', 'https://example.org/b'], 'only http(s) links are kept');
  assert.equal((await post('/api/evolve-act', { id: pr.id, action: 'escalate' })).status, 400, 'nothing to escalate to');
  assert.equal((await (await post('/api/evolve-act', { id: pr.id, action: 'do' })).json()).status, 'doing', 'anyone can start it');
});

test('Inbox items speak plainly: why / ask / effect / ifNot are kept on requests and data changes', async (t) => {
  const { api, stop } = await startServer({});
  t.after(stop);
  const post = (p, b) => fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const plain = { why: 'Acme is waiting for the revised quote', ask: 'Approve sending it today', effect: 'Acme gets the quote; the follow-up call can be booked', ifNot: 'Acme keeps waiting' };
  await post('/api/requests', { requests: [{ kind: 'approval', title: 'Send the quote to Acme', ...plain }] });
  const rq = (await (await fetch(api + '/api/requests')).json()).requests.find((x) => x.title === 'Send the quote to Acme');
  for (const k of Object.keys(plain)) assert.equal(rq[k], plain[k], `request.${k}`);
  const pr = await (await post('/api/agent', { text: 'Add a follow-up task', diff: { add: [{ title: 'Call Acme' }] }, why: 'The call passed before the quote', effect: 'A new task to call Acme' })).json();
  const st = await (await fetch(api + '/api/state')).json();
  const p0 = (st.proposals || []).find((x) => x.id === pr.pid);
  assert.equal(p0.why, 'The call passed before the quote'); assert.equal(p0.effect, 'A new task to call Acme');
});

test('PRD: the agent writes it, a person edits it, every version stays in history and can be restored', async (t) => {
  const { api, stop } = await startServer({});
  t.after(stop);
  const post = (p, b) => fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  assert.equal((await (await fetch(api + '/api/prd')).json()).current, null, 'no PRD at first');
  assert.equal((await post('/api/prd', { md: '  ' })).status, 400, 'md required');
  const a = await (await post('/api/prd', { md: '# Base\n\n## Purpose\nRun my work', note: 'First draft', source: 'agent' })).json();
  const b = await (await post('/api/prd', { md: '# Base\n\n## Purpose\nRun my work with an agent', note: 'Edited' })).json();
  assert.equal((await (await post('/api/prd', { md: '# Base\n\n## Purpose\nRun my work with an agent' })).json()).unchanged, true, 'same text is not a new version');
  let d = await (await fetch(api + '/api/prd')).json();
  assert.equal(d.current.v, b.v); assert.equal(d.current.source, 'person'); assert.equal(d.history.length, 1);
  assert.equal(d.history[0].v, a.v); assert.equal(d.history[0].source, 'agent'); assert.equal(d.history[0].note, 'First draft');
  await post('/api/prd', { action: 'restore', v: a.v });
  d = await (await fetch(api + '/api/prd')).json();
  assert.match(d.current.md, /Run my work$/); assert.equal(d.current.note, `Restored version ${a.v}`); assert.equal(d.history.length, 2, 'nothing is lost');
  assert.equal((await post('/api/prd', { action: 'restore', v: 999 })).status, 404);
});

test('Update: the list is there before any check; acting on an unknown item is 404', async (t) => {
  const { api, stop } = await startServer({});
  t.after(stop);
  const u = await (await fetch(api + '/api/updates')).json();
  assert.deepEqual(u.items, []); assert.equal(u.lastCheck, null); assert.equal(u.checking, false);
  const r = await fetch(api + '/api/update-act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 1, action: 'do' }) });
  assert.equal(r.status, 404);
});

test('Knowledge starts empty; the agent adds kinds, relations, things and facts; people remove what is wrong', async (t) => {
  const { api, stop } = await startServer({});
  t.after(stop);
  const post = (p, b) => fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const k0 = await (await fetch(api + '/api/knowledge')).json();
  assert.deepEqual([k0.classes, k0.relations, k0.entities, k0.facts], [[], [], [], []], 'empty at first');
  assert.equal((await post('/api/knowledge', { classes: [{ id: 'bad id!' }] })).status, 400, 'nothing valid → 400');
  await post('/api/knowledge', { classes: [{ id: 'Client', label: 'Client' }, { id: 'Team', label: 'Team' }], relations: [{ id: 'client_of', label: 'client of', domain: 'Client', range: 'Team' }],
    entities: [{ id: 'acme', label: 'Acme', class: 'Client', items: ['n1'] }, { id: 'us', label: 'Our team', class: 'Team' }, { id: 'seoul', label: 'Seoul', class: 'Place' }],
    facts: [{ from: 'acme', rel: 'client_of', to: 'us', items: ['n1'] }, { from: 'acme', rel: 'located_in', to: 'seoul' }] });
  await post('/api/knowledge', { classes: [{ id: 'Client', label: 'Customer' }], facts: [{ from: 'acme', rel: 'client_of', to: 'us', items: ['n2'] }] });
  let k = await (await fetch(api + '/api/knowledge')).json();
  assert.equal(k.classes.find((c) => c.id === 'Client').label, 'Customer', 'same id is updated, not duplicated'); assert.equal(k.classes.length, 2);
  assert.equal(k.facts.length, 2, 'the same fact stays one'); assert.deepEqual(k.facts.find((f) => f.rel === 'client_of').items, ['n2']);
  assert.ok(k.entities.some((e) => e.class === 'Place') && k.facts.some((f) => f.rel === 'located_in'), 'things outside the ontology are kept');
  assert.equal((await post('/api/knowledge', { action: 'remove', kind: 'entity', id: 'acme' })).status, 200);
  k = await (await fetch(api + '/api/knowledge')).json();
  assert.ok(!k.entities.some((e) => e.id === 'acme') && !k.facts.length, 'removing a thing removes its facts');
  assert.equal((await post('/api/knowledge', { action: 'remove', kind: 'class', id: 'Nope' })).status, 404);
});

test('A new ANA starts with no PRD, no work and no knowledge — the first conversation writes them', async (t) => {
  const { api, stop } = await startServer({ ANA_SEED: '1' });   // 예전 판의 견본 스위치가 켜져 있어도 비어 있다
  t.after(stop);
  assert.equal((await (await fetch(api + '/api/prd')).json()).current, null, 'no PRD');
  const st = await (await fetch(api + '/api/state')).json();
  assert.deepEqual([st.items.length, st.events.length, st.notes.length], [0, 0, 0], 'no example work');
  const k = await (await fetch(api + '/api/knowledge')).json();
  assert.equal(k.classes.length + k.entities.length, 0, 'knowledge empty');
  assert.ok(require('node:fs').readFileSync(path.join(__dirname, 'prd-template.md'), 'utf8').includes('## Sketches'), 'the template the agent writes from');
});

test('Claude Code is recognized whether tmux shows "claude", "claude.exe" or a version number (2.1.316+)', () => {
  const { isClaudeCommand } = require('./agent-log.js');
  for (const c of ['claude', 'claude.exe', '2.1.316', '2.2.0']) assert.ok(isClaudeCommand(c, 'exec claude --dangerously-skip-permissions'), c);
  assert.ok(isClaudeCommand('2.1.316', ''), 'a shell where claude was typed has no start command');
  assert.ok(!isClaudeCommand('node', 'exec codex'), 'Codex runs as node');
  assert.ok(!isClaudeCommand('0.46.0', 'exec codex --yolo'), 'a version-like name with a codex start command is not Claude');
  assert.ok(!isClaudeCommand('zsh', ''));
});

test('Knowledge › Documents: upload a file, list it with a path the agent can read, download it, remove it', async (t) => {
  const { api, stop } = await startServer({});
  t.after(stop);
  const post = (p, b) => fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  assert.deepEqual((await (await fetch(api + '/api/documents')).json()).items, [], 'none at first');
  const text = '가격표\nBasic 100\nPro 300\n';
  const up = await (await post('/api/documents', { name: '가격표 2026.txt', type: 'text/plain', data: Buffer.from(text).toString('base64'), note: 'Current prices' })).json();
  assert.equal(up.item.id, 'doc-1'); assert.equal(up.item.size, Buffer.byteLength(text));
  const list = (await (await fetch(api + '/api/documents')).json()).items;
  assert.equal(list[0].name, '가격표 2026.txt'); assert.equal(require('node:fs').readFileSync(list[0].path, 'utf8'), text, 'the agent can read it at its path');
  const dl = await fetch(api + '/api/documents/doc-1/file');
  assert.equal(await dl.text(), text); assert.match(dl.headers.get('content-disposition'), /^inline/);
  await post('/api/documents', { name: 'page.html', data: Buffer.from('<script>alert(1)</script>').toString('base64') });
  const h = await fetch(api + '/api/documents/doc-2/file');
  assert.match(h.headers.get('content-disposition'), /^attachment/, 'HTML is never opened in the page'); assert.equal(h.headers.get('content-type'), 'application/octet-stream');
  assert.equal((await post('/api/documents', { name: 'x', data: '' })).status, 400);
  assert.equal((await post('/api/documents', { action: 'remove', id: 'doc-1' })).status, 200);
  assert.ok(!require('node:fs').existsSync(list[0].path), 'the file is gone');
  assert.equal((await fetch(api + '/api/documents/doc-1/file')).status, 404);
});

test('before the first reply the chip shows the selected model, not the Claude Code version', () => {
  const { claudeSelectedModel } = require('./agent-log.js');
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ana-model-')), cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'ana-cfg-'));
  assert.equal(claudeSelectedModel('claude --model sonnet', cwd, cfg), 'Sonnet');
  assert.equal(claudeSelectedModel('claude --model=claude-haiku-4-5-20251001', cwd, cfg), 'Haiku 4.5');
  assert.equal(claudeSelectedModel('claude', cwd, cfg), '', 'nothing chosen → empty (agent name is shown)');
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ model: 'claude-opus-5-5' }));
  assert.equal(claudeSelectedModel('claude', cwd, cfg), 'Opus 5.5');
  fs.mkdirSync(path.join(cwd, '.claude')); fs.writeFileSync(path.join(cwd, '.claude', 'settings.local.json'), JSON.stringify({ model: 'fable' }));
  assert.equal(claudeSelectedModel('claude', cwd, cfg), 'Fable', 'project setting wins over the user setting');
});

test('agent pictures: only images, only from the agent folder or its scratchpad', async (t) => {
  const { api, stop } = await startServer({});
  t.after(stop);
  const get = (q) => fetch(`${api}/api/agentfile?${q}`).then((r) => r.status);
  assert.equal(await get('target=x&path=relative.png'), 400, 'absolute path only');
  assert.equal(await get(`target=x&path=${encodeURIComponent('/etc/passwd')}`), 403, 'images only');
  assert.equal(await get(`target=no-such-pane&path=${encodeURIComponent('/tmp/a.png')}`), 404, 'unknown agent');
});
