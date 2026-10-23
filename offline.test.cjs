// 오프라인 모드(ANA_OFFLINE=1): 페이지 표시, 에이전트·인터넷 라우트 거절, 일반 기능은 그대로
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const net = require('node:net');

test('offline mode: page marked, agent/internet routes 503, notes/tasks/relations work', async () => {
  const port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ana-offline-')); fs.mkdirSync(path.join(tmp, 'files'));
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: { ...process.env, ANA_OFFLINE: '1', PORT: String(port), BIND: '127.0.0.1',
    ANA_DATA_DIR: path.join(tmp, 'data'), ANA_FILES_ROOT: path.join(tmp, 'files'), TMUX_SOCKET: 'ana-none-offline', PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const api = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 100; i++) { try { if ((await fetch(api + '/api/state')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    assert.match(await (await fetch(api + '/')).text(), /<html data-offline="1"/);
    for (const p of ['/api/limits', '/api/update/check', '/api/agentlog']) assert.equal((await fetch(api + p)).status, 503, p);
    const post = (p, b) => fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json', origin: api }, body: JSON.stringify(b) });
    assert.equal((await post('/api/analysis/start', { kinds: ['notes'] })).status, 503);
    assert.equal((await post('/api/requirements/analyze', {})).status, 503);
    assert.equal((await post('/api/todo', { title: 'offline task' })).status, 200);
    const st = await (await fetch(api + '/api/state')).json();
    assert.ok(st.items.some((t) => t.title === 'offline task'));
    assert.equal((await fetch(api + '/api/graph')).status, 200);
    assert.equal((await post('/api/requirements', { action: 'add', title: 'Works offline' })).status, 200);
    assert.equal((await fetch(api + '/api/agent-base')).status, 200);
  } finally { child.kill(); await new Promise((r) => child.once('exit', r)); fs.rmSync(tmp, { recursive: true, force: true }); }
});
