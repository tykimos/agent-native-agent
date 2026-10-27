'use strict';
// dashboard-api.js — 대시보드 상태 API (채널 코어 위에 얹힌 계층).
// 담당: /api/state · /api/agent(제안) · /api/approve · /api/apply · /api/done · /api/note · /api/link · /api/graph/* · /api/evolve · /api/evolve-act · /api/requests · /api/request-act
//       + /api/notifications(pull 통지 조회)
//
// 검증 하네스 반영(2026-08-19):
//  CR6 원자적 쓰기 + 손상 시 백업·throw (channel-core writeJsonAtomic/readJsonStrict 사용)
//  CR7 입력 검증: null 본문·깨진 diff·decision/type 화이트리스트 (core.jsonBody + validateDiff)
//  CR9 제안 진실원천 단일화: pid = max(proposals, 원장 pid) 복원, caller id 무시
//  CR11 통지 push→pull: 고정 문구 [ANA-NOTIFY id kind] + "답하지 마세요" + 지연 큐 + notified 노출 + GET /api/notifications
//  QA-M4/M5/m2/m3 applyDiff 방어: 개수 상한·키 화이트리스트·done 불리언·변경 0이면 version 미증가·중복 id 거부
//  QA-M6 제안 카드 상태: /api/state가 pending 제안만 노출(과거 카드 좀비 방지는 프론트 unknown 처리와 병행)

const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const fsp = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { AsyncLocalStorage } = require('node:async_hooks');
const relgraph = require('./graph-index.js');   // NodeRel 색인 — 워크 그래프와 지식그래프를 한 색인에
const codexSettings = require('./codex-settings.js');
const permissionMode = require('./permission-mode.js');
const { createAgentLog } = require('./agent-log.js');

function createDashboardApi(core, opts) {
  const { ROOT } = opts;
  // 시스템 › Files: 기본은 전용 폴더(올리기 가능), 채팅 첨부는 읽기 전용, 저장소 전체는 따로 골라야 보이고 .ana/.git에는 못 쓴다
  const fileApi = require('./file-browser.js').createFileBrowser({
    // 워크스페이스마다 자기 files 폴더(기본 워크스페이스는 .ana/files). ANA_FILES_ROOT를 주면 그 폴더 하나(오프라인 패키지)
    files: { dir: opts.FILES_ROOT || (() => path.join(path.dirname(dataFileOf(curWs())), 'files')), label: 'Files', write: true, mkdir: true },
    chat: { dir: opts.UPLOAD_DIR || path.join(ROOT, '.ana', 'uploads'), label: 'From chat', write: false, mkdir: true },
    project: { dir: ROOT, label: path.basename(ROOT), write: true, deny: ['.ana', '.git'] },
  }, core, { onUpload: (req, root, size) => audit(actor(req), 'files.upload', `${root} ${size}`), allow: (req, root) => root !== 'project' || isAdmin(req) });   // 프로젝트 폴더는 관리자만
  const DATA_FILE = opts.DATA_FILE || path.join(ROOT, 'data', 'work-graph.json');   // 기본 워크스페이스의 워크 그래프
  const PROPOSALS_FILE = opts.PROPOSALS_FILE || path.join(ROOT, 'data', 'proposals.json');
  const EVOLVE_FILE = opts.EVOLVE_FILE || path.join(ROOT, 'data', 'evolve.json');
  const REQUESTS_FILE = opts.REQUESTS_FILE || path.join(path.dirname(EVOLVE_FILE), 'requests.json');
  // 시스템 › Update — 업스트림(agent-native-agent)과 기능 단위 비교 결과와 그 처리 상태
  const UPDATES_FILE = opts.UPDATES_FILE || path.join(path.dirname(EVOLVE_FILE), 'updates.json');
  // 협업 › Requirements — 사용자의 요청사항과 그 반영 분석(워크스페이스가 아니라 이 ANA 자체에 대한 것이라 하나의 목록)
  const REQUIREMENTS_FILE = opts.REQUIREMENTS_FILE || path.join(path.dirname(EVOLVE_FILE), 'requirements.json');
  // 관리자 함(System › Admin): 실무자·에이전트·점검이 관리자에게 올리는 승인요청(approval)·실행 요청(work)
  const ADMIN_FILE = opts.ADMIN_FILE || path.join(path.dirname(EVOLVE_FILE), 'admin.json');
  // System › Health › Tests: 이 ANA의 테스트(package.json scripts.test)를 돌린 기록(최근 10번)
  const TESTS_FILE = opts.TESTS_FILE || path.join(path.dirname(EVOLVE_FILE), 'tests.json');
  // 지식 온톨로지(System — 모든 워크스페이스가 공유, 관리자). 워크 온톨로지는 코드(work-ontology.js)
  const ONTOLOGY_FILE = opts.ONTOLOGY_FILE || path.join(path.dirname(EVOLVE_FILE), 'knowledge-ontology.json');
  const UPSTREAM_DIR = opts.UPSTREAM_DIR || path.join(path.dirname(EVOLVE_FILE), 'upstream');
  const UPSTREAM_URL = opts.UPSTREAM_URL || 'https://github.com/tykimos/agent-native-agent';
  const UPDATE_TARGET = opts.UPDATE_TARGET || ROOT;   // 비교할 ANA 폴더(기본: 이 ANA). 시험·호스트용으로 바꿀 수 있다
  const NOTIFY_AGENT = opts.NOTIFY_AGENT !== false;
  const MAX_TEXT = opts.MAX_TEXT || 8000;
  const SEED = !!opts.SEED;
  // Claude Code 세션의 구조화된 대화 기록(읽기 전용) — 채팅을 Claude 앱과 같은 모양으로 그린다
  const agentLog = createAgentLog({ socket: opts.TMUX_SOCKET || '' });
  const permOverride = new Map();
  async function codexDefaultMode(start) {
    if (/--dangerously-bypass-approvals-and-sandbox|--yolo\b/.test(start || '')) return 'full';
    let cfg = ''; try { cfg = await fsp.readFile(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml'), 'utf8'); } catch {}
    return /^\s*approvals_reviewer\s*=\s*"auto_review"/m.test(cfg) ? 'auto' : 'ask';
  }   // Codex: 바꾼 직후 다음 turn_context가 오기 전까지 기억하는 모드
  const { writeJsonAtomic, readJsonStrict, sendJson } = core;

  // ---------- 신원 ----------
  // ANA는 스스로 로그인을 처리하지 않는다. 앞단(리버스 프록시·SSO 게이트웨이 등)이 인증을 마치고
  // 사용자 식별자를 헤더로 실어 보내는 배포에서만 신원이 잡힌다. 헤더 이름은 ANA_IDENTITY_HEADER로
  // 지정한다. 지정하지 않으면 단일 사용자 모드 — 모든 항목이 'ana' 소유가 되고 작성자 표시도 없다.
  //
  // 신뢰 전제: 이 헤더는 앞단이 붙였을 때만 의미가 있다. 서버를 루프백이나 그 프록시 뒤에만 두어라.
  // 0.0.0.0으로 직접 노출하면서 이 옵션을 켜면 누구나 헤더를 위조해 남의 이름으로 쓸 수 있다.
  const ID_HEADER = String(opts.IDENTITY_HEADER || '').trim().toLowerCase();
  const LOGOUT_URL = String(opts.LOGOUT_URL || '').trim();
  const USERS_FILE = opts.USERS_FILE || path.join(ROOT, '.ana', 'users.json');
  const AUDIT_FILE = opts.AUDIT_FILE || path.join(ROOT, '.ana', 'audit.jsonl');
  function who(req) {
    if (!ID_HEADER) return '';
    return String((req.headers || {})[ID_HEADER] || '').trim().toLowerCase();
  }
  // 신원이 없는 호출(단일 사용자 모드, 로컬 에이전트·스크립트)은 'ana'로 기록한다.
  const actor = (req) => who(req) || 'ana';

  // ---------- 역할: 관리자(시스템) · 실무자(워크스페이스) ----------
  // ANA_ADMINS=이메일,… 에 든 사람만 관리자. 목록이 비었거나 신원 헤더를 안 쓰는 설치(단일 사용자),
  // 신원 없이 들어온 로컬 호출(이 컴퓨터의 사용자·에이전트)은 관리자로 본다 — 예전 설치가 그대로 동작하게.
  // 역할은 사람을 다스린다: 이 컴퓨터의 에이전트는 셸 권한이 있어 어차피 무엇이든 할 수 있다.
  const ADMINS = String(opts.ADMINS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  function roleOf(req) {
    const id = who(req);
    if (!ID_HEADER || !id || !ADMINS.length) return 'admin';
    return ADMINS.includes(id) ? 'admin' : 'member';
  }
  const isAdmin = (req) => roleOf(req) === 'admin';
  // 관리자 전용 동작을 실무자가 부르면: 403 + needsAdmin — 화면은 관리자 승인요청으로 돌린다
  const needAdmin = (res, what) => (sendJson(res, 403, { error: `${what} needs the admin's approval`, needsAdmin: true, what }), true);

  function loadUsers() {
    const u = readJsonStrict(USERS_FILE, () => ({ users: {} }));
    if (!u || typeof u !== 'object' || typeof u.users !== 'object' || !u.users) return { users: {} };
    return u;
  }
  const saveUsers = (u) => writeJsonAtomic(USERS_FILE, u);
  function touchUser(email) {
    if (!email || email === 'ana') return null;
    const u = loadUsers();
    const now = new Date().toISOString();
    if (!u.users[email]) u.users[email] = { email, name: email.split('@')[0], avatar: '', firstSeen: now, lastSeen: now };
    else u.users[email].lastSeen = now;
    saveUsers(u);
    return u.users[email];
  }
  const profileOf = (email) => (loadUsers().users[email] || { email, name: (email || '').split('@')[0] || 'ANA', avatar: '' });

  // ---------- 감사 로그 ----------
  // "누가 무엇을 추가/수정/삭제했는가"를 append-only로 남긴다. 통계도 여기서 뽑는다.
  function audit(by, action, target, detail) {
    const line = JSON.stringify({ at: new Date().toISOString(), by: by || 'ana', action, target: target || '', detail: detail || '' });
    try { require('node:fs').appendFileSync(AUDIT_FILE, line + '\n'); } catch {}
  }
  function readAudit(limit) {
    let raw = '';
    try { raw = require('node:fs').readFileSync(AUDIT_FILE, 'utf8'); } catch { return []; }
    const out = [];
    for (const l of raw.split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch {} }
    return limit ? out.slice(-limit) : out;
  }
  // 소유권 — 작성자만 수정·삭제. 작성자가 없는 과거 항목은 누구나 손댈 수 있게 둔다(마이그레이션 유예).
  const owns = (rec, me) => !rec || !rec.by || rec.by === me;

  // 채팅 첨부: 터미널 에이전트는 바이너리를 받을 수 없다. 파일로 떨군 뒤 절대경로를 프롬프트에 실어 보낸다.
  const UPLOAD_DIR = opts.UPLOAD_DIR || path.join(ROOT, '.ana', 'uploads');
  const MAX_UPLOAD = opts.MAX_UPLOAD || 10 * 1024 * 1024;
  // 경로 탈출·셸 특수문자 차단: 디렉터리 성분을 버리고 안전 문자만 남긴다.
  const safeName = (n) => {
    const base = String(n || 'file').split(/[\\/]/).pop() || 'file';
    const clean = base.replace(/[^\w.\-가-힣]+/g, '_').replace(/^[._]+/, '').slice(-80);
    return clean || 'file';
  };

  // ---- 워크스페이스 ----
  // 워크스페이스마다 상태 파일이 따로 있다. 기본 워크스페이스는 기존 DATA_FILE을 그대로 쓴다(기존 데이터 보존),
  // 나머지는 DATA_FILE 옆 workspaces/<id>/work-graph.json. 요청 범위는 x-ana-workspace 헤더(또는 ?ws=)로 정하고,
  // 헤더 없는 호출(에이전트 curl·공유 페이지)은 UI에서 마지막으로 고른 active 워크스페이스를 따른다.
  // 채팅·제안 원장·진화·사용자·감사 로그는 에이전트가 하나이므로 워크스페이스 간에 공유된다.
  const DEFAULT_WS = 'default';
  const DEFAULT_WS_NAME = 'Base Workspace';
  const WS_FILE = opts.WORKSPACES_FILE || path.join(path.dirname(DATA_FILE), 'workspaces.json');
  const WS_DIR = path.join(path.dirname(WS_FILE), 'workspaces');
  const MAX_WS = 50;
  function loadWorkspaces() {
    let w; try { w = readJsonStrict(WS_FILE, () => null); } catch { w = null; }
    if (!w || typeof w !== 'object' || !Array.isArray(w.workspaces)) w = { active: DEFAULT_WS, workspaces: [] };
    w.workspaces = w.workspaces.filter((x) => x && typeof x.id === 'string' && /^[\w-]{1,40}$/.test(x.id));
    if (!w.workspaces.some((x) => x.id === DEFAULT_WS)) w.workspaces.unshift({ id: DEFAULT_WS, name: DEFAULT_WS_NAME, at: '' });
    // 예전 기본 이름('기본 워크스페이스')으로 저장된 경우 새 기본 이름으로 맞춘다(사용자가 바꾼 이름은 유지)
    const def = w.workspaces.find((x) => x.id === DEFAULT_WS);
    if (def.name === '기본 워크스페이스' || !def.name) def.name = DEFAULT_WS_NAME;
    if (!w.workspaces.some((x) => x.id === w.active)) w.active = DEFAULT_WS;
    return w;
  }
  const saveWorkspaces = (w) => writeJsonAtomic(WS_FILE, w);
  const wsExists = (id) => loadWorkspaces().workspaces.some((x) => x.id === id);
  const wsStore = new AsyncLocalStorage();
  const curWs = () => wsStore.getStore() || loadWorkspaces().active;
  const dataFileOf = (ws) => (ws === DEFAULT_WS ? DATA_FILE : path.join(WS_DIR, ws, 'work-graph.json'));
  // 0.11: 데이터 파일 이름을 개념에 맞췄다 — state.json → work-graph.json, kg.json → knowledge-graph.json,
  // ontology.json → knowledge-ontology.json, graph.sqlite → graph-index.sqlite(캐시라 옛 것은 지운다).
  // 옛 이름만 있으면 사본(<옛 이름>.pre-0.11)을 남기고 새 이름으로 옮긴다. 새 이름이 이미 있으면 건드리지 않는다.
  // DATA_FILE·ONTOLOGY_FILE을 직접 지정한 배포는 그 이름을 그대로 쓴다(이름이 새 기본값일 때만 옮긴다).
  (function migrateDataNames() {
    const fs = require('node:fs');
    const move = (from, to) => {
      try {
        if (!fs.existsSync(from) || fs.existsSync(to)) return;
        fs.copyFileSync(from, from + '.pre-0.11'); fs.renameSync(from, to);
        console.log(`[ana] renamed ${path.basename(from)} → ${path.basename(to)} in ${path.dirname(to)} (copy kept as ${path.basename(from)}.pre-0.11)`);
      } catch (e) { console.error(`[ana] could not rename ${from}: ${e.message}`); }
    };
    const dropCache = (dir) => { for (const x of ['graph.sqlite', 'graph.sqlite-wal', 'graph.sqlite-shm']) try { fs.rmSync(path.join(dir, x), { force: true }); } catch {} };
    const dirs = [];
    if (path.basename(DATA_FILE) === 'work-graph.json') { move(path.join(path.dirname(DATA_FILE), 'state.json'), DATA_FILE); }
    dirs.push(path.dirname(DATA_FILE));
    try { for (const d of fs.readdirSync(WS_DIR, { withFileTypes: true })) if (d.isDirectory()) { const w = path.join(WS_DIR, d.name); move(path.join(w, 'state.json'), path.join(w, 'work-graph.json')); dirs.push(w); } } catch {}
    for (const d of dirs) { move(path.join(d, 'kg.json'), path.join(d, 'knowledge-graph.json')); dropCache(d); }
    if (path.basename(ONTOLOGY_FILE) === 'knowledge-ontology.json') move(path.join(path.dirname(ONTOLOGY_FILE), 'ontology.json'), ONTOLOGY_FILE);
  })();
  function resolveWs(req, url) {
    const want = String((req.headers || {})['x-ana-workspace'] || (url && url.searchParams.get('ws')) || '').trim();
    return want && wsExists(want) ? want : loadWorkspaces().active;
  }
  const cleanWsName = (v) => String(v || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

  // ---- 상태 파일 (원자적 + shape 검증) ----
  function loadData(ws) {
    const file = dataFileOf(ws || curWs());
    // 처음 뜬 기본 워크스페이스에는 관계를 바로 볼 수 있는 예제 두 개를 넣는다(opts.SEED, 평생 한 번만).
    // 넣었다는 표시(.seeded)를 남겨, 사용자가 지우거나 상태 파일을 지워도 예제가 다시 생기지 않게 한다.
    const fsm = require('node:fs'), mark = path.join(path.dirname(file), '.seeded');
    if (SEED && (ws || curWs()) === DEFAULT_WS && !fsm.existsSync(file) && !fsm.existsSync(mark)) {
      writeJsonAtomic(file, require('./seed.js').seedState());
      try { fsm.writeFileSync(mark, new Date().toISOString() + '\n'); } catch {}
    }
    const s = readJsonStrict(file, () => ({ version: 1, items: [], events: [], notes: [] }));
    if (!s || typeof s !== 'object' || Array.isArray(s) || !Array.isArray(s.items))
      throw new Error(`work graph file shape invalid (${file})`);
    if (!Array.isArray(s.events)) s.events = []; // 일정(달력) — 할일(items)과 별도
    if (!Array.isArray(s.notes)) s.notes = []; // 메모 — {id, title, text, updatedAt}
    if (!Array.isArray(s.links)) s.links = []; // 명시적 관계 — {from, to, type, at, by} (graph.js 참고)
    if (typeof s.version !== 'number' || !Number.isFinite(s.version)) s.version = 1;
    return s;
  }
  const newId = (p) => p + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  const CLIENT_EVENTS = { 'tab.view': /^[a-z]{2,20}(\.[a-z]{2,20})?$/, 'ontoair.open': /^\d{1,6}$/, 'ttl.download': /^\d{1,6}$/ };
  const isExample = (x) => /^[nae]-ex-/.test(String((x && x.id) || ''));   // seed.js의 예제 id
  const saveData = (s, ws) => { relgraph.pruneLinks(s); writeJsonAtomic(dataFileOf(ws || curWs()), s); };
  // NodeRel 색인 — 워크 그래프(work-graph.json)와 지식그래프(knowledge-graph.json)에서 파생(워크스페이스마다 graph-index.sqlite)
  // 지식그래프 = 그 워크스페이스에 쌓인 개체·사실(분석 결과를 승인해 더한 것). 아래 함수들은 요청 때만 불린다.
  const graph = relgraph.createGraph({ loadData, dataFileOf, loadKg: (ws) => {
    const kg = loadKgStore(ws); if (!kg.entities.length) return null;
    const ont = systemOntology(), lens = kgLens(kg, ont);
    return { job: 'kg', ontology: ont, graph: { entities: kg.entities, facts: [...kg.facts, ...lens.inferred] } };
  } });

  function loadProposals() {
    const s = readJsonStrict(PROPOSALS_FILE, () => ({ proposals: [] }));
    if (!s || typeof s !== 'object' || !Array.isArray(s.proposals)) return { proposals: [] };
    return s;
  }
  const saveProposals = (s) => writeJsonAtomic(PROPOSALS_FILE, s);
  // CR9: pid는 proposals와 원장 pid 최댓값에서 파생(카운터 단독 신뢰 금지 → 재사용 충돌 제거)
  function nextPid(ps) {
    let max = 0;
    for (const p of ps.proposals) if (Number.isInteger(p.id) && p.id > max) max = p.id;
    for (const m of core_feed()) if (Number.isInteger(m.pid) && m.pid > max) max = m.pid;
    return max + 1;
  }

  function loadEvolve() {
    const s = readJsonStrict(EVOLVE_FILE, () => ({ next: 1, proposals: [] }));
    if (!s || typeof s !== 'object' || !Array.isArray(s.proposals)) return { next: 1, proposals: [] };
    if (typeof s.next !== 'number') s.next = 1;
    return s;
  }
  const saveEvolve = (s) => writeJsonAtomic(EVOLVE_FILE, s);

  // ---- 요청(Requests) ----
  // Evolve가 '에이전트가 앱을 바꾸자고 제안'이라면, Requests는 '에이전트가 이 시스템을 더 잘 운용하려고
  // 사용자에게 부탁'하는 것(정보·결정·행동·권한). 에이전트가 curl로 등록하고, 사용자가 답하거나 처리한다.
  // {id, kind, title, desc, options[], ref, ws, status: open|answered|done|dismissed, answer, at, closedAt}
  // approval·decision·access → 협업 › Approvals, action·info → 협업 › Requests
  const REQ_KINDS = ['info', 'decision', 'action', 'access', 'approval'];
  function loadUpdates() {
    const u = readJsonStrict(UPDATES_FILE, () => ({ next: 1, items: [], lastCheck: null }));
    if (!u || typeof u !== 'object' || !Array.isArray(u.items)) return { next: 1, items: [], lastCheck: null };
    return u;
  }
  const saveUpdates = (u) => { u.version = (u.version || 1) + 1; writeJsonAtomic(UPDATES_FILE, u); };
  const run = (cmd, args, o = {}) => new Promise((resolve, reject) => execFile(cmd, args, { timeout: 120000, maxBuffer: 32 * 1024 * 1024, ...o },
    (e, out, err) => (e ? reject(new Error(String(err || e.message).trim().split('\n').slice(-3).join(' '))) : resolve(String(out)))));
  // 업스트림을 .ana/upstream에 받아 두고(처음 clone, 그다음은 fetch + 맞춤) ana-diff.mjs로 이 ANA와 비교한다.
  // 항목 키 = 기능 id / 'module:<파일>' / 'runtime'. 취소(dismissed)한 키는 다시 올리지 않는다.
  let updateChecking = false;
  async function runUpdateCheck() {
    if (require('node:fs').existsSync(path.join(UPSTREAM_DIR, '.git'))) {
      await run('git', ['-C', UPSTREAM_DIR, 'fetch', '-q', 'origin', 'main']);
      await run('git', ['-C', UPSTREAM_DIR, 'reset', '-q', '--hard', 'origin/main']);   // 우리 전용 캐시 폴더라 되돌려도 안전
    } else {
      await fsp.mkdir(path.dirname(UPSTREAM_DIR), { recursive: true });
      await run('git', ['clone', '-q', '--filter=blob:none', UPSTREAM_URL, UPSTREAM_DIR]);
    }
    const script = path.join(UPSTREAM_DIR, 'skills', 'ana-update', 'scripts', 'ana-diff.mjs');
    const report = JSON.parse(await run(process.execPath, [script, '--target', UPDATE_TARGET, '--upstream', UPSTREAM_DIR, '--json']));
    let manifest = { features: [] }; try { manifest = JSON.parse(await fsp.readFile(path.join(UPSTREAM_DIR, 'features.json'), 'utf8')); } catch {}
    const meta = Object.fromEntries((manifest.features || []).map((f) => [f.id, f]));
    const found = [];
    for (const f of report.features) {
      const outdated = f.modules.filter((m) => m.state === 'differs').map((m) => m.file);
      if (f.status !== 'present') found.push({ key: f.id, kind: f.status, title: f.title, skill: f.skill, summary: (meta[f.id] || {}).summary || '', missing: f.missingAnchors, modules: f.modules.filter((m) => m.state !== 'same').map((m) => m.file), npm: f.npm });
      else for (const file of outdated) found.push({ key: `module:${file}`, kind: 'outdated', title: `Newer ${file}`, skill: f.skill, summary: `The upstream copy of ${file} (used by ${f.title}) is newer than this ANA's.`, missing: [], modules: [file], npm: [] });
    }
    if (report.runtime && report.runtime.state === 'differs') found.push({ key: 'runtime', kind: 'runtime', title: 'Newer shared runtime (channel-core.js)', skill: 'ana-update',
      summary: 'channel-core.js differs from upstream. It is shared by every ANA on this host — replacing it affects all of them.', missing: [], modules: ['channel-core.js'], npm: [] });
    const u = loadUpdates(), now = new Date().toISOString();
    let added = 0;
    for (const x of found) {
      const prev = u.items.filter((i) => i.key === x.key).pop();
      if (prev && prev.status === 'dismissed') continue;                            // 취소한 것은 다시 나오지 않는다
      if (prev && (prev.status === 'new' || prev.status === 'doing')) { Object.assign(prev, x, { upstreamCommit: report.upstreamCommit }); continue; }
      if (prev && (prev.status === 'done' || prev.status === 'failed') && prev.upstreamCommit === report.upstreamCommit) continue;   // 같은 업스트림에서 이미 처리함
      u.items.push({ id: u.next++, ...x, status: 'new', upstreamCommit: report.upstreamCommit, at: now }); added++;
    }
    // 이미 반영된(이번 비교에서 사라진) 대기 항목은 완료로 옮긴다
    const live = new Set(found.map((x) => x.key));
    for (const i of u.items) if ((i.status === 'new' || i.status === 'doing') && !live.has(i.key)) { i.status = 'done'; i.updatedAt = now; i.note = 'Already in this ANA'; }
    while (u.items.length > 200) { const k = u.items.findIndex((i) => i.status !== 'new' && i.status !== 'doing'); u.items.splice(k < 0 ? 0 : k, 1); }
    u.lastCheck = { at: now, upstream: UPSTREAM_URL, commit: report.upstreamCommit, changes: report.changesSinceLastSync || [], runtime: report.runtime && report.runtime.state,
      present: report.features.filter((f) => f.status === 'present').length, total: report.features.length, found: found.length, added };
    saveUpdates(u);
    return u;
  }

  // ---- 시스템 › Relations › 분석: 에이전트가 메모·할일·일정에서 온톨로지(개념·관계 종류)와 지식그래프(개체·사실)를 뽑는다 ----
  // 작업은 워크스페이스마다 analysis.json에 최근 10개. 에이전트는 /api/analysis/input으로 원문을 받고 progress·result로 보고한다.
  const analysisFileOf = (ws) => path.join(path.dirname(dataFileOf(ws)), 'analysis.json');
  function loadAnalysis(ws) {
    const a = readJsonStrict(analysisFileOf(ws), () => ({ next: 1, jobs: [] }));
    return a && Array.isArray(a.jobs) ? a : { next: 1, jobs: [] };
  }
  const saveAnalysis = (ws, a) => { a.version = (a.version || 1) + 1; writeJsonAtomic(analysisFileOf(ws), a); };
  const ANALYSIS_KINDS = { notes: 'Note', tasks: 'Task', events: 'Event' };
  const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
  // 결과 검증·정리 — 크기 상한, id 참조, 그리고 온톨로지 틀(클래스·관계 종류의 domain → range)을 지키는지.
  // base는 이 워크스페이스에 쌓인 온톨로지 — 에이전트가 거기 있는 id를 다시 써도 알아본다.
  // 틀을 어긴 사실은 버리고, 클래스를 모르는 개체는 클래스만 비운다. 둘 다 issues로 돌려준다.
  function cleanAnalysis(body, itemIds, base) {
    const o = body.ontology || {}, g = body.graph || {}, issues = [];
    const issue = (kind, msg) => { if (issues.length < 60) issues.push({ kind, msg: clip(msg, 300) }); };
    const classes = (Array.isArray(o.classes) ? o.classes : []).slice(0, 80).map((c) => ({ id: clip(c.id || c.label, 60), label: clip(c.label || c.id, 80), desc: clip(c.desc, 300), parent: c.parent ? clip(c.parent, 60) : '' })).filter((c) => c.id);
    const relations = (Array.isArray(o.relations) ? o.relations : []).slice(0, 80).map((r) => ({ id: clip(r.id || r.label, 60), label: clip(r.label || r.id, 80), domain: clip(r.domain, 60), range: clip(r.range, 60), desc: clip(r.desc, 300) })).filter((r) => r.id);
    const bc = new Map(((base && base.classes) || []).map((c) => [c.id, c])), br = new Map(((base && base.relations) || []).map((r) => [r.id, r]));
    const cls = new Map([...bc, ...classes.map((c) => [c.id, c])]), rels = new Map([...br, ...relations.map((r) => [r.id, r])]);
    for (const c of classes) if (c.parent && !cls.has(c.parent)) { issue('class', `Class "${c.id}": unknown parent "${c.parent}" — cleared`); c.parent = ''; }
    for (const r of relations) for (const end of ['domain', 'range']) if (r[end] && !cls.has(r[end])) { issue('relation', `Relation "${r.id}": unknown ${end} class "${r[end]}" — cleared (any class allowed)`); r[end] = ''; }
    // a가 b이거나 b의 하위 클래스인가(부모 사슬, 순환 방지)
    const isA = (a, b) => { for (let k = a, n = 0; k && n < 50; k = (cls.get(k) || {}).parent, n++) if (k === b) return true; return false; };
    const entities = (Array.isArray(g.entities) ? g.entities : []).slice(0, 400).map((e) => ({ id: clip(e.id || e.label, 80), label: clip(e.label || e.id, 120), class: clip(e.class, 60),
      sources: (Array.isArray(e.sources) ? e.sources : []).map(String).filter((x) => itemIds.has(x)).slice(0, 20) })).filter((e) => e.id);
    // 온톨로지는 관문이 아니라 렌즈: 틀에 없는 개념·방향이 어긋난 사실도 남기고(지식그래프에서 '아직 틀에 없음'으로 보인다) 알리기만 한다.
    // 버리는 것은 구조가 깨진 것뿐 — 없는 개체를 가리키는 사실, 관계가 비어 있는 사실.
    for (const e of entities) if (e.class && !cls.has(e.class)) issue('entity', `Entity "${e.id}": class "${e.class}" is not in the ontology yet — kept, and proposed to the admin`);
    const ent = new Map(entities.map((e) => [e.id, e]));
    const facts = [];
    for (const f0 of (Array.isArray(g.facts) ? g.facts : []).slice(0, 1200)) {
      const f = { from: clip(f0.from, 80), rel: clip(f0.rel, 60), to: clip(f0.to, 80), sources: (Array.isArray(f0.sources) ? f0.sources : []).map(String).filter((x) => itemIds.has(x)).slice(0, 20) };
      const tag = `${f.from} —${f.rel}→ ${f.to}`;
      if (!ent.has(f.from) || !ent.has(f.to)) { issue('fact', `Fact ${tag}: unknown entity — dropped`); continue; }
      if (!f.rel) { issue('fact', `Fact ${tag}: no relation — dropped`); continue; }
      const r = rels.get(f.rel);
      if (!r) { issue('fact', `Fact ${tag}: relation "${f.rel}" is not in the ontology yet — kept, and proposed to the admin`); facts.push(f); continue; }
      const fc = ent.get(f.from).class, tc = ent.get(f.to).class;
      if (r.domain && fc && cls.has(fc) && !isA(fc, r.domain)) issue('fact', `Fact ${tag}: "${f.rel}" is meant to go from ${r.domain}, but ${f.from} is a ${fc} — kept, marked as not fitting`);
      else if (r.range && tc && cls.has(tc) && !isA(tc, r.range)) issue('fact', `Fact ${tag}: "${f.rel}" is meant to go to ${r.range}, but ${f.to} is a ${tc} — kept, marked as not fitting`);
      facts.push(f);
    }
    // 이번 결과가 쓴 기존 온톨로지 항목(클래스는 부모 사슬까지)을 붙여, 이 작업만 봐도 틀이 온전하게
    const own = new Set(classes.map((c) => c.id)), ownR = new Set(relations.map((r) => r.id));
    const need = (id) => { for (let k = id, n = 0; k && n < 50 && !own.has(k) && bc.has(k); k = bc.get(k).parent, n++) { own.add(k); classes.push({ ...bc.get(k), inherited: true }); } };
    for (const f of facts) if (!ownR.has(f.rel) && br.has(f.rel)) { ownR.add(f.rel); relations.push({ ...br.get(f.rel), inherited: true }); }
    for (const e of entities) need(e.class);
    for (const r of relations) { need(r.domain); need(r.range); }
    for (const c of [...classes]) need(c.parent);
    return { ontology: { classes, relations }, graph: { entities, facts }, summary: clip(body.summary, 1000), issues };
  }

  // ---- 시스템 온톨로지 · 워크스페이스 지식그래프 ----
  // 온톨로지는 두 층: 워크 층(work-ontology.js — 워크 종류, 코드와 함께 바뀜)과 지식 층(.ana/ontology.json — 지식 종류, 관리자).
  // 사실(지식그래프)은 워크스페이스마다. 온톨로지는 관문이 아니라 렌즈다(kgLens).
  const WORK_ONTOLOGY = (() => {
    const A = require('./work-ontology.js'), one = (xs) => (xs && xs.length === 1 ? xs[0] : '');
    return {
      classes: A.classes.map((c) => ({ id: c.id, label: c.label || c.id, desc: c.desc || '', parent: c.parent || '', source: 'work' })),
      relations: A.relations.map((r) => ({ id: r.id, label: r.label || r.id, desc: r.desc || '', domain: one(r.from), range: one(r.to), from: r.from, to: r.to,
        made: r.made, ...(r.field ? { field: r.field } : {}), source: 'work' })),
      // 워크 규칙: 앱이 필드에서 계산하는 연결(DUE_ON ← Task.due …) — 읽기 전용
      rules: A.relations.filter((r) => r.made === 'derived').map((r) => ({ id: r.id, label: `${r.id} from ${r.field}`, kind: 'compute', then: r.id, field: r.field, desc: r.desc, source: 'work' })),
    };
  })();
  const isWorkConcept = (kind, id) => WORK_ONTOLOGY[kind].some((c) => c.id === id);
  const CONCEPT_ID = /^[A-Za-z][\w-]{0,59}$/;
  function loadOntology() {
    const o = readJsonStrict(ONTOLOGY_FILE, () => null);
    return o && Array.isArray(o.classes) ? { version: o.version || 1, classes: o.classes, relations: Array.isArray(o.relations) ? o.relations : [], rules: Array.isArray(o.rules) ? o.rules : [] } : { version: 1, classes: [], relations: [], rules: [] };
  }
  const saveOntology = (o) => { o.version = (o.version || 1) + 1; writeJsonAtomic(ONTOLOGY_FILE, o); };
  // 끊긴 참조: 기능이 빠져 워크 종류가 사라졌거나, 지워진 개념을 가리키는 지식 종류 — 막지 않고 관리자에게 보여 준다
  function ontologyIssues(all) {
    const cls = new Set(all.classes.map((c) => c.id)), rels = new Set(all.relations.map((r) => r.id)), out = [];
    for (const c of all.classes) if (c.parent && !cls.has(c.parent)) out.push({ kind: 'class', id: c.id, msg: `Class ${c.id}: its parent ${c.parent} is no longer in the ontology` });
    for (const r of all.relations) {
      for (const end of ['domain', 'range']) if (r[end] && !cls.has(r[end])) out.push({ kind: 'relation', id: r.id, msg: `Relation ${r.id}: its ${end === 'domain' ? 'From' : 'To'} class ${r[end]} is no longer in the ontology` });
      if (r.inverse && !rels.has(r.inverse)) out.push({ kind: 'relation', id: r.id, msg: `Relation ${r.id}: its inverse ${r.inverse} is no longer in the ontology` });
    }
    for (const x of all.rules || []) if (x.source !== 'work')
      for (const id of [...(x.if || []).map((st) => String(st).replace(/^\^/, '')), x.then, x.rel].filter(Boolean)) if (!rels.has(id)) out.push({ kind: 'rule', id: x.id, msg: `Rule ${x.label || x.id}: relation ${id} is no longer in the ontology` });
    return out;
  }
  function systemOntology() {
    const o = loadOntology();
    const knowledge = { classes: o.classes.filter((c) => !isWorkConcept('classes', c.id)).map((c) => ({ ...c, source: 'knowledge' })),
      relations: o.relations.filter((r) => !isWorkConcept('relations', r.id)).map((r) => ({ ...r, source: 'knowledge' })) };
    const all = { version: o.version || 1, classes: [...WORK_ONTOLOGY.classes, ...knowledge.classes], relations: [...WORK_ONTOLOGY.relations, ...knowledge.relations],
      rules: [...WORK_ONTOLOGY.rules, ...(o.rules || []).map((x) => ({ ...x, source: 'knowledge' }))] };
    return { ...all, issues: ontologyIssues(all) };
  }
  const kgFileOf = (ws) => path.join(path.dirname(dataFileOf(ws)), 'knowledge-graph.json');   // 이 워크스페이스의 지식그래프
  function loadKgStore(ws) {
    const k = readJsonStrict(kgFileOf(ws), () => ({ entities: [], facts: [] }));
    return k && Array.isArray(k.entities) ? { ...k, facts: Array.isArray(k.facts) ? k.facts : [] } : { entities: [], facts: [] };
  }
  const saveKgStore = (ws, k) => { k.version = (k.version || 1) + 1; writeJsonAtomic(kgFileOf(ws), k); };
  // 분석 결과(graph)를 지식그래프에 모두 더한다 — 온톨로지에 맞는지는 읽을 때 kgLens가 본다.
  // 개체는 id로, 사실은 from·rel·to로 합치고 근거(sources)를 모은다.
  function mergeIntoKg(ws, graph, jobId) {
    const kg = loadKgStore(ws), now = new Date().toISOString();
    const byId = new Map(kg.entities.map((e) => [e.id, e])), addSrc = (x, src) => { x.sources = [...new Set([...(x.sources || []), ...(src || [])])].slice(0, 30); };
    let added = 0, addedF = 0;
    for (const e of graph.entities || []) {
      const cur = byId.get(e.id);
      if (cur) { addSrc(cur, e.sources); if (!cur.class && e.class) cur.class = e.class; continue; }
      const ne = { id: e.id, label: e.label || e.id, class: e.class || '', sources: (e.sources || []).slice(0, 30), job: jobId, at: now };
      kg.entities.push(ne); byId.set(ne.id, ne); added++;
    }
    const fkey = (f) => `${f.from}\u0000${f.rel}\u0000${f.to}`, facts = new Map(kg.facts.map((f) => [fkey(f), f]));
    for (const f of graph.facts || []) {
      if (!byId.has(f.from) || !byId.has(f.to) || !f.rel) continue;      // 구조가 깨진 것만 건너뛴다
      const cur = facts.get(fkey(f));
      if (cur) { addSrc(cur, f.sources); continue; }
      const nf = { from: f.from, rel: f.rel, to: f.to, sources: (f.sources || []).slice(0, 30), job: jobId, at: now };
      kg.facts.push(nf); facts.set(fkey(nf), nf); addedF++;
    }
    if (added || addedF) saveKgStore(ws, kg);
    return { added: { entities: added, facts: addedF } };
  }
  // 온톨로지라는 렌즈로 지식그래프 읽기: 맞는지(fit)는 저장하지 않고 읽을 때 계산한다 — 관리자가 개념을 더하면 바로 '맞음'이 된다.
  // 그리고 규칙 추론: 상위 클래스(types), 역관계(inverse), 대칭(symmetric), 전이(transitive). 추론한 사실은 inferred + 근거(because).
  function kgLens(kg, ont) {
    const cls = new Map(ont.classes.map((c) => [c.id, c])), rels = new Map(ont.relations.map((r) => [r.id, r]));
    const ancestors = (c) => { const out = []; for (let k = c, n = 0; k && cls.has(k) && n < 50; k = cls.get(k).parent, n++) out.push(k); return out; };
    const isA = (a, b) => ancestors(a).includes(b);
    const ents = kg.entities.map((e) => ({ ...e, types: e.class ? ancestors(e.class) : [], fit: !e.class || cls.has(e.class), why: e.class && !cls.has(e.class) ? `class ${e.class} is not in the ontology yet` : '' }));
    const byId = new Map(ents.map((e) => [e.id, e]));
    const facts = kg.facts.map((f) => {
      const r = rels.get(f.rel), a = byId.get(f.from), b = byId.get(f.to);
      let why = '';
      if (!r) why = `relation ${f.rel} is not in the ontology yet`;
      else if (r.domain && a && a.class && cls.has(a.class) && !isA(a.class, r.domain)) why = `${f.rel} is meant to go from ${r.domain}`;
      else if (r.range && b && b.class && cls.has(b.class) && !isA(b.class, r.range)) why = `${f.rel} is meant to go to ${r.range}`;
      return { ...f, fit: !why, why };
    });
    const key = (f) => `${f.from}\u0000${f.rel}\u0000${f.to}`, have = new Set(facts.map(key)), inferred = [];
    const add = (f, rule, because, label) => { const k = key(f); if (have.has(k) || f.from === f.to || inferred.length >= 2000) return false; have.add(k); inferred.push({ ...f, inferred: true, rule, ...(label ? { ruleLabel: label } : {}), because }); return true; };
    // 규칙을 모두 '연쇄'로 바꿔 한 엔진에서 돌린다: steps = [{rel, back}] (back = 반대 방향으로 걷기), then = 결론 관계
    //  역관계 r⇄s: [^r]→s, [^s]→r · 대칭 r: [^r]→r · 전이 r: [r, r]→r · 일반 연쇄 규칙: if [..] → then
    const chains = [];
    for (const r of ont.relations) {
      if (r.inverse && rels.has(r.inverse)) { chains.push({ rule: 'inverse', steps: [{ rel: r.id, back: true }], then: r.inverse }); chains.push({ rule: 'inverse', steps: [{ rel: r.inverse, back: true }], then: r.id }); }
      if (r.symmetric) chains.push({ rule: 'symmetric', steps: [{ rel: r.id, back: true }], then: r.id });
      if (r.transitive) chains.push({ rule: 'transitive', steps: [{ rel: r.id }, { rel: r.id }], then: r.id });
    }
    for (const x of ont.rules || []) if (x.kind === 'chain' && rels.has(x.then) && (x.if || []).every((st) => rels.has(String(st).replace(/^\^/, ''))))
      chains.push({ rule: `rule:${x.id}`, label: x.label || x.id, steps: x.if.map((st) => ({ rel: String(st).replace(/^\^/, ''), back: String(st).startsWith('^') })), then: x.then });
    // 고정점: 더 늘지 않을 때까지(라운드·개수 한도 안에서). 매 라운드 저장된 사실 + 추론된 사실 위에서
    for (let round = 0; round < 8 && inferred.length < 2000; round++) {
      const all = [...facts, ...inferred], out = new Map(), inn = new Map();
      for (const f of all) { (out.get(f.from + '\u0000' + f.rel) || out.set(f.from + '\u0000' + f.rel, []).get(f.from + '\u0000' + f.rel)).push(f); (inn.get(f.to + '\u0000' + f.rel) || inn.set(f.to + '\u0000' + f.rel, []).get(f.to + '\u0000' + f.rel)).push(f); }
      const walk = (node, st) => (st.back ? (inn.get(node + '\u0000' + st.rel) || []).map((f) => [f.from, f]) : (out.get(node + '\u0000' + st.rel) || []).map((f) => [f.to, f]));
      let grew = false;
      for (const c of chains) {
        const first = c.steps[0];
        let paths = all.filter((f) => f.rel === first.rel).map((f) => (first.back ? { start: f.to, cur: f.from, by: [f] } : { start: f.from, cur: f.to, by: [f] }));
        for (const st of c.steps.slice(1)) paths = paths.flatMap((pth) => walk(pth.cur, st).map(([n, f]) => ({ start: pth.start, cur: n, by: [...pth.by, f] }))).slice(0, 5000);
        for (const pth of paths) if (add({ from: pth.start, rel: c.then, to: pth.cur }, c.rule, pth.by.map(key), c.label)) grew = true;
      }
      if (!grew) break;
    }
    // 개수 제한 규칙(검사): 한 개체에 그 관계가 max보다 많으면 그 사실들을 '안 맞음'으로 표시(렌즈 — 지우지 않는다)
    for (const x of ont.rules || []) if (x.kind === 'limit' && rels.has(x.rel) && x.max >= 1) {
      const groups = new Map();
      for (const f of facts) if (f.rel === x.rel) { const k = x.per === 'to' ? f.to : f.from; (groups.get(k) || groups.set(k, []).get(k)).push(f); }
      for (const g of groups.values()) if (g.length > x.max) for (const f of g) if (f.fit) { f.fit = false; f.why = `rule ${x.label || x.id}: at most ${x.max} ${x.rel} per ${x.per === 'to' ? 'To' : 'From'}`; f.rule = `rule:${x.id}`; }
    }
    return { entities: ents, facts, inferred, notFitting: { entities: ents.filter((e) => !e.fit).length, facts: facts.filter((f) => !f.fit).length } };
  }

  // 온톨로지 개념이 지식그래프에서 쓰이는 곳(지우기 전에 확인)
  function conceptUse(kind, id) {
    let n = 0;
    for (const w of loadWorkspaces().workspaces) {
      const kg = loadKgStore(w.id);
      n += kind === 'class' ? kg.entities.filter((e) => e.class === id).length : kg.facts.filter((f) => f.rel === id).length;
    }
    return n;
  }

  // OWL/Turtle로 내보내기(OntoAir 등 외부 뷰어용). 온톨로지 = TBox(owl:Class·ObjectProperty), 지식그래프 = ABox(개체·사실)
  function analysisTurtle(j, ws, name) {
    // '#'는 전각 '＃'로 — 줄 단위로 주석을 걷어 내는 단순한 파서(OntoAir 포함)가 문자열 속 #에서 줄을 자르지 않게
    const lit = (v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n').replace(/#/g, '＃') + '"';
    const names = new Map(), used = new Set();
    const local = (ns, id) => {
      const k = ns + '\u0000' + id; if (names.has(k)) return names.get(k);
      let n = String(id).normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^[-_]+|[-_]+$/g, '') || 'x';
      if (!/^[\p{L}_]/u.test(n)) n = '_' + n;
      let u = n, i = 2; while (used.has(ns + u)) u = `${n}_${i++}`;
      used.add(ns + u); names.set(k, `${ns}:${u}`); return `${ns}:${u}`;
    };
    const o = j.ontology || { classes: [], relations: [] }, g = j.graph || { entities: [], facts: [] };
    const baseIri = `https://ana.local/${encodeURIComponent(ws)}/${name || `analysis-${j.id}`}`;
    const out = ['@prefix owl: <http://www.w3.org/2002/07/owl#> .', '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
      '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .', `@prefix ana: <${baseIri}/ontology#> .`, `@prefix kg: <${baseIri}/kg#> .`, '',
      `ana:Ontology rdf:type owl:Ontology ;\n    rdfs:label ${lit(`ANA analysis ${j.id} (${ws})`)}${j.summary ? ` ;\n    rdfs:comment ${lit(j.summary)}` : ''} .`, '', '# Classes'];
    for (const c of o.classes) out.push(`${local('ana', c.id)} rdf:type owl:Class ;\n    rdfs:label ${lit(c.label || c.id)}${c.desc ? ` ;\n    rdfs:comment ${lit(c.desc)}` : ''}${c.parent ? ` ;\n    rdfs:subClassOf ${local('ana', c.parent)}` : ''} .`);
    out.push('', '# Relation types');
    for (const r of o.relations) out.push(`${local('ana', r.id)} rdf:type owl:ObjectProperty ;\n    rdfs:label ${lit(r.label || r.id)}${r.desc ? ` ;\n    rdfs:comment ${lit(r.desc)}` : ''}${r.domain ? ` ;\n    rdfs:domain ${local('ana', r.domain)}` : ''}${r.range ? ` ;\n    rdfs:range ${local('ana', r.range)}` : ''}${r.inverse ? ` ;\n    owl:inverseOf ${local('ana', r.inverse)}` : ''}${r.symmetric ? ` ;\n    rdf:type owl:SymmetricProperty` : ''}${r.transitive ? ` ;\n    rdf:type owl:TransitiveProperty` : ''} .`);
    // 규칙: 한 단계 연쇄 = rdfs:subPropertyOf(반대 방향이면 owl:inverseOf), 여러 단계 = owl:propertyChainAxiom, 개수 제한 = owl:maxQualifiedCardinality 제약
    const rulesOut = [];
    for (const x of (o.rules || []).filter((r) => r.source !== 'work')) {
      const stepT = (st) => (String(st).startsWith('^') ? `[ owl:inverseOf ${local('ana', String(st).slice(1))} ]` : local('ana', st));
      if (x.kind === 'chain' && (x.if || []).length === 1) rulesOut.push(String(x.if[0]).startsWith('^') ? `${local('ana', x.then)} owl:inverseOf ${local('ana', String(x.if[0]).slice(1))} .` : `${local('ana', x.if[0])} rdfs:subPropertyOf ${local('ana', x.then)} .`);
      else if (x.kind === 'chain') rulesOut.push(`${local('ana', x.then)} owl:propertyChainAxiom ( ${x.if.map(stepT).join(' ')} ) .`);
      else if (x.kind === 'limit') { const r = (o.relations || []).find((y) => y.id === x.rel) || {}, on = x.per === 'to' ? `[ owl:inverseOf ${local('ana', x.rel)} ]` : local('ana', x.rel), cls = x.per === 'to' ? r.range : r.domain;
        rulesOut.push(`${cls ? local('ana', cls) : 'owl:Thing'} rdfs:subClassOf [ rdf:type owl:Restriction ; owl:onProperty ${on} ; owl:maxCardinality "${x.max}"^^<http://www.w3.org/2001/XMLSchema#nonNegativeInteger> ] .`); }
    }
    if (rulesOut.length) out.push('', '# Rules', ...rulesOut);
    out.push('', '# Entities and facts');
    const factsOf = new Map(); for (const f of g.facts) { if (!factsOf.has(f.from)) factsOf.set(f.from, []); factsOf.get(f.from).push(f); }
    for (const e of g.entities) {
      const lines = [`rdf:type ${e.class ? local('ana', e.class) : 'owl:NamedIndividual'}`, `rdfs:label ${lit(e.label || e.id)}`];
      for (const f of factsOf.get(e.id) || []) lines.push(`${local('ana', f.rel)} ${local('kg', f.to)}`);
      out.push(`${local('kg', e.id)} ${lines.join(' ;\n    ')} .`);
    }
    return out.join('\n') + '\n';
  }
  const SHARE_TTL_MS = 24 * 3600 * 1000;
  // 공유 토큰으로 작업 찾기 — 공개 경로라 ws가 없으므로 모든 워크스페이스를 본다
  function findShared(token) {
    if (!/^[0-9a-f]{40}$/.test(token)) return null;
    for (const w of loadWorkspaces().workspaces) {
      const j = loadAnalysis(w.id).jobs.find((x) => x.share && x.share.token === token);
      if (j) return Date.parse(j.share.exp) > Date.now() && j.status === 'done' ? { ws: w.id, job: j } : null;
    }
    return null;
  }

  // ---- 관리자 함 저장소 ----
  // item: {id, type: approval|work, title, desc, ref, ws, action?, from:{kind: member|agent|check, by}, status: open|doing|done|failed|rejected|cancelled, at, updatedAt, decidedBy?, note?}
  function loadAdmin() {
    const a = readJsonStrict(ADMIN_FILE, () => ({ next: 1, items: [] }));
    return a && Array.isArray(a.items) ? a : { next: 1, items: [] };
  }
  const saveAdmin = (a) => { a.version = (a.version || 1) + 1; while (a.items.length > 200) { const i = a.items.findIndex((x) => !['open', 'doing'].includes(x.status)); a.items.splice(i < 0 ? 0 : i, 1); } writeJsonAtomic(ADMIN_FILE, a); };
  // 같은 대상(ref)이나 같은 제목의 열린 요청이 있으면 새로 만들지 않는다
  function addAdminItem(x, from, ws) {
    if (!x || typeof x !== 'object' || typeof x.title !== 'string' || !x.title.trim()) return { error: 'title required' };
    if (!['approval', 'work'].includes(x.type)) return { error: 'type must be approval|work' };
    const a = loadAdmin(), title = x.title.trim().slice(0, 200), ref = typeof x.ref === 'string' ? x.ref.slice(0, 80) : '';
    const open = a.items.find((y) => ['open', 'doing'].includes(y.status) && y.type === x.type && (ref ? y.ref === ref : y.title === title));
    if (open) return { item: open, existing: true };
    const action = x.action && typeof x.action === 'object' && ADMIN_ACTIONS[x.action.kind] ? ADMIN_ACTIONS[x.action.kind](x.action) : null;
    const now = new Date().toISOString();
    const item = { id: a.next++, type: x.type, title, desc: String(x.desc || '').slice(0, 2000), ref, ws: ws || '', ...(action ? { action } : {}), from, status: 'open', at: now, updatedAt: now };
    a.items.push(item); saveAdmin(a);
    return { item };
  }
  // 승인되면 관리자 화면이 실행할 수 있는 동작(정해 둔 것만, 값은 다시 검증)
  const ADMIN_ACTIONS = {
    'evolve.do': (a) => (Number.isInteger(a.id) ? { kind: 'evolve.do', id: a.id } : null),
    'evolve.ignore': (a) => (Number.isInteger(a.id) ? { kind: 'evolve.ignore', id: a.id } : null),
    'update.do': (a) => (typeof a.id === 'string' || Number.isInteger(a.id) ? { kind: 'update.do', id: a.id } : null),
    'permission': (a) => (/^[a-z]{2,20}$/.test(String(a.mode || '')) ? { kind: 'permission', mode: a.mode } : null),
    'ontology.add': (a) => (['class', 'relation'].includes(a.what) && a.item && CONCEPT_ID.test(String(a.item.id || '')) ? { kind: 'ontology.add', what: a.what,
      item: { id: String(a.item.id), label: clip(a.item.label || a.item.id, 80), desc: clip(a.item.desc, 300), ...(a.what === 'class' ? { parent: clip(a.item.parent, 60) } : { domain: clip(a.item.domain, 60), range: clip(a.item.range, 60) }) } } : null),
    'workspace.remove': (a) => (/^[\w-]{1,40}$/.test(String(a.id || '')) ? { kind: 'workspace.remove', id: a.id } : null),
  };
  // 점검(Trustworthiness·Safety·Security)이 risk면 관리자 실행 요청을 하나 연다. 해결되면 자동으로 닫는다.
  function syncCheckRequests(t, broadcast) {
    const a = loadAdmin(); let changed = false; const risky = new Set(), now = new Date().toISOString();
    for (const sec of ['reliability', 'safety', 'security']) for (const c of ((t[sec] || {}).checks || [])) if (c.status === 'risk') risky.add(`check:${c.id}`);
    for (const sec of ['reliability', 'safety', 'security']) for (const c of ((t[sec] || {}).checks || [])) {
      const ref = `check:${c.id}`;
      if (c.status !== 'risk' || a.items.some((y) => y.ref === ref && ['open', 'doing'].includes(y.status))) continue;
      a.items.push({ id: a.next++, type: 'work', title: `Fix: ${c.label}`.slice(0, 200), desc: [c.value, c.detail].filter(Boolean).join(' — ').slice(0, 2000), ref, ws: '',
        from: { kind: 'check', by: 'ana' }, status: 'open', at: now, updatedAt: now });
      changed = true;
    }
    for (const y of a.items) if (y.from && y.from.kind === 'check' && ['open', 'doing'].includes(y.status) && !risky.has(y.ref)) {
      y.status = 'done'; y.note = 'Resolved — the check is no longer at risk'; y.updatedAt = now; y.decidedBy = 'ana'; y.decidedAt = now; changed = true;
    }
    if (changed) { saveAdmin(a); try { broadcast({ kind: 'admin' }); } catch {} }
  }


  // ---- System › Health › Tests ----
  // package.json의 scripts.test를 '&&'로 나눠 차례로 돌린다. 'node …'는 이 서버의 Node로(npm이 PATH에 없어도 되게),
  // 환경은 최소한만 넘긴다(서버의 PORT·ANA_* 설정이 테스트에 새지 않게). 결과는 node:test 요약과 test.cjs의 '결과:' 줄에서 센다.
  const loadTests = () => { const t = readJsonStrict(TESTS_FILE, () => ({ next: 1, runs: [] })); return t && Array.isArray(t.runs) ? t : { next: 1, runs: [] }; };
  const saveTests = (t) => { while (t.runs.length > 10) t.runs.shift(); writeJsonAtomic(TESTS_FILE, t); };
  function testSteps() {
    let pkg; try { pkg = JSON.parse(require('node:fs').readFileSync(path.join(ROOT, 'package.json'), 'utf8')); } catch { return null; }
    const cmd = pkg && pkg.scripts && pkg.scripts.test; if (!cmd || /no test specified/.test(cmd)) return null;
    const steps = cmd.split('&&').map((x) => x.trim().split(/\s+/)).filter((a) => a.length);
    if (!steps.every((a) => a[0] === 'node' && a.slice(1).every((x) => /^[\w.\/-]+$/.test(x)))) return null;   // node <파일·옵션>만 — 셸을 거치지 않는다
    if (!steps.every((a) => a.slice(1).filter((x) => !x.startsWith('-')).every((f) => require('node:fs').existsSync(path.join(ROOT, f))))) return null;
    return { cmd, steps: steps.map((a) => a.slice(1)) };
  }
  function parseTestOutput(out) {
    const n = (re) => { const m = re.exec(out); return m ? Number(m[1]) : null; };
    const custom = /결과: (\d+) passed, (\d+) failed/.exec(out);
    const pass = custom ? Number(custom[1]) : n(/ℹ pass (\d+)/), fail = custom ? Number(custom[2]) : n(/ℹ fail (\d+)/);
    const failures = [...out.matchAll(/^\s*(?:✗|✖) (.+)$/gm)].map((m) => m[1].replace(/\s*\(\d+(\.\d+)?ms\)$/, '').trim()).filter((x) => x && !/^failing tests:?$/.test(x));
    return { pass: pass ?? 0, fail: fail ?? (failures.length ? failures.length : 0), failures: [...new Set(failures)].slice(0, 50) };
  }
  let testChild = null;
  function runTests(by, broadcast) {
    const plan = testSteps(); if (!plan) return { error: 'This ANA has no runnable tests (package.json scripts.test with node commands)' };
    const t = loadTests();
    if (t.runs.some((r) => r.status === 'running') && testChild) return { error: 'Tests are already running' };
    for (const r of t.runs) if (r.status === 'running') { r.status = 'error'; r.note = 'Interrupted (server restarted)'; }
    const run = { id: t.next++, status: 'running', by, at: new Date().toISOString(), cmd: plan.cmd, suites: [], pass: 0, fail: 0, log: '' };
    t.runs.push(run); saveTests(t); broadcast({ kind: 'tests' });
    const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || os.homedir(), LANG: process.env.LANG || 'C.UTF-8', TMPDIR: process.env.TMPDIR || os.tmpdir() };
    (async () => {
      for (const args of plan.steps) {
        const started = Date.now();
        const out = await new Promise((resolve) => {
          let buf = '';
          const c = testChild = require('node:child_process').spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
          const kill = setTimeout(() => { buf += '\n[ANA] Timed out after 10 minutes\n'; try { c.kill('SIGKILL'); } catch {} }, 10 * 60 * 1000);
          c.stdout.on('data', (d) => { buf += d; }); c.stderr.on('data', (d) => { buf += d; });
          c.on('close', (code) => { clearTimeout(kill); resolve({ buf, code }); });
          c.on('error', (e) => { clearTimeout(kill); resolve({ buf: buf + String(e.message), code: -1 }); });
        });
        const r = parseTestOutput(out.buf);
        const cur = loadTests(), me = cur.runs.find((x) => x.id === run.id); if (!me) return;
        me.suites.push({ name: args.filter((x) => !x.startsWith('-')).join(' ') || 'node', ms: Date.now() - started, code: out.code, ...r });
        me.pass += r.pass; me.fail += r.fail + (out.code !== 0 && !r.fail ? 1 : 0);
        me.log = (me.log + `$ node ${args.join(' ')}\n${out.buf}\n`).slice(-60000);
        saveTests(cur); broadcast({ kind: 'tests' });
      }
      const cur = loadTests(), me = cur.runs.find((x) => x.id === run.id); if (!me) return;
      me.status = me.fail ? 'failed' : 'passed'; me.doneAt = new Date().toISOString(); testChild = null;
      saveTests(cur); broadcast({ kind: 'tests' }); audit(by, `tests.${me.status}`, `${me.pass} passed, ${me.fail} failed`);
    })().catch(() => { testChild = null; });
    return { run };
  }

  function loadRequests() {
    const s = readJsonStrict(REQUESTS_FILE, () => ({ next: 1, requests: [] }));
    if (!s || typeof s !== 'object' || !Array.isArray(s.requests)) return { next: 1, requests: [] };
    if (typeof s.next !== 'number') s.next = 1;
    return s;
  }
  const saveRequests = (s) => writeJsonAtomic(REQUESTS_FILE, s);

  // feed 참조(bootstrap에서 주입) — nextPid가 원장 pid를 보게
  let _feedRef = [];
  const core_feed = () => _feedRef;
  function bootstrap(feed) { _feedRef = feed; }

  // ---- diff 검증·적용 ----
  const ITEM_FIELDS = new Set(['title', 'text', 'done', 'due', 'priority', 'category', 'sender', 'note', 'time', 'day', 'person']);
  const MAX_DIFF_ITEMS = 500;
  function validateDiff(diff) {
    if (!diff || typeof diff !== 'object' || Array.isArray(diff)) return 'diff must be an object';
    for (const k of ['add', 'update', 'remove']) if (k in diff && !Array.isArray(diff[k])) return `diff.${k} must be an array`;
    const total = (diff.add || []).length + (diff.update || []).length + (diff.remove || []).length;
    if (total > MAX_DIFF_ITEMS) return `too many diff items (>${MAX_DIFF_ITEMS})`;
    for (const a of diff.add || []) if (a === null || typeof a !== 'object' || Array.isArray(a)) return 'diff.add items must be objects';
    for (const u of diff.update || []) if (!u || typeof u !== 'object' || Array.isArray(u) || typeof u.id === 'undefined') return 'diff.update items must be objects with id';
    for (const r of diff.remove || []) if (typeof r !== 'string' && typeof r !== 'number') return 'diff.remove items must be id (string|number)';
    return null;
  }
  const hasDiff = (d) => !!d && !!((Array.isArray(d.add) && d.add.length) || (Array.isArray(d.update) && d.update.length) || (Array.isArray(d.remove) && d.remove.length));
  // 필드별 상한 — 수동 라우트(/api/todo 등)의 캡과 맞춘다. done은 불리언, 나머지는 문자열로 강제 후 절단.
  const FIELD_MAX = { title: 200, text: 20000, note: 20000, due: 40, priority: 20, category: 40, sender: 80, time: 40, day: 40, person: 80 };
  // 문자열로 안전 변환: 객체·배열은 버리고(빈 문자열), 원시값만 String화해 캡을 적용한다.
  const coerceField = (k, v) => {
    if (k === 'done') return !!v;
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return '';                 // {a:1} 같은 값이 워크 그래프 파일에 저장되지 않도록
    return String(v).slice(0, FIELD_MAX[k] || 200);
  };
  function assignFields(target, src) {
    for (const k of Object.keys(src)) {
      if (k === 'id') continue;
      if (ITEM_FIELDS.has(k)) target[k] = coerceField(k, src[k]);
    }
  }
  // 방어적 적용: caller id 무시(QA-M5), 키 화이트리스트(QA-m3), done 불리언, 실제 변경 0이면 version 미증가(QA-m2)
  function applyDiff(diff, ws) {
    const s = loadData(ws);
    const summary = { added: 0, updated: 0, removed: 0 };
    (diff.remove || []).forEach((id) => { const b = s.items.length; s.items = s.items.filter((it) => it.id !== id); if (s.items.length < b) summary.removed++; });
    (diff.update || []).forEach((u) => { const it = s.items.find((x) => x.id === u.id); if (it) { assignFields(it, u); summary.updated++; } });
    (diff.add || []).forEach((a) => { const it = { id: 'a' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), done: false }; assignFields(it, a); s.items.push(it); summary.added++; });
    const changed = summary.added || summary.updated || summary.removed;
    if (changed) { s.version = (s.version || 1) + 1; saveData(s, ws); }
    return { summary, version: s.version, changed };
  }
  // 새 항목을 만들면서 출처와 잇는다. from이 없으면 아무것도 안 한다. 오류면 문자열(저장 전이라 되돌릴 것도 없다).
  function linkFrom(s, from, to, typeByKind) {
    if (from === undefined || from === null || from === '') return null;
    const type = typeByKind[relgraph.kindOf(s, String(from))];
    if (!type) return `from must be a ${Object.keys(typeByKind).join(' or ')} id`;
    return relgraph.addLink(s, { from: String(from), to, type });
  }
  const dataVersion = (ws) => { try { return loadData(ws).version || 1; } catch { return 1; } };

  // ---- 통지 push→pull (CR11) ----
  const pendingNotifs = []; // {id, kind, text, at, delivered}
  let notifSeq = 0; // 단조 증가 카운터 — 같은 ms에 만든 알림도 id가 겹치지 않게 한다(커서 오작동 방지)
  function queueNotify(kind, text) {
    const n = { id: kind.replace(/[^a-z]/gi, '') + '-' + Date.now().toString(36) + '-' + (++notifSeq).toString(36), kind, text, at: new Date().toISOString(), delivered: false };
    pendingNotifs.push(n);
    if (pendingNotifs.length > 100) pendingNotifs.splice(0, pendingNotifs.length - 100);
    return n;
  }
  // best-effort 주입. 고정 문구 + 답하지마세요. 못 보내면 큐에 남아 pull로 조회 가능. 반환: 전달 여부.
  async function tryDeliver(ctx) {
    if (!NOTIFY_AGENT) return false;
    const n = pendingNotifs.find((x) => !x.delivered);
    if (!n) return false;
    // 이중 주입 방지: await하기 전에 이 알림을 선점(delivered=true)한다. 그래야 첫 호출의 await 도중
    // 들어온 동시 호출이 같은 알림을 미전달로 보지 않는다. 전달에 실패하면 다시 미전달로 되돌린다.
    n.delivered = true;
    try {
      if (!(await ctx.hasSession()) || !(await ctx.agentAlive()) || ctx.lastDraft) { n.delivered = false; return false; }
      const msg = `[ANA-NOTIFY id=${n.id} kind=${n.kind}] ${n.text}\n(Do not reply to this notification. Wait for the user's next request.)`;
      await ctx.enqueue(() => ctx.ch.injectText(msg));
      return true;
    } catch { n.delivered = false; return false; }
  }

  // ---- 사용량/로그인 세션 (1시간 캐시) ----
  // 오늘 토큰 사용량: ~/.claude/projects/**/*.jsonl 중 오늘 수정된 파일만 스캔.
  // 로그인 만료: macOS keychain(Claude Code-credentials) → ~/.claude/.credentials.json 폴백. 토큰 값은 절대 노출하지 않는다.
  let usageCache = { at: 0, data: null };
  // Claude Code 로그인 정보(macOS keychain → ~/.claude/.credentials.json). 토큰은 서버 밖으로 내보내지 않는다.
  async function readOauth() {
    let raw = '';
    if (process.platform === 'darwin') {
      raw = await new Promise((resolve) => execFile('security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { timeout: 3000 }, (e, so) => resolve(e ? '' : String(so))));
    }
    if (!raw) raw = await fsp.readFile(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8').catch(() => '');
    try { return (JSON.parse(raw) || {}).claudeAiOauth || null; } catch { return null; }
  }
  // ---- 시스템 › Trustworthiness · Safety · Security ----
  // 실제 상태에서 계산한 점검 목록. status: ok | info | warn | risk. 비밀값은 값이 아니라 '어디에 있는지'만 알린다.
  const RISKY_CMDS = [
    [/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i, 'Recursive force delete (rm -rf)'],
    [/\bgit\s+reset\s+--hard\b/i, 'Discards uncommitted work (git reset --hard)'],
    [/\bgit\s+push\b[^\n]*\s(--force\b|-f\b)/i, 'Force push'],
    [/\bgit\s+clean\s+-[a-z]*f/i, 'Deletes untracked files (git clean -f)'],
    [/\bkillall\b|\bpkill\s+-9\b|\bkill\s+-9\b/i, 'Kills processes by name / forcefully'],
    [/\bsudo\b/i, 'Runs as administrator (sudo)'],
    [/\bchmod\s+-R\s+777\b|\bchmod\s+777\b/i, 'Opens file permissions to everyone'],
    [/\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/i, 'Pipes a download into a shell'],
    [/\bdrop\s+(table|database)\b/i, 'Drops a database table'],
    [/\bdd\s+if=|\bmkfs\b|\bdiskutil\s+erase/i, 'Writes or erases a disk'],
  ];
  const SECRET_PATTERNS = [/sk-ant-[A-Za-z0-9_-]{10,}/, /\bsk-[A-Za-z0-9]{32,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bxox[abp]-[A-Za-z0-9-]{10,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b(password|passwd|비밀번호)\s*[:=]\s*\S{4,}/i];
  async function collectTrust(ctx) {
    const rel = [], safe = [], sec = [];
    const alive = (await ctx.hasSession().catch(() => false)) && (await ctx.agentAlive().catch(() => false));
    const where = await agentLog.resolve(ctx.target).catch(() => ({}));
    let log = null; try { log = await agentLog.read(ctx.target, 0, 400); } catch {}
    const agentName = where.kind === 'codex' ? 'Codex' : where.kind === 'claude' ? 'Claude Code' : 'Agent';
    // Trustworthiness
    rel.push(alive ? { id: 'agent', status: 'ok', label: 'Agent is running', value: `${agentName}${log && log.modelName ? ' · ' + log.modelName : ''} in ${ctx.target}` }
      : { id: 'agent', status: 'risk', label: 'Agent is not running', value: ctx.target, detail: 'Start the coding agent in its tmux session — chat and approvals wait until it is back.' });
    rel.push(log && log.available ? { id: 'log', status: 'ok', label: 'Chat comes from the agent\'s own log', value: where.kind === 'codex' ? 'Codex rollout' : 'Claude Code transcript', detail: 'Replies and tool results are recorded exactly, not scraped from the screen.' }
      : { id: 'log', status: 'warn', label: 'Chat is mirrored from the screen', detail: 'This agent has no structured log, so long replies can be cut or garbled.' });
    const tools = (log && log.items || []).filter((x) => x.kind === 'tools').flatMap((x) => x.tools).filter((t) => t.done);
    if (tools.length) {
      const bad = tools.filter((t) => t.isError).length, pct = Math.round((bad / tools.length) * 100);
      rel.push({ id: 'tools', status: pct >= 30 ? 'risk' : pct >= 10 ? 'warn' : 'ok', label: 'Tool calls that failed', value: `${bad} of ${tools.length} recent (${pct}%)`,
        detail: pct >= 10 ? 'Frequent failures usually mean a wrong path, a missing tool, or a broken environment — worth a look.' : 'Within the normal range.' });
    }
    const intr = (log && log.items || []).filter((x) => x.kind === 'event' && x.text === 'Interrupted').length;
    if (intr) rel.push({ id: 'interrupts', status: intr >= 5 ? 'warn' : 'info', label: 'Interrupted turns', value: `${intr} recently`, detail: 'Stopped by you or by an error before finishing.' });
    const lim = where.kind === 'codex' ? log && log.limits : limitsCache.data;
    for (const [k, name] of [['fiveHour', '5-hour limit'], ['week', 'Weekly limit']]) {
      const v = lim && lim.available && lim[k]; if (!v) continue;
      rel.push({ id: `limit-${k}`, status: v.percent >= 95 ? 'risk' : v.percent >= 80 ? 'warn' : 'ok', label: `Plan usage · ${name}`, value: `${v.percent}% used`, detail: v.percent >= 80 ? 'The agent may stop mid-task when the limit is reached.' : '' });
    }
    const pend = loadProposals().proposals.filter((x) => x.status === 'pending').length;
    const openAsk = loadRequests().requests.filter((x) => x.status === 'open').length;
    rel.push({ id: 'waiting', status: pend + openAsk ? 'info' : 'ok', label: 'Waiting on you', value: `${pend} approval${pend === 1 ? '' : 's'} · ${openAsk} request${openAsk === 1 ? '' : 's'}`, detail: pend + openAsk ? 'See Inbox.' : 'Nothing pending.' });
    // Safety
    const start = where.start || '';
    // 지금 권한 모드(Claude: 상태줄, Codex: turn_context). 못 읽으면 시작 옵션으로 짐작한다
    let mode = '', modeLabel = '';
    if (where.kind === 'claude') { let sc = ''; try { sc = await ctx.ch.captureScreen(); } catch {} mode = permissionMode.claudeModeOf(sc); modeLabel = (permissionMode.CLAUDE_MODES.find((m) => m.id === mode) || {}).label || ''; }
    else if (where.kind === 'codex') { const ov = permOverride.get(ctx.target); mode = (ov && (!log || (log.permRev || 0) <= ov.rev) ? ov.mode : permissionMode.codexModeOf(log && log.permTc)) || await codexDefaultMode(start); modeLabel = (permissionMode.CODEX_MODES.find((m) => m.id === mode) || {}).label || ''; }
    const bypassFlag = /--dangerously-skip-permissions|--dangerously-bypass-approvals-and-sandbox|--yolo\b/.test(start);
    const unguarded = mode ? (mode === 'bypass' || mode === 'full') : bypassFlag;
    safe.push(unguarded ? { id: 'perm', status: 'warn', label: 'The agent runs commands without asking', value: modeLabel || (start.match(/--dangerously-[\w-]+|--yolo/) || [''])[0], detail: 'Permission prompts are off, so nothing stops a destructive command. Switch the mode from the model pill in the chat (Permissions), or keep an eye on the list below.' }
      : mode ? { id: 'perm', status: 'ok', label: 'The agent asks before risky actions', value: modeLabel, detail: bypassFlag ? 'Started with permission prompts off, but the current mode asks.' : '' }
      : { id: 'perm', status: start ? 'ok' : 'info', label: start ? 'The agent asks before risky actions' : 'Permission mode unknown', value: start ? 'permission prompts on' : '', detail: start ? '' : 'Could not read the current mode.' });
    const risky = [];
    for (const t of tools.concat((log && log.items || []).filter((x) => x.kind === 'tools').flatMap((x) => x.tools).filter((t) => !t.done))) {
      const c = t.cmd || (t.name === 'Bash' ? t.arg : ''); if (!c) continue;
      const hit = RISKY_CMDS.find(([re]) => re.test(c)); if (!hit) continue;
      // 명령이 길어도 위험한 부분이 보이게 — 걸린 곳 앞뒤만 잘라 보여 준다
      const m = hit[0].exec(c), i = m ? m.index : 0, from = Math.max(0, i - 30);
      risky.push({ what: hit[1], cmd: `${from ? '…' : ''}${c.slice(from, i + 90).replace(/\s+/g, ' ').trim()}${i + 90 < c.length ? '…' : ''}` });
    }
    safe.push(risky.length ? { id: 'risky', status: 'warn', label: 'Risky commands the agent ran recently', value: `${risky.length}`, items: risky.slice(-8).reverse().map((r) => `${r.what} — ${r.cmd}`) }
      : { id: 'risky', status: 'ok', label: 'No risky commands recently', value: `${tools.length} commands checked`, detail: 'Looks for rm -rf, reset --hard, force push, killall, sudo, curl | sh, DROP TABLE, disk writes.' });
    safe.push({ id: 'gate', status: 'ok', label: 'Data changes go through approval', value: `${pend} waiting`, detail: 'The agent proposes a diff; nothing changes on the board until you approve it in Inbox › Approvals.' });
    // Security
    const bind = String(opts.BIND || '127.0.0.1');
    const loop = /^(127\.|::1$|localhost$)/.test(bind);
    sec.push(loop ? { id: 'bind', status: 'ok', label: 'Only this computer can reach the server', value: `${bind}:${opts.PORT || ''}`.replace(/:$/, ''), detail: 'Remote access goes through your gateway or tunnel.' }
      : { id: 'bind', status: 'risk', label: 'The server listens on the network', value: bind, detail: 'Anyone on this network can reach it. Bind to 127.0.0.1 and use a signed-in gateway.' });
    sec.push(ID_HEADER ? { id: 'signin', status: 'ok', label: 'People sign in through the gateway', value: `identity header: ${ID_HEADER}` }
      : { id: 'signin', status: loop ? 'info' : 'risk', label: 'No sign-in (single-user mode)', detail: 'Whoever can open the dashboard can drive the agent. Fine on your own computer; put a signed-in gateway in front for remote use.' });
    sec.push({ id: 'csrf', status: 'ok', label: 'Requests from other sites are blocked', value: 'origin + content-type check on every write' });
    sec.push({ id: 'token', status: 'ok', label: 'Your AI login stays on the server', detail: 'Usage limits are read with your local login; the token is never sent to the browser.' });
    try {
      const cf = path.join(os.homedir(), '.claude', '.credentials.json');
      const st = await fsp.stat(cf);
      if (st.mode & 0o077) sec.push({ id: 'credfile', status: 'warn', label: 'Claude login file is readable by other users', value: `~/.claude/.credentials.json (${(st.mode & 0o777).toString(8)})`, detail: 'Run: chmod 600 ~/.claude/.credentials.json' });
    } catch {}
    if (/--remote-control\b/.test(start)) sec.push({ id: 'remote', status: 'info', label: 'Remote control is on', detail: 'This agent session can also be driven from your claude.ai account.' });
    const found = [];
    try {
      const s = loadData(curWs());
      const scan = (kind, title, text) => { if (SECRET_PATTERNS.some((re) => re.test(String(text || '')))) found.push(`${kind}: ${String(title || '').slice(0, 60) || '(untitled)'}`); };
      (s.notes || []).forEach((n) => scan('Note', n.title || String(n.text || '').split('\n')[0], `${n.title || ''}\n${n.text || ''}`));
      (s.items || []).forEach((t) => scan('Task', t.title || t.text, `${t.title || ''} ${t.text || ''}`));
      (s.events || []).forEach((e) => scan('Event', e.title, e.title));
    } catch {}
    sec.push(found.length ? { id: 'secrets', status: 'warn', label: 'Possible secrets saved in your data', value: `${found.length}`, detail: 'API keys or passwords in notes are sent to the agent and kept in history. Move them to a password manager.', items: found.slice(0, 8) }
      : { id: 'secrets', status: 'ok', label: 'No secrets found in notes, tasks or events', detail: 'Checks for API keys, tokens, private keys and "password:" lines.' });
    const count = (list) => ({ risk: list.filter((x) => x.status === 'risk').length, warn: list.filter((x) => x.status === 'warn').length });
    return { at: Date.now(), target: ctx.target, reliability: { checks: rel, ...count(rel) }, safety: { checks: safe, ...count(safe) }, security: { checks: sec, ...count(sec) } };
  }

  // 요금제 한도(5시간·주간) — Claude Code의 /usage와 같은 곳(api.anthropic.com/api/oauth/usage)에서 읽는다. 1분 캐시.
  let limitsCache = { at: 0, data: null };
  async function collectLimits() {
    const oa = await readOauth();
    if (!oa || !oa.accessToken) return { available: false, error: 'Not signed in to Claude Code' };
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${oa.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { available: false, error: `Usage unavailable (HTTP ${r.status})` };
    const j = await r.json();
    const pick = (x) => (x && Number.isFinite(x.utilization) ? { percent: Math.round(x.utilization), resetsAt: x.resets_at || null } : null);
    return { available: true, fiveHour: pick(j.five_hour), week: pick(j.seven_day), checkedAt: Date.now() };
  }
  async function collectUsage() {
    const out = { checkedAt: Date.now(), today: null, login: null };
    try {
      const root = path.join(os.homedir(), '.claude', 'projects');
      const day = new Date(); day.setHours(0, 0, 0, 0); const since = day.getTime();
      let input = 0, output = 0, cacheRead = 0, msgs = 0;
      const dirs = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const pdir = path.join(root, d.name);
        for (const f of await fsp.readdir(pdir).catch(() => [])) {
          if (!f.endsWith('.jsonl')) continue;
          const fp = path.join(pdir, f);
          const st = await fsp.stat(fp).catch(() => null);
          if (!st || st.mtimeMs < since) continue;
          for (const line of (await fsp.readFile(fp, 'utf8').catch(() => '')).split('\n')) {
            if (!line.includes('"usage"')) continue;
            try {
              const j = JSON.parse(line);
              const u = j.message && j.message.usage;
              if (!u || (j.timestamp && Date.parse(j.timestamp) < since)) continue;
              input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
              cacheRead += u.cache_read_input_tokens || 0;
              output += u.output_tokens || 0; msgs++;
            } catch {}
          }
        }
      }
      out.today = { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, messages: msgs };
    } catch {}
    try {
      const oa = await readOauth();
      if (oa && Number.isFinite(oa.expiresAt)) out.login = {
        expiresAt: oa.expiresAt,
        daysLeft: Math.floor((oa.expiresAt - Date.now()) / 86400000),
        subscriptionType: typeof oa.subscriptionType === 'string' ? oa.subscriptionType : null,
      };
    } catch {}
    return out;
  }

  // ---- 라우트 ----
  // 모든 라우트를 요청의 워크스페이스 범위 안에서 실행한다(await를 건너도 범위가 유지되도록 AsyncLocalStorage).
  const extraApi = (req, res, url, ctx) => wsStore.run(resolveWs(req, url), () => routes(req, res, url, ctx));
  const OFFLINE = !!opts.OFFLINE;
  // 오프라인에서 거절하는 라우트: 인터넷(사용량 조회·업데이트 확인)이나 에이전트(설정·분석 지시)가 있어야 하는 것
  const OFFLINE_BLOCKED = ['/api/limits', '/api/update/check', '/api/update-act', '/api/agent-setting', '/api/agent-models', '/api/agent-permission',
    '/api/analysis/start', '/api/analysis/share', '/api/requirements/analyze', '/api/agentlog'];
  // 요구사항(협업 › Requirements) — 진화 제안과 이어지므로(제안 완료 → 다시 확인) 라우트 밖에서도 읽고 쓴다
  const loadRequirements = () => { const r = readJsonStrict(REQUIREMENTS_FILE, () => ({ next: 1, items: [], jobNext: 1, jobs: [] })); return r && Array.isArray(r.items) ? r : { next: 1, items: [], jobNext: 1, jobs: [] }; };
  const saveRequirements = (r, broadcast) => { r.version = (r.version || 1) + 1; writeJsonAtomic(REQUIREMENTS_FILE, r); broadcast({ kind: 'requirements', version: r.version }); };
  async function routes(req, res, url, ctx) {
    const p = url.pathname;
    if (OFFLINE) {
      // 페이지에 오프라인 표시를 심어 보낸다 — JS가 돌기 전부터 에이전트 화면이 숨겨지게
      if ((p === '/' || p === '/dashboard.html') && (req.method === 'GET' || req.method === 'HEAD')) {
        const html = Buffer.from(require('node:fs').readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8').replace('<html', '<html data-offline="1"'));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length, 'cache-control': 'no-store' });
        return res.end(req.method === 'HEAD' ? undefined : html), true;
      }
      if (OFFLINE_BLOCKED.some((x) => p === x || p.startsWith(x + '/')))
        return sendJson(res, 503, { error: 'Offline mode — this needs an AI agent or the internet' }), true;
    }
    if (await fileApi(req, res, url)) return true;
    const { commit, broadcast, csrfOk, jsonBody } = ctx;

    // ---- 워크스페이스 목록/추가/선택/이름 변경/삭제/순서 변경 ----
    if (p === '/api/workspaces' && req.method === 'GET') {
      const w = loadWorkspaces();
      return sendJson(res, 200, { active: w.active, current: curWs(), workspaces: w.workspaces }), true;
    }
    if (p === '/api/workspaces' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      const w = loadWorkspaces();
      const me = actor(req);
      let target;
      if (body.action === 'add') {
        const name = cleanWsName(body.name);
        if (!name) return sendJson(res, 400, { error: 'name required' }), true;
        if (w.workspaces.length >= MAX_WS) return sendJson(res, 413, { error: `too many workspaces (>${MAX_WS})` }), true;
        if (w.workspaces.some((x) => x.name === name)) return sendJson(res, 409, { error: 'A workspace with that name already exists' }), true;
        target = { id: newId('w'), name, by: me, at: new Date().toISOString() };
        w.workspaces.push(target);
        w.active = target.id;                    // 만든 워크스페이스로 바로 전환
        audit(me, 'workspace.add', name);
      } else if (body.action === 'select') {
        target = w.workspaces.find((x) => x.id === body.id);
        if (!target) return sendJson(res, 404, { error: 'not found' }), true;
        w.active = target.id;
      } else if (body.action === 'rename') {
        target = w.workspaces.find((x) => x.id === body.id);
        if (!target) return sendJson(res, 404, { error: 'not found' }), true;
        const name = cleanWsName(body.name);
        if (!name) return sendJson(res, 400, { error: 'name required' }), true;
        if (w.workspaces.some((x) => x.id !== target.id && x.name === name)) return sendJson(res, 409, { error: 'A workspace with that name already exists' }), true;
        audit(me, 'workspace.rename', name, target.name);
        target.name = name;
      } else if (body.action === 'remove') {
        // 기본 워크스페이스는 지울 수 없다(기본 워크 그래프 파일의 주인). 나머지는 목록에서 빼고,
        // 데이터 폴더는 바로 지우지 않고 workspaces/.deleted/로 옮겨 둔다(실수 복구용).
        if (body.id === DEFAULT_WS) return sendJson(res, 400, { error: 'The base workspace cannot be deleted' }), true;
        if (!isAdmin(req)) return needAdmin(res, 'Deleting a workspace');
        target = w.workspaces.find((x) => x.id === body.id);
        if (!target) return sendJson(res, 404, { error: 'not found' }), true;
        const dir = path.join(WS_DIR, target.id);
        graph.close(target.id);   // graph-index.sqlite 핸들을 닫고 폴더를 옮긴다
        const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        try {
          await fsp.mkdir(path.join(WS_DIR, '.deleted'), { recursive: true });
          await fsp.rename(dir, path.join(WS_DIR, '.deleted', `${target.id}-${stamp}`));
        } catch (e) { if (e.code !== 'ENOENT') return sendJson(res, 500, { error: `Delete failed: ${e.message}` }), true; }
        w.workspaces = w.workspaces.filter((x) => x.id !== target.id);
        if (w.active === target.id) w.active = DEFAULT_WS;
        audit(me, 'workspace.remove', target.name);
      } else if (body.action === 'reorder') {
        // ids = 원하는 순서. 모르는 id는 무시하고, 빠진 워크스페이스는 기존 순서대로 뒤에 붙인다(누락 방지).
        if (!Array.isArray(body.ids)) return sendJson(res, 400, { error: 'ids must be an array' }), true;
        const byId = new Map(w.workspaces.map((x) => [x.id, x]));
        const seen = new Set();
        const next = [];
        for (const id of body.ids) if (byId.has(id) && !seen.has(id)) { seen.add(id); next.push(byId.get(id)); }
        for (const x of w.workspaces) if (!seen.has(x.id)) next.push(x);
        w.workspaces = next;
        target = null;
      } else return sendJson(res, 400, { error: 'action must be add|select|rename|remove|reorder' }), true;
      saveWorkspaces(w);
      broadcast({ kind: 'workspaces', active: w.active });
      return sendJson(res, 200, { ok: true, active: w.active, workspace: target, workspaces: w.workspaces }), true;
    }

    // ---- 내 계정 ----
    if (p === '/api/me' && req.method === 'GET') {
      const email = who(req);
      if (email) touchUser(email);
      return sendJson(res, 200, {
        signedIn: !!email, role: roleOf(req),
        // 단일 사용자 모드에서도 로컬 프로필('ana' 키)을 돌려준다 — 이름·아바타 저장이 동작하도록.
        // email은 항상 'ana': 콘텐츠가 by:'ana'로 기록되므로 클라이언트 isMine()이 일치해야
        // 수정/삭제 버튼이 프로필 저장 전에도 보인다.
        me: email ? profileOf(email) : (loadUsers().users.ana || { email: 'ana', name: 'ANA', avatar: '' }),
        // 신원이 안 잡힐 때 원인을 눈으로 확인하기 위한 진단:
        //  single  = ANA_IDENTITY_HEADER 미설정(단일 사용자 모드)
        //  header  = 지정한 헤더에서 식별자를 읽음
        //  missing = 헤더 이름은 설정됐는데 요청에 그 헤더가 없음(앞단 설정 확인)
        via: !ID_HEADER ? 'single' : (email ? 'header' : 'missing'),
        idHeader: ID_HEADER,
        logoutUrl: LOGOUT_URL,
      }), true;
    }
    if (p === '/api/me' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const email = who(req);
      // 헤더 기반 배포에서 신원이 안 잡히면 거절. 단일 사용자 모드는 'ana' 로컬 프로필에 저장한다
      // (콘텐츠도 전부 by:'ana'로 기록되므로 소유권 판정과 일관된다).
      if (!email && ID_HEADER) return sendJson(res, 401, { error: 'Sign-in required' }), true;
      const key = email || 'ana';
      const body = await jsonBody(req, res); if (!body) return true;
      const u = loadUsers();
      const now = new Date().toISOString();
      if (!u.users[key]) u.users[key] = { email: key, name: email ? key.split('@')[0] : 'ANA', avatar: '', firstSeen: now, lastSeen: now };
      else u.users[key].lastSeen = now;
      const cur = u.users[key];
      // 표시 이름은 채팅 발신자 접두어 [이름·이메일]에 그대로 실린다. 구분자('[', ']', '·')와 개행을
      // 지우지 않으면 이름을 조작해 남을 사칭할 수 있으므로(멀티유저 스푸핑) 저장 전에 제거한다.
      const cleanName = (v) => String(v).replace(/[[\]·\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (body.name !== undefined) cur.name = cleanName(body.name) || (email ? key.split('@')[0] : 'ANA');
      if (body.avatar !== undefined) cur.avatar = safeName(String(body.avatar).split('/').pop() || '') === 'file' ? '' : safeName(String(body.avatar).split('/').pop());
      saveUsers(u);
      audit(key, 'profile.update', key, cur.name);
      return sendJson(res, 200, { ok: true, me: cur }), true;
    }
    // ---- 사람 목록(작성자 표시용) ----
    if (p === '/api/users' && req.method === 'GET') {
      return sendJson(res, 200, { users: Object.values(loadUsers().users) }), true;
    }
    // ---- 활동 이력 / 통계 ----
    // 화면 안에서만 일어나는 일(탭 열기, OntoAir 열기, .ttl 받기) — 종류와 대상 id만, 정해 둔 것만 받는다
    if (p === '/api/activity' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      const rule = CLIENT_EVENTS[body.action], target = String(body.target == null ? '' : body.target);
      if (!rule || !rule.test(target)) return sendJson(res, 400, { error: 'unknown event' }), true;
      audit(actor(req), body.action, target);
      return sendJson(res, 200, { ok: true }), true;
    }
    if (p === '/api/activity' && req.method === 'GET') {
      const me = who(req);
      const mine = url.searchParams.get('mine') === '1';
      let list = readAudit(0).slice(-500).reverse();
      if (mine && me) list = list.filter((a) => a.by === me);
      return sendJson(res, 200, { activity: list.slice(0, 200), me }), true;
    }
    if (p === '/api/stats' && req.method === 'GET') {
      const me = who(req);
      const log = readAudit(0);
      const users = loadUsers().users;
      const day = (iso) => String(iso).slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);
      const per = {};      // by → {total, today, actions:{}}
      const actions = {};  // action → count
      const daily = {};    // YYYY-MM-DD → count (최근 14일)
      for (const a of log) {
        const b = a.by || 'ana';
        per[b] = per[b] || { by: b, name: (users[b] && users[b].name) || (b === 'ana' ? 'ANA' : b.split('@')[0]), avatar: (users[b] && users[b].avatar) || '', total: 0, today: 0, actions: {} };
        per[b].total++; if (day(a.at) === today) per[b].today++;
        per[b].actions[a.action] = (per[b].actions[a.action] || 0) + 1;
        actions[a.action] = (actions[a.action] || 0) + 1;
        daily[day(a.at)] = (daily[day(a.at)] || 0) + 1;
      }
      const days = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
        days.push({ date: d, count: daily[d] || 0 });
      }
      let s4 = null; try { s4 = loadData(); } catch {}
      let g4 = null; try { g4 = graph.stats(curWs()); } catch (e) { g4 = { error: e.message }; }
      const mineCount = (arr) => (arr || []).filter((x) => x.by === me).length;
      return sendJson(res, 200, {
        me,
        mine: me ? {
          ...(per[me] || { total: 0, today: 0, actions: {} }),
          todos: mineCount(s4 && s4.items),
          events: mineCount(s4 && s4.events), notes: mineCount(s4 && s4.notes),
        } : null,
        all: {
          total: log.length, actions, days,
          people: Object.values(per).sort((a, b) => b.total - a.total),
          todos: (s4 && s4.items || []).length,
          events: (s4 && s4.events || []).length, notes: (s4 && s4.notes || []).length,
        },
        graph: g4,
      }), true;
    }

    if (p === '/api/tests' && req.method === 'GET') {
      const t = loadTests(), plan = testSteps(), last = t.runs[t.runs.length - 1] || null;
      return sendJson(res, 200, { available: !!plan, command: plan ? plan.cmd : '', last, runs: t.runs.slice().reverse().map(({ log, ...r }) => r) }), true;
    }
    if (p === '/api/tests/run' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      if (!isAdmin(req)) return needAdmin(res, 'Running the tests');
      const r = runTests(actor(req), broadcast);
      if (r.error) return sendJson(res, 409, { error: r.error }), true;
      return sendJson(res, 200, { ok: true, run: r.run }), true;
    }
    if (p === '/api/trust' && req.method === 'GET') {
      try { const t = await collectTrust(ctx); syncCheckRequests(t, broadcast); return sendJson(res, 200, t), true; }
      catch (e) { return sendJson(res, 500, { error: 'Checks failed', detail: e.message }), true; }
    }

    if (p === '/api/limits' && req.method === 'GET') {
      // Codex 세션이면 그 세션 기록(token_count)의 한도를, 아니면 Claude 요금제 한도를 준다
      const target = String(url.searchParams.get('target') || '');
      if (target && /^[\w.:@%+-]{1,100}$/.test(target)) {
        const r = await agentLog.resolve(target);
        if (r.kind === 'codex') { const d = await agentLog.read(target, 1e12).catch(() => null); return sendJson(res, 200, (d && d.limits) || { available: false }), true; }
      }
      if (!limitsCache.data || Date.now() - limitsCache.at > 60_000) {
        let data; try { data = await collectLimits(); } catch (e) { data = { available: false, error: 'Usage unavailable' }; }
        limitsCache = { at: Date.now(), data };
      }
      return sendJson(res, 200, limitsCache.data), true;
    }

    if (p === '/api/usage' && req.method === 'GET') {
      if (!usageCache.data || Date.now() - usageCache.at > 3600_000) {
        usageCache = { at: Date.now(), data: await collectUsage() };
      }
      return sendJson(res, 200, usageCache.data), true;
    }

    // 예제 정리: 첫 실행 예제(id가 n-/a-/e-ex-로 시작)를 지우거나(clear) 그대로 두기로(keep) 한다
    if (p === '/api/examples' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      let s; try { s = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      if (body.action === 'keep') s.examplesKept = true;
      else if (body.action === 'clear') {
        const before = s.items.length + s.events.length + s.notes.length;
        s.items = s.items.filter((x) => !isExample(x)); s.events = s.events.filter((x) => !isExample(x)); s.notes = s.notes.filter((x) => !isExample(x));
        audit(actor(req), 'examples.clear', `${before - s.items.length - s.events.length - s.notes.length} items`);
        try { require('node:fs').writeFileSync(path.join(path.dirname(dataFileOf(curWs())), '.seeded'), new Date().toISOString() + '\n'); } catch {}   // 예전에 넣은 예제도 다시 생기지 않게
      } else return sendJson(res, 400, { error: 'action must be clear|keep' }), true;
      s.version = (s.version || 1) + 1; saveData(s);   // saveData가 끝점이 사라진 관계도 걷어 낸다
      broadcast({ kind: 'data', version: s.version });
      return sendJson(res, 200, { ok: true, version: s.version }), true;
    }
    if (p === '/api/state' && req.method === 'GET') {
      let s; try { s = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      const ps = loadProposals();
      const ws = curWs();
      let g; try { g = graph.view(ws, s); } catch (e) { g = { links: [], error: e.message }; }
      return sendJson(res, 200, { ...s, workspace: ws, graph: g,
        proposals: ps.proposals.filter((x) => x.status === 'pending' && (x.ws || DEFAULT_WS) === ws).slice(-50) }), true;
    }

    // ---- 관계 그래프(NodeRel) ----
    // 읽기: 이웃·추적·AI 스키마. 쓰기는 /api/link 하나 — 원천(state.links)을 고치면 다음 읽기에서 인덱스가 다시 만들어진다.
    if (p.startsWith('/api/graph') && req.method === 'GET') {
      const ws = curWs();
      try {
        if (p === '/api/graph') return sendJson(res, 200, { scope: ws, ...graph.view(ws) }), true;
        if (p === '/api/graph/neighbors') {
          const r = graph.neighbors(ws, String(url.searchParams.get('id') || ''));
          return r ? (sendJson(res, 200, r), true) : (sendJson(res, 404, { error: 'not found' }), true);
        }
        if (p === '/api/graph/trace') {
          const depth = Number(url.searchParams.get('depth') || 2);
          const types = String(url.searchParams.get('types') || '').split(',').map((x) => x.trim()).filter(Boolean);
          return sendJson(res, 200, { nodes: graph.trace(ws, { id: String(url.searchParams.get('id') || ''),
            direction: url.searchParams.get('direction') || 'both', maxDepth: depth, types }) }), true;
        }
        if (p === '/api/graph/schema') return sendJson(res, 200, graph.describe(ws)), true;
      } catch (e) { return sendJson(res, 400, { error: e.message }), true; }
      return sendJson(res, 404, { error: 'not found' }), true;
    }
    // 관계 추가·삭제 — {action:'add'|'remove', from, to, type}
    if (p === '/api/link' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      let s; try { s = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      const link = { from: body.from, to: body.to, type: body.type };
      const nameOf = (id) => { const x = [...s.items, ...s.events, ...s.notes].find((y) => y.id === id); return x ? String(x.title || x.text || '(untitled)').split('\n')[0].slice(0, 30) : id; };
      const label = () => `${link.type} ${nameOf(link.from)} → ${nameOf(link.to)}`;
      if (body.action === 'add') {
        const err = relgraph.addLink(s, link, actor(req));
        if (err) return sendJson(res, 400, { error: err }), true;
        audit(actor(req), 'link.add', label());
      } else if (body.action === 'remove') {
        if (!relgraph.removeLink(s, link)) return sendJson(res, 404, { error: 'not found' }), true;
        audit(actor(req), 'link.remove', label());
      } else return sendJson(res, 400, { error: 'action must be add|remove' }), true;
      s.version = (s.version || 1) + 1; saveData(s);
      broadcast({ kind: 'data', version: s.version });
      return sendJson(res, 200, { ok: true, version: s.version }), true;
    }

    // 채팅 첨부 업로드(base64 JSON — csrfOk가 JSON content-type을 요구하므로 multipart 대신 사용)
    if (p === '/api/upload' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const cap = Math.ceil(MAX_UPLOAD * 4 / 3) + 8192;   // base64 팽창분 + 필드 여유
      const body = await jsonBody(req, res, cap); if (!body) return true;
      const b64 = typeof body.data === 'string' ? body.data.replace(/^data:[^,]*,/, '') : '';
      if (!b64) return sendJson(res, 400, { error: 'data required (base64)' }), true;
      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) return sendJson(res, 400, { error: 'empty file' }), true;
      if (buf.length > MAX_UPLOAD) return sendJson(res, 413, { error: `file too large (>${MAX_UPLOAD} bytes)` }), true;
      const name = safeName(body.name);
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const file = path.join(UPLOAD_DIR, `${stamp}-${crypto.randomBytes(3).toString('hex')}-${name}`);
      try {
        await fsp.mkdir(UPLOAD_DIR, { recursive: true });
        await fsp.writeFile(file, buf);
      } catch (e) { return sendJson(res, 500, { error: `Save failed: ${e.message}` }), true; }
      audit(actor(req), 'upload.attach', `${(path.extname(name) || '?').toLowerCase()} ${buf.length}`);   // 종류·크기만(파일 이름은 남기지 않는다)
      return sendJson(res, 200, { ok: true, path: file, name, size: buf.length }), true;
    }

    // 화면 캡처 라이브러리(그리기 → 컨텍스트 칩). npm 의존성을 그대로 내려줘 CDN 없이 오프라인에서도 동작한다.
    if (p === '/vendor/modern-screenshot.mjs' && (req.method === 'GET' || req.method === 'HEAD')) {
      let body; try { body = await fsp.readFile(path.join(path.dirname(require.resolve('modern-screenshot/package.json')), 'dist', 'index.mjs')); }
      catch { return sendJson(res, 404, { error: 'modern-screenshot not installed — run npm install' }), true; }
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400' });
      return res.end(req.method === 'HEAD' ? undefined : body), true;
    }

    // 업로드 파일 서빙 — 파일명 성분만 받고 UPLOAD_DIR 안으로 해석되는지 재확인(경로 탈출 차단)
    if (p.startsWith('/uploads/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const name = safeName(decodeURIComponent(p.slice('/uploads/'.length)));
      const abs = path.join(UPLOAD_DIR, name);
      if (path.dirname(abs) !== UPLOAD_DIR) return sendJson(res, 403, { error: 'forbidden' }), true;
      let st; try { st = await fsp.stat(abs); } catch { return sendJson(res, 404, { error: 'not found' }), true; }
      if (!st.isFile()) return sendJson(res, 404, { error: 'not found' }), true;
      const ext = path.extname(abs).toLowerCase();
      const type = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
        '.webp': 'image/webp', '.heic': 'image/heic', '.pdf': 'application/pdf' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'public, max-age=86400' });
      if (req.method === 'HEAD') return res.end(), true;
      require('node:fs').createReadStream(abs).pipe(res);
      return true;
    }

    // 에이전트 pull 통지 조회
    if (p === '/api/notifications' && req.method === 'GET') {
      const since = url.searchParams.get('since') || '';
      let list;
      if (!since) list = pendingNotifs;
      else {
        const idx = pendingNotifs.findIndex((n) => n.id === since);
        // 커서 id가 큐에 없다(상한으로 밀려남·재시작·무효 id) → 큐 전체를 되돌리면 이미 처리한 알림을
        // 재전송하게 되므로, 안전하게 '새것 없음'으로 폴백한다.
        list = idx === -1 ? [] : pendingNotifs.slice(idx + 1);
      }
      return sendJson(res, 200, { notifications: list }), true;
    }

    // 에이전트 리치 응답: 텍스트 또는 diff 제안
    if (p === '/api/agent' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (text && Buffer.byteLength(text) > MAX_TEXT) return sendJson(res, 413, { error: `text too long (>${MAX_TEXT} bytes)` }), true;
      // diff 키가 존재하면 항상 검증(깨진 diff를 text 뒤로 조용히 무시하지 않음 — 에이전트에 명시적 400)
      if (body.diff !== undefined) { const err = validateDiff(body.diff); if (err) return sendJson(res, 400, { error: err }), true; }
      if (!text && !hasDiff(body.diff)) return sendJson(res, 400, { error: 'text or diff required' }), true;
      if (hasDiff(body.diff)) {
        const ps = loadProposals();
        const pr = { id: nextPid(ps), text: text || 'Change proposal', diff: body.diff, status: 'pending', ws: curWs(), at: new Date().toISOString() };
        ps.proposals.push(pr); saveProposals(ps);
        const entry = commit({ role: 'proposal', text: pr.text, src: 'api', pid: pr.id });
        broadcast({ kind: 'commit', messages: [entry] });
        broadcast({ kind: 'proposal', proposal: pr });
        return sendJson(res, 200, { ok: true, pid: pr.id, seq: entry.seq }), true;
      }
      const entry = commit({ role: 'assistant', text, src: 'api' });
      broadcast({ kind: 'commit', messages: [entry] });
      return sendJson(res, 200, { ok: true, seq: entry.seq }), true;
    }

    // 사용자 승인/거절 → 승인 시 diff 적용(version++)
    if (p === '/api/approve' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      if (body.decision !== 'approve' && body.decision !== 'reject') return sendJson(res, 400, { error: "decision must be 'approve' or 'reject'" }), true;
      const ps = loadProposals();
      const pr = ps.proposals.find((x) => x.id === body.pid);
      if (!pr || (pr.status !== 'pending' && pr.status !== 'failed')) return sendJson(res, 400, { error: 'invalid or already-decided proposal' }), true;   // 실패한 것은 다시 시도·거절할 수 있다
      audit(actor(req), `approval.${body.decision}`, `#${pr.id}`);
      if (body.decision === 'approve') {
        // 제안이 만들어진 워크스페이스가 그새 삭제됐으면 적용하지 않는다(빈 폴더가 되살아나지 않게)
        if (!wsExists(pr.ws || DEFAULT_WS)) return sendJson(res, 409, { error: 'The workspace for this proposal was deleted' }), true;
        // 상태를 먼저 마킹·저장(부분 실패 시 이중 적용 방지 — QA/BE-M8), 그다음 적용
        pr.status = 'applying'; saveProposals(ps);
        let result;
        try { result = applyDiff(pr.diff, pr.ws || DEFAULT_WS); }
        catch (e) {   // 실패는 '대기'로 조용히 되돌리지 않고 Failed로 남긴다(이유와 함께) — 다시 시도하거나 거절할 수 있다
          pr.status = 'failed'; pr.failReason = String(e.message || e).replace(/'\/[^']*\/([^'/]+)'/g, "'$1'").replace(/(^|\s)\/\S*\/([^\s/]+)/g, '$1$2').slice(0, 300);   // 긴 절대 경로는 파일 이름만
          pr.decidedAt = new Date().toISOString(); saveProposals(ps);
          broadcast({ kind: 'proposal', proposal: pr });
          return sendJson(res, 500, { error: 'apply failed', detail: e.message }), true;
        }
        pr.status = 'applied'; pr.failReason = ''; pr.decidedAt = new Date().toISOString(); saveProposals(ps);
        const entry = commit({ role: 'system', text: `Changes applied (+${result.summary.added} ~${result.summary.updated} -${result.summary.removed}, v${result.version})`, src: 'api' });
        broadcast({ kind: 'commit', messages: [entry] });
        broadcast({ kind: 'proposal', proposal: pr });
        broadcast({ kind: 'data', version: result.version });
        const n = queueNotify('proposal.applied', `Proposal #${pr.id} approved → already applied by the server (v${result.version}). No refetch needed.`);
        const notified = await tryDeliver(ctx);
        return sendJson(res, 200, { ok: true, applied: true, version: result.version, notified, notifyId: n.id }), true;
      }
      pr.status = 'rejected'; pr.decidedAt = new Date().toISOString(); saveProposals(ps);
      const entry = commit({ role: 'system', text: `Proposal #${pr.id} was rejected.`, src: 'api' });
      broadcast({ kind: 'commit', messages: [entry] });
      broadcast({ kind: 'proposal', proposal: pr });
      broadcast({ kind: 'data', version: dataVersion(pr.ws || DEFAULT_WS) }); // 거절도 version 노출 갱신(remote: 폴링 스테일 방지)
      const n = queueNotify('proposal.rejected', `Proposal #${pr.id} rejected${body.reason ? ' — reason: ' + String(body.reason).replace(/[\r\n]+/g, ' ').slice(0, 200) : ''}.`);
      const notified = await tryDeliver(ctx);
      return sendJson(res, 200, { ok: true, applied: false, notified, notifyId: n.id }), true;
    }

    // 직접 적용(제안 없이)
    if (p === '/api/apply' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      if (!hasDiff(body.diff)) return sendJson(res, 400, { error: 'diff required' }), true;
      const err = validateDiff(body.diff);
      if (err) return sendJson(res, 400, { error: err }), true;
      let result; try { result = applyDiff(body.diff); } catch (e) { return sendJson(res, 500, { error: 'apply failed', detail: e.message }), true; }
      if (result.changed) broadcast({ kind: 'data', version: result.version });
      return sendJson(res, 200, { ok: true, version: result.version, changed: !!result.changed, summary: result.summary }), true;
    }

    // 완료 토글 — 서버 저장(다기기 공유)
    if (p === '/api/done' && req.method === 'POST') {
      // 완료 토글은 소유자 제한 없이 허용하되(팀 작업), 누가 눌렀는지는 남긴다.
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      let s; try { s = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      const it = s.items.find((x) => x.id === body.id);
      if (!it) return sendJson(res, 404, { error: 'not found' }), true;
      it.done = !!body.done;
      touchUser(actor(req)); audit(actor(req), it.done ? 'todo.done' : 'todo.undone', String(it.title).slice(0, 80));
      s.version = (s.version || 1) + 1; saveData(s);
      broadcast({ kind: 'data', version: s.version });
      return sendJson(res, 200, { ok: true, version: s.version, id: body.id, done: it.done }), true;
    }

    // 일정(달력) CRUD — {action:'add'|'remove'|'done', ...}
    if (p === '/api/event' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      let s; try { s = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      let createdId;
      if (body.action === 'add') {
        const title = String(body.title || '').trim();
        const date = String(body.date || '').trim();
        if (!title) return sendJson(res, 400, { error: 'title required' }), true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { error: 'date must be YYYY-MM-DD' }), true;
        const time = String(body.time || '').trim();
        if (time && !/^\d{2}:\d{2}$/.test(time)) return sendJson(res, 400, { error: 'time must be HH:MM' }), true;
        const ev = { id: newId('e'), title: title.slice(0, 200), date, time, done: false, by: actor(req) };
        s.events.push(ev);
        // from: 메모면 SPAWNED(메모에서 나온 일정), 할일이면 SCHEDULED_AS(그 할일을 할 시간)
        const err = linkFrom(s, body.from, ev.id, { Note: 'SPAWNED', Task: 'SCHEDULED_AS' });
        if (err) return sendJson(res, 400, { error: err }), true;
        audit(actor(req), 'event.add', title.slice(0, 80));
        createdId = ev.id;
      } else if (body.action === 'remove') {
        const ev = s.events.find((e) => e.id === body.id);
        if (!ev) return sendJson(res, 404, { error: 'not found' }), true;
        if (!owns(ev, actor(req))) return sendJson(res, 403, { error: 'Only the author can delete this' }), true;
        s.events = s.events.filter((e) => e.id !== body.id);
        audit(actor(req), 'event.remove', String(ev.title).slice(0, 80));
      } else if (body.action === 'done') {
        const e = s.events.find((x) => x.id === body.id);
        if (!e) return sendJson(res, 404, { error: 'not found' }), true;
        e.done = !!body.done;
      } else return sendJson(res, 400, { error: 'action must be add|remove|done' }), true;
      s.version = (s.version || 1) + 1; saveData(s);
      broadcast({ kind: 'data', version: s.version });
      return sendJson(res, 200, { ok: true, version: s.version, id: createdId }), true;
    }

    // 할일 수동 추가 — {title, due?}
    if (p === '/api/todo' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      const title = String(body.title || '').trim();
      if (!title) return sendJson(res, 400, { error: 'title required' }), true;
      let s; try { s = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      const it = { id: newId('a'), title: title.slice(0, 200), done: false, by: actor(req) };
      if (body.due && /^\d{4}-\d{2}-\d{2}$/.test(String(body.due))) it.due = String(body.due);
      s.items.push(it);
      const err = linkFrom(s, body.from, it.id, { Note: 'SPAWNED' });   // from: 이 할일이 나온 메모
      if (err) return sendJson(res, 400, { error: err }), true;
      touchUser(actor(req)); audit(actor(req), 'todo.add', title.slice(0, 80));
      s.version = (s.version || 1) + 1; saveData(s);
      broadcast({ kind: 'data', version: s.version });
      return sendJson(res, 200, { ok: true, version: s.version, id: it.id }), true;
    }

    // 워크 항목의 하위 종류 — {id, type}. Ticket ⊂ Task처럼 지식 종류가 워크 종류의 하위 종류일 때 그 항목에 붙인다.
    // 앱은 그대로 Task로 다루고, 지식 쪽은 Ticket으로 읽는다(코드 수정 없는 확장). type ''이면 뗀다.
    if (p === '/api/subtype' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      let s; try { s = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      const id = String(body.id || ''), kind = relgraph.kindOf(s, id), it = [...s.items, ...s.events, ...s.notes].find((x) => x.id === id);
      if (!it || !kind) return sendJson(res, 404, { error: 'not found' }), true;
      const t = String(body.type || '');
      if (t) {
        const cls = new Map(systemOntology().classes.map((c) => [c.id, c]));
        let k = t, ok = false;
        for (let n = 0; k && cls.has(k) && n < 50; k = cls.get(k).parent, n++) if (cls.get(k).parent === kind) { ok = true; break; }
        if (!ok || cls.get(t).source === 'work') return sendJson(res, 400, { error: `${t} is not a kind of ${kind} in the ontology` }), true;
        it.subtype = t;
      } else delete it.subtype;
      audit(actor(req), 'item.subtype', `${id} ${t || '(none)'}`);
      s.version = (s.version || 1) + 1; saveData(s); broadcast({ kind: 'data', version: s.version });
      return sendJson(res, 200, { ok: true, version: s.version }), true;
    }

    // 할일 삭제 — {id}
    if (p === '/api/todo-remove' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      let s; try { s = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      const it = s.items.find((x) => x.id === body.id);
      if (!it) return sendJson(res, 404, { error: 'not found' }), true;
      if (!owns(it, actor(req))) return sendJson(res, 403, { error: 'Only the author can delete this' }), true;
      s.items = s.items.filter((x) => x.id !== body.id);
      audit(actor(req), 'todo.remove', String(it.title).slice(0, 80));
      s.version = (s.version || 1) + 1; saveData(s);
      broadcast({ kind: 'data', version: s.version });
      return sendJson(res, 200, { ok: true, version: s.version }), true;
    }

    // 메모 CRUD — {action:'add'|'update'|'remove', ...}
    if (p === '/api/note' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      let s; try { s = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      let noteId;
      if (body.action === 'add') {
        const n = { id: newId('n'), title: String(body.title || '').slice(0, 200), text: String(body.text || '').slice(0, 20000), by: actor(req), updatedAt: new Date().toISOString() };
        s.notes.push(n); noteId = n.id;
        touchUser(actor(req)); audit(actor(req), 'note.add', n.title.slice(0, 80) || '(untitled)');
      } else if (body.action === 'update') {
        const n = s.notes.find((x) => x.id === body.id);
        if (!n) return sendJson(res, 404, { error: 'not found' }), true;
        if (!owns(n, actor(req))) return sendJson(res, 403, { error: 'Only the author can edit this' }), true;
        if (body.title !== undefined) n.title = String(body.title).slice(0, 200);
        if (body.text !== undefined) n.text = String(body.text).slice(0, 20000);
        n.updatedAt = new Date().toISOString(); noteId = n.id;
      } else if (body.action === 'remove') {
        const n = s.notes.find((x) => x.id === body.id);
        if (!n) return sendJson(res, 404, { error: 'not found' }), true;
        if (!owns(n, actor(req))) return sendJson(res, 403, { error: 'Only the author can delete this' }), true;
        s.notes = s.notes.filter((x) => x.id !== body.id);
        audit(actor(req), 'note.remove', String(n.title).slice(0, 80) || '(untitled)');
      } else return sendJson(res, 400, { error: 'action must be add|update|remove' }), true;
      s.version = (s.version || 1) + 1; saveData(s);
      broadcast({ kind: 'data', version: s.version });
      return sendJson(res, 200, { ok: true, version: s.version, id: noteId }), true;
    }

    // 에이전트 대화 기록(Claude Code JSONL) — {available, title, rev, items}. 없으면 화면은 채널 원장으로 그린다.
    if ((p === '/api/agentlog' || p === '/api/agentlog/img') && req.method === 'GET') {
      const target = String(url.searchParams.get('target') || '');
      if (!/^[\w.:@%+-]{1,100}$/.test(target)) return sendJson(res, 400, { error: 'target required' }), true;
      if (p === '/api/agentlog') {
        // prefetch=1: 세션 콤보를 열었을 때 미리 읽기 시작만 하고 바로 돌아온다(크기·읽는 중 여부)
        if (url.searchParams.get('prefetch') === '1') {
          try { return sendJson(res, 200, await agentLog.prefetch(target)), true; } catch (e) { return sendJson(res, 200, { available: false, error: e.message }), true; }
        }
        const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : undefined;
        try { return sendJson(res, 200, await agentLog.read(target, Number(url.searchParams.get('since')) || 0, url.searchParams.get('limit') || 40, before)), true; }
        catch (e) { return sendJson(res, 200, { available: false, error: e.message }), true; }
      }
      const img = await agentLog.image(target, url.searchParams.get('ref'));
      if (!img) return sendJson(res, 404, { error: 'not found' }), true;
      res.writeHead(200, { 'content-type': img.type, 'content-length': img.data.length, 'cache-control': 'private, max-age=86400' });
      return res.end(img.data), true;
    }

    // 권한 모드(모델 시트 › Permissions) — Claude는 상태줄, Codex는 rollout turn_context로 현재 모드를 읽는다
    if (p === '/api/agent-permission' && req.method === 'GET') {
      const where = await agentLog.resolve(ctx.target);
      if (where.kind === 'claude') {
        let screen = ''; try { screen = await ctx.ch.captureScreen(); } catch {}
        const bypassOk = /--dangerously-skip-permissions/.test(where.start || '');
        return sendJson(res, 200, { kind: 'claude', current: permissionMode.claudeModeOf(screen),
          options: permissionMode.CLAUDE_MODES.map(({ id, label, desc, risky }) => ({ id, label, desc, risky: !!risky, available: id !== 'bypass' || bypassOk || !where.start })) }), true;
      }
      if (where.kind === 'codex') {
        const log = await agentLog.read(ctx.target, 1e12).catch(() => null);
        const ov = permOverride.get(ctx.target);
        let current = ov && (!log || (log.permRev || 0) <= ov.rev) ? ov.mode : permissionMode.codexModeOf(log && log.permTc);
        if (!current) current = await codexDefaultMode(where.start);   // 첫 대화 전에는 rollout이 없다 → 시작 옵션·설정으로 짐작
        return sendJson(res, 200, { kind: 'codex', current,
          options: permissionMode.CODEX_MODES.map(({ id, label, desc, risky }) => ({ id, label, desc, risky: !!risky, available: true })) }), true;
      }
      return sendJson(res, 200, { kind: '', current: '', options: [] }), true;
    }
    if (p === '/api/agent-permission' && req.method === 'POST') {
      if (!ctx.csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await ctx.jsonBody(req, res); if (!body) return true;
      if (body.target && body.target !== ctx.target) return sendJson(res, 409, { error: 'Agent session changed — reopen the model selector' }), true;
      if (!(await ctx.hasSession()) || !(await ctx.agentAlive())) return sendJson(res, 409, { error: 'Agent is not running' }), true;
      const where = await agentLog.resolve(ctx.target);
      const modes = where.kind === 'claude' ? permissionMode.CLAUDE_MODES : where.kind === 'codex' ? permissionMode.CODEX_MODES : [];
      if (!modes.some((m) => m.id === body.mode)) return sendJson(res, 400, { error: `mode must be ${modes.map((m) => m.id).join('|') || '(no agent)'}` }), true;
      if (modes.find((m) => m.id === body.mode).risky && !isAdmin(req)) return needAdmin(res, `Switching the agent to "${modes.find((m) => m.id === body.mode).label}"`);
      const out = await ctx.enqueue(async () => {
        try {
          const r2 = where.kind === 'claude' ? await permissionMode.changeClaude(ctx, body.mode, where.start) : await permissionMode.changeCodex(ctx, body.mode);
          if (where.kind === 'codex') { const log = await agentLog.read(ctx.target, 1e12).catch(() => null); permOverride.set(ctx.target, { mode: body.mode, rev: (log && log.rev) || 0 }); }
          audit(actor(req), 'agent.permission', `${ctx.target}: ${body.mode}`);
          return { status: 200, body: r2 };
        } catch (e) { return { status: 409, body: { error: e.message } }; }
      });
      return sendJson(res, out.status, out.body), true;
    }

    if (p === '/api/agent-models' && req.method === 'GET') {
      try { return sendJson(res, 200, { models: await codexSettings.models() }), true; }
      catch { return sendJson(res, 503, { error: 'Codex model catalog is unavailable — open Codex once and retry' }), true; }
    }

    // 모델·노력 바꾸기(Claude Code 세션) — /model·/effort 슬래시 명령을 보낸사람 표기 없이 그대로 주입한다.
    // 값은 화이트리스트만 받는다(임의 명령 주입 방지). Claude Code는 이 선택을 새 세션 기본값으로도 저장한다.
    if (p === '/api/agent-setting' && req.method === 'POST') {
      if (!ctx.csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await ctx.jsonBody(req, res); if (!body) return true;
      if (body.target && body.target !== ctx.target) return sendJson(res, 409, { error: 'Agent session changed — reopen the model selector' }), true;
      const kind = (await agentLog.resolve(ctx.target)).kind;
      if (kind === 'codex') {
        const out = await ctx.enqueue(async () => {
          try {
            const catalog = await codexSettings.models();
            const current = await agentLog.read(ctx.target, 0);
            const model = catalog.find(m => m.id === (body.model || current.model));
            if (!model) return { status: 400, body: { error: 'Choose an available Codex model' } };
            const effort = body.effort || (model.efforts.includes(current.effort) ? current.effort : model.defaultEffort);
            if (!model.efforts.includes(effort)) return { status: 400, body: { error: 'Unsupported reasoning effort for this model' } };
            if (!body.model && !body.effort) return { status: 400, body: { error: 'model or effort required' } };
            if (!(await ctx.hasSession()) || !(await ctx.agentAlive())) return { status: 409, body: { error: 'Agent is not running' } };
            return { status: 200, body: await codexSettings.change(ctx, model, effort) };
          } catch (e) { return { status: 409, body: { error: e.message } }; }
        });
        return sendJson(res, out.status, out.body), true;
      }
      const MODELS = ['opus', 'fable', 'sonnet', 'haiku'], EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
      const cmds = [];
      if (body.model !== undefined) { if (!MODELS.includes(body.model)) return sendJson(res, 400, { error: `model must be ${MODELS.join('|')}` }), true; cmds.push(`/model ${body.model}`); }
      if (body.effort !== undefined) { if (!EFFORTS.includes(body.effort)) return sendJson(res, 400, { error: `effort must be ${EFFORTS.join('|')}` }), true; cmds.push(`/effort ${body.effort}`); }
      if (!cmds.length) return sendJson(res, 400, { error: 'model or effort required' }), true;
      if (!(await ctx.hasSession()) || !(await ctx.agentAlive())) return sendJson(res, 409, { error: 'Agent is not running' }), true;
      if ((await agentLog.resolve(ctx.target)).kind !== 'claude') return sendJson(res, 409, { error: 'Model switching works for Claude Code sessions only' }), true;
      const out = await ctx.enqueue(async () => {
        try {
          const result = {};
          for (const c of cmds) {
            if (!(await ctx.waitInputReady())) return { status: 409, body: { error: 'Agent input line is not ready — check the terminal' } };
            await ctx.injectText(c, true, true);
            // Claude Code가 화면에 남기는 결과 줄로 실제로 바뀌었는지 확인한다('Kept model as …'면 거절된 것)
            await ctx.ch.delay(1200);
            let screen = ''; try { screen = await ctx.ch.captureScreen(); } catch {}
            const tail = screen.split('\n').slice(-30).join('\n').replace(/`/g, '');
            if (c.startsWith('/model')) {
              const kept = [...tail.matchAll(/Kept model as ([^\n(]+)/g)].pop(), set = [...tail.matchAll(/Set model to ([^\n]+?)(?: and saved|$)/gm)].pop();
              const k = kept ? tail.lastIndexOf(kept[0]) : -1, s = set ? tail.lastIndexOf(set[0]) : -1;
              result.model = s > k ? { changed: true, name: set[1].trim() } : k >= 0 ? { changed: false, name: kept[1].trim() } : { changed: null };
            } else {
              const m = [...tail.matchAll(/Set effort level to (\w+)/g)].pop();
              result.effort = m ? { changed: true, level: m[1] } : { changed: null };
            }
          }
          return { status: 200, body: { ok: true, ...result } };
        } catch (e) { return { status: 500, body: { error: e.message } }; }
      });
      return sendJson(res, out.status, out.body), true;
    }

    // 요청 조회 — 현재 워크스페이스 것 + 워크스페이스와 무관한 것(ws 없음)
    if (p === '/api/requests' && req.method === 'GET') {
      const ws = curWs(), rq = loadRequests();
      return sendJson(res, 200, { version: rq.version || 1, requests: rq.requests.filter((x) => !x.ws || x.ws === ws) }), true;
    }
    // 요청 등록(에이전트 curl) — {requests:[{kind, title, desc?, options?, ref?, workspace?:true}]} 또는 단건
    if (p === '/api/requests' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      const incoming = Array.isArray(body.requests) ? body.requests : (body.title ? [body] : []);
      const rq = loadRequests(), ws = curWs();
      const openTitles = new Set(rq.requests.filter((x) => x.status === 'open').map((x) => x.title.trim()));
      const added = [];
      for (const x of incoming) {
        if (!x || typeof x !== 'object' || typeof x.title !== 'string' || !x.title.trim()) continue;
        if (x.kind !== undefined && !REQ_KINDS.includes(x.kind)) return sendJson(res, 400, { error: `invalid kind: ${x.kind} (${REQ_KINDS.join('|')})` }), true;
        const title = x.title.trim().slice(0, 200);
        if (openTitles.has(title)) continue;   // 같은 요청이 열려 있으면 다시 만들지 않는다
        openTitles.add(title);
        const r2 = { id: rq.next++, kind: x.kind || 'info', title, desc: String(x.desc || '').slice(0, 2000),
          options: (Array.isArray(x.options) ? x.options : []).map((o) => String(o).trim().slice(0, 80)).filter(Boolean).slice(0, 6),
          ref: typeof x.ref === 'string' ? x.ref.slice(0, 60) : '', ws: x.workspace === false ? '' : ws,
          status: 'open', answer: '', at: new Date().toISOString() };
        rq.requests.push(r2); added.push(r2);
      }
      if (!added.length && !incoming.length) return sendJson(res, 400, { error: 'requests[] with title required' }), true;
      // 닫힌 것부터 덜어 100개 안쪽으로 유지
      while (rq.requests.length > 100) { const i = rq.requests.findIndex((x) => x.status !== 'open'); rq.requests.splice(i < 0 ? 0 : i, 1); }
      rq.version = (rq.version || 1) + 1; saveRequests(rq);
      broadcast({ kind: 'requests', version: rq.version });
      return sendJson(res, 200, { ok: true, ids: added.map((x) => x.id), added: added.length, version: rq.version }), true;
    }
    // 요청 처리 — {id, action: answer|done|dismiss|reopen, answer?}
    //  answer: 답을 기록(에이전트에게는 화면이 채팅으로 보낸다) → answered
    //  done:   사용자가 직접 처리함(또는 에이전트가 처리 완료) → done, 에이전트에게 통지
    //  dismiss: 지금은 안 함 → dismissed, 에이전트에게 통지   reopen: 다시 open
    if (p === '/api/request-act' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      if (!['answer', 'done', 'fail', 'dismiss', 'reopen'].includes(body.action)) return sendJson(res, 400, { error: 'action must be answer|done|fail|dismiss|reopen' }), true;
      const rq = loadRequests();
      const r2 = rq.requests.find((x) => x.id === body.id);
      if (!r2) return sendJson(res, 404, { error: 'not found' }), true;
      if (body.action === 'answer') {
        const answer = String(body.answer || '').trim();
        if (!answer) return sendJson(res, 400, { error: 'answer required' }), true;
        r2.answer = answer.slice(0, 4000); r2.status = 'answered'; r2.answeredAt = new Date().toISOString();
      } else if (body.action === 'reopen') { r2.status = 'open'; r2.closedAt = ''; r2.failReason = ''; }
      else {
        r2.status = { done: 'done', fail: 'failed', dismiss: 'dismissed' }[body.action]; r2.closedAt = new Date().toISOString();
        if (body.action === 'fail') r2.failReason = String(body.reason || '').trim().slice(0, 1000);
      }
      audit(actor(req), `request.${body.action}`, `#${r2.id}`);
      rq.version = (rq.version || 1) + 1; saveRequests(rq);
      broadcast({ kind: 'requests', version: rq.version });
      let notified;
      if (body.action === 'done' || body.action === 'dismiss' || body.action === 'fail') {
        const what = { done: 'marked done by the user', dismiss: 'dismissed by the user (not now)', fail: `marked failed${r2.failReason ? ': ' + r2.failReason.replace(/[\r\n]+/g, ' ') : ''}` }[body.action];
        queueNotify(`request.${body.action}`, `Request #${r2.id} "${r2.title.replace(/[\r\n]+/g, ' ')}" was ${what}.`);
        notified = await tryDeliver(ctx);
      }
      return sendJson(res, 200, { ok: true, status: r2.status, version: rq.version, notified }), true;
    }

    // 업데이트(시스템 › Update)
    if (p === '/api/updates' && req.method === 'GET') return sendJson(res, 200, { ...loadUpdates(), checking: updateChecking, upstreamDir: UPSTREAM_DIR }), true;
    if (p === '/api/update/check' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      if (updateChecking) return sendJson(res, 409, { error: 'A check is already running' }), true;
      updateChecking = true;
      try { const u = await runUpdateCheck(); audit(actor(req), 'update.check', `${u.lastCheck.found} found`); broadcast({ kind: 'updates', version: u.version }); return sendJson(res, 200, { ok: true, lastCheck: u.lastCheck }), true; }
      catch (e) { return sendJson(res, 502, { error: `Update check failed — ${e.message}` }), true; }
      finally { updateChecking = false; }
    }
    if (p === '/api/update-act' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      if (!['do', 'done', 'fail', 'ignore', 'reopen'].includes(body.action)) return sendJson(res, 400, { error: 'action must be do|done|fail|ignore|reopen' }), true;
      const u = loadUpdates(); const it = u.items.find((x) => x.id === body.id);
      if (!it) return sendJson(res, 404, { error: 'not found' }), true;
      if (['do', 'ignore', 'reopen'].includes(body.action) && !isAdmin(req)) return needAdmin(res, `Updating "${it.title}"`);
      it.status = { do: 'doing', done: 'done', fail: 'failed', ignore: 'dismissed', reopen: 'new' }[body.action];
      it.updatedAt = new Date().toISOString();
      it.failReason = body.action === 'fail' ? String(body.reason || '').trim().slice(0, 1000) : '';
      saveUpdates(u); audit(actor(req), `update.${body.action}`, it.title.slice(0, 80));
      broadcast({ kind: 'updates', version: u.version });
      return sendJson(res, 200, { ok: true, status: it.status, item: it, upstreamDir: UPSTREAM_DIR }), true;
    }

    // ---- 요구사항(Requirements): 사용자가 적고, 에이전트가 반영 여부·방법·안 된 이유를 분석 ----
    if (p.startsWith('/api/requirements')) {
      const save = (r) => saveRequirements(r, broadcast);
      const rq = loadRequirements(); rq.jobs = rq.jobs || []; rq.jobNext = rq.jobNext || 1;
      const now = new Date().toISOString(), cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
      const jobOf = (id) => rq.jobs.find((j) => j.id === Number(id));
      if (p === '/api/requirements' && req.method === 'GET') return sendJson(res, 200, { items: rq.items, job: rq.jobs[rq.jobs.length - 1] || null }), true;
      if (p === '/api/requirements/input' && req.method === 'GET') {
        const j = jobOf(url.searchParams.get('job')); if (!j) return sendJson(res, 404, { error: 'no such analysis' }), true;
        return sendJson(res, 200, { job: j.id, root: ROOT, features: path.join(ROOT, 'features.json'), changelog: path.join(ROOT, 'CHANGELOG.md'),
          requirements: rq.items.filter((x) => j.ids.includes(x.id)).map(({ id, title, detail, at, analysis }) => ({ id, title, detail, at, previous: analysis ? { status: analysis.status, at: analysis.at } : null })) }), true;
      }
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' }), true;
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res, 2 * 1024 * 1024); if (!body) return true;
      if (p === '/api/requirements') {
        if (body.action === 'add') {
          const title = cut(body.title, 200); if (!title) return sendJson(res, 400, { error: 'title required' }), true;
          const it = { id: rq.next++, title, detail: cut(body.detail, 4000), by: actor(req), at: now, updatedAt: now, analysis: null };
          rq.items.push(it); save(rq); audit(actor(req), 'requirement.add', title.slice(0, 80)); return sendJson(res, 200, { ok: true, item: it }), true;
        }
        const it = rq.items.find((x) => x.id === Number(body.id)); if (!it) return sendJson(res, 404, { error: 'not found' }), true;
        if (body.action === 'update') {
          const title = cut(body.title ?? it.title, 200); if (!title) return sendJson(res, 400, { error: 'title required' }), true;
          const changed = title !== it.title || cut(body.detail ?? it.detail, 4000) !== it.detail;
          it.title = title; it.detail = cut(body.detail ?? it.detail, 4000); it.updatedAt = now;
          if (changed && it.analysis) it.analysis.stale = true;      // 내용이 바뀌면 이전 분석은 '다시 분석 필요'
          save(rq); audit(actor(req), 'requirement.update', `#${it.id}`); return sendJson(res, 200, { ok: true, item: it }), true;
        }
        if (body.action === 'remove') { rq.items = rq.items.filter((x) => x !== it); save(rq); audit(actor(req), 'requirement.remove', it.title.slice(0, 80)); return sendJson(res, 200, { ok: true }), true; }
        // 반영 안 됨·일부 반영을 진화 제안으로 — 분석의 '다음 단계'를 그대로 옮기고 요구사항 번호를 단다.
        // 그 제안이 완료되면(evolve-act done) 이 요구사항은 '다시 확인 필요'가 된다: 요구사항 → 제안 → 승인 → 재확인
        if (body.action === 'propose') {
          const a = it.analysis;
          if (!a || !['missing', 'partial'].includes(a.status)) return sendJson(res, 409, { error: 'Only a requirement that is not (fully) reflected can become a proposal' }), true;
          const ev = loadEvolve();
          const open = ev.proposals.find((x) => x.reqId === it.id && ['new', 'doing'].includes(x.status));
          if (open) return sendJson(res, 200, { ok: true, proposal: open, existing: true }), true;
          const desc = [a.next && `Next step: ${a.next}`, a.why && `Why not yet: ${a.why}`, it.detail && `Requirement: ${it.detail}`].filter(Boolean).join('\n');
          const pr = { id: ev.next++, type: a.status === 'missing' ? 'add' : 'improve', title: `Requirement #${it.id}: ${it.title}`.slice(0, 200), desc: desc.slice(0, 1000),
            status: 'new', at: now, reqId: it.id, by: actor(req), scope: 'system' };
          ev.proposals.push(pr); if (ev.proposals.length > 50) ev.proposals = ev.proposals.slice(-50);
          ev.version = (ev.version || 1) + 1; saveEvolve(ev); broadcast({ kind: 'evolve', version: ev.version });
          it.proposalId = pr.id; it.recheck = null; save(rq);
          audit(actor(req), 'requirement.propose', `#${it.id} → proposal #${pr.id}`);
          return sendJson(res, 200, { ok: true, proposal: pr }), true;
        }
        return sendJson(res, 400, { error: 'action must be add|update|remove|propose' }), true;
      }
      if (p === '/api/requirements/analyze') {
        if (rq.jobs.some((j) => j.status === 'running')) return sendJson(res, 409, { error: 'An analysis is already running — wait for it or cancel it' }), true;
        const ids = (Array.isArray(body.ids) && body.ids.length ? body.ids.map(Number) : rq.items.map((x) => x.id)).filter((id) => rq.items.some((x) => x.id === id));
        if (!ids.length) return sendJson(res, 400, { error: 'Add a requirement first' }), true;
        const j = { id: rq.jobNext++, status: 'running', progress: 0, step: 'Waiting for the agent', ids, at: now, updatedAt: now };
        rq.jobs.push(j); while (rq.jobs.length > 10) rq.jobs.shift(); save(rq); audit(actor(req), 'requirement.analyze', `${ids.length} requirements`);
        return sendJson(res, 200, { ok: true, job: j }), true;
      }
      const j = jobOf(body.job); if (!j) return sendJson(res, 404, { error: 'no such analysis' }), true;
      if (j.status !== 'running') return sendJson(res, 409, { error: `analysis is ${j.status}` }), true;
      if (p === '/api/requirements/progress') {
        const pct = Number(body.progress); if (Number.isFinite(pct)) j.progress = Math.max(j.progress, Math.min(99, Math.round(pct)));
        if (body.step) j.step = cut(body.step, 200); j.updatedAt = now; save(rq); return sendJson(res, 200, { ok: true }), true;
      }
      if (p === '/api/requirements/result') {
        const STATUSES = ['reflected', 'partial', 'missing'];
        const results = (Array.isArray(body.results) ? body.results : []).filter((r) => j.ids.includes(Number(r.id)) && STATUSES.includes(r.status));
        if (!results.length) return sendJson(res, 400, { error: 'results[] with id and status (reflected|partial|missing) required' }), true;
        for (const r of results) {
          const it = rq.items.find((x) => x.id === Number(r.id)); if (!it) continue;
          it.analysis = { status: r.status, how: cut(r.how, 3000), why: cut(r.why, 3000), next: cut(r.next, 1500),
            evidence: (Array.isArray(r.evidence) ? r.evidence : []).map((e) => cut(e, 300)).filter(Boolean).slice(0, 20), at: now, job: j.id, stale: false };
          it.recheck = null;                       // 다시 확인했다(제안 완료 뒤의 재확인 끝)
        }
        Object.assign(j, { status: 'done', progress: 100, step: 'Done', summary: cut(body.summary, 2000), analyzed: results.length, updatedAt: now, doneAt: now });
        save(rq); audit(actor(req), 'requirement.analyzed', `${results.length} results`);
        return sendJson(res, 200, { ok: true, analyzed: results.length, skipped: j.ids.length - results.length }), true;
      }
      if (p === '/api/requirements/fail' || p === '/api/requirements/cancel') {
        j.status = p.endsWith('fail') ? 'failed' : 'cancelled'; j.step = j.status === 'failed' ? cut(body.reason || 'Failed', 300) : 'Cancelled'; j.updatedAt = now;
        save(rq); return sendJson(res, 200, { ok: true }), true;
      }
      return sendJson(res, 404, { error: 'unknown requirements route' }), true;
    }

    // ---- 관계 분석(온톨로지 · 지식그래프) ----
    // 에이전트에게 보내는 지시문의 주소. 브라우저 주소(예: 로그인 게이트웨이 뒤의 base.anahub.io)는 에이전트의 curl이
    // 통과하지 못하므로, 같은 컴퓨터에서 도는 에이전트가 바로 닿는 이 서버의 로컬 주소를 알려 준다.
    if (p === '/api/agent-base' && req.method === 'GET') {
      const b = String(opts.BIND || '127.0.0.1'), host = b === '0.0.0.0' || b === '::' ? '127.0.0.1' : b.includes(':') ? `[${b}]` : b;
      return sendJson(res, 200, { host: opts.PORT ? `${host}:${opts.PORT}` : '' }), true;
    }
    // 공개 읽기: OntoAir 같은 외부 뷰어가 로그인 없이 가져가는 .ttl. 40자리 토큰 + 24시간 + 완료된 작업만.
    // anahub 게이트웨이는 share-access(HEAD → 204)로 토큰을 확인한 뒤에만 이 경로를 통과시킨다.
    const sm = /^\/api\/analysis\/shared\/([0-9a-f]{40})\/[\w.-]{1,80}\.ttl$/.exec(p);   // 끝 이름은 뷰어에 보이는 파일 이름
    if ((sm || p === '/api/analysis/share-access') && (req.method === 'GET' || req.method === 'HEAD')) {
      const hit = findShared(sm ? sm[1] : String(url.searchParams.get('t') || ''));
      if (!sm) { res.writeHead(hit ? 204 : 404, { 'cache-control': 'no-store' }); return res.end(), true; }
      if (!hit) return sendJson(res, 404, { error: 'link expired or unknown' }), true;
      const body = Buffer.from(analysisTurtle(hit.job, hit.ws));
      res.writeHead(200, { 'content-type': 'text/turtle; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'x-content-type-options': 'nosniff' });
      return res.end(req.method === 'HEAD' ? undefined : body), true;
    }
    // ---- System › Ontology: 개념 틀(읽기는 누구나, 바꾸기는 관리자) ----
    if (p === '/api/ontology' && req.method === 'GET') return sendJson(res, 200, systemOntology()), true;
    // 승격 증거 — 지식·쓰임이 워크 종류(기능)로 올라갈 만한지. Evolve가 읽고 시스템 제안의 근거로 쓴다(직접 바꾸지 않는다).
    //  newLinkTypes: 워크 종류에 없는 새 연결이 얼마나 쓰였나 · subtypes: 하위 종류가 붙은 워크 항목 수
    //  knowledge: 지식 종류마다 개체 수와, 그 개체들이 어느 워크 종류에서 나왔는지(한 종류에 몰리면 그 종류의 필드·하위 종류 후보)
    if (p === '/api/ontology/evidence' && req.method === 'GET') {
      const ont = systemOntology(), workIds = new Set(ont.classes.filter((c) => c.source === 'work').map((c) => c.id));
      const links = new Map(), subs = new Map(), know = new Map();
      for (const w of loadWorkspaces().workspaces) {
        let st; try { st = loadData(w.id); } catch { continue; }
        for (const l of st.links || []) if (relgraph.isNewLinkType(l.type)) { const k = links.get(l.type) || { type: l.type, count: 0, workspaces: new Set() }; k.count++; k.workspaces.add(w.id); links.set(l.type, k); }
        for (const x of [...st.items, ...st.events, ...st.notes]) if (x.subtype) { const kind = relgraph.kindOf(st, x.id), key = `${x.subtype}\u0000${kind}`; const k = subs.get(key) || { type: x.subtype, of: kind, count: 0 }; k.count++; subs.set(key, k); }
        const kg = loadKgStore(w.id);
        for (const e of kg.entities) {
          if (!e.class || workIds.has(e.class)) continue;
          const k = know.get(e.class) || { class: e.class, entities: 0, from: {} }; k.entities++;
          for (const src of new Set((e.sources || []).map((id) => relgraph.kindOf(st, id)).filter(Boolean))) k.from[src] = (k.from[src] || 0) + 1;
          know.set(e.class, k);
        }
      }
      const knowledge = [...know.values()].map((k) => {
        const [top, n] = Object.entries(k.from).sort((a, b) => b[1] - a[1])[0] || ['', 0];
        return { ...k, mostlyFrom: top, share: k.entities ? Math.round((n / k.entities) * 100) / 100 : 0, candidate: k.entities >= 5 && n / k.entities >= 0.8 };
      }).sort((a, b) => b.entities - a.entities);
      return sendJson(res, 200, {
        note: 'Evidence for growing the Work ontology (features) from use and from knowledge. Propose a system change (Evolve) when it is strong; nothing here changes the app by itself.',
        newLinkTypes: [...links.values()].map((k) => ({ type: k.type, count: k.count, workspaces: [...k.workspaces] })).sort((a, b) => b.count - a.count),
        subtypes: [...subs.values()].sort((a, b) => b.count - a.count),
        knowledge,
      }), true;
    }
    if (p === '/api/ontology' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      if (!isAdmin(req)) return needAdmin(res, 'Changing the ontology');
      const kind = { relation: 'relations', class: 'classes', rule: 'rules' }[body.kind] || null, it = body.item || {};
      if (!kind || !['add', 'update', 'remove'].includes(body.action)) return sendJson(res, 400, { error: 'kind must be class|relation|rule, action add|update|remove' }), true;
      if (!CONCEPT_ID.test(String(it.id || ''))) return sendJson(res, 400, { error: 'id: a letter, then letters, digits, _ or - (60 at most)' }), true;
      if (kind !== 'rules' && isWorkConcept(kind, it.id)) return sendJson(res, 400, { error: `${it.id} is in the Work ontology — it comes from the app's code (work-ontology.js) and changes when the app changes` }), true;
      const o = loadOntology(), all = systemOntology(), list = o[kind], cur = list.find((x) => x.id === it.id);
      const clsIds = new Set(all.classes.map((c) => c.id));
      if (body.action === 'remove') {
        if (!cur) return sendJson(res, 404, { error: 'not found' }), true;
        const used = kind === 'rules' ? 0 : conceptUse(kind === 'classes' ? 'class' : 'relation', it.id);
        const child = kind === 'classes' ? (all.classes.some((c) => c.parent === it.id) || all.relations.some((r) => r.domain === it.id || r.range === it.id))
          : kind === 'relations' && (all.rules || []).some((x) => x.source !== 'work' && [...(x.if || []).map((st) => String(st).replace(/^\^/, '')), x.then, x.rel].includes(it.id));
        if (kind !== 'rules' && (used || child)) return sendJson(res, 409, { error: `${it.id} is still used${used ? ` by ${used} item${used === 1 ? '' : 's'} in knowledge graphs` : ''}${child ? ' by other concepts' : ''}` }), true;
        o[kind] = list.filter((x) => x !== cur);
      } else {
        if (body.action === 'add' && (cur || all[kind].some((x) => x.id === it.id))) return sendJson(res, 200, { ok: true, existing: true, ontology: systemOntology() }), true;
        if (body.action === 'update' && !cur) return sendJson(res, 404, { error: 'not found' }), true;
        if (kind === 'rules') {
          // 일반 규칙 — chain: if [관계 1~3개, ^는 반대 방향] → then 관계 · limit: 관계 rel이 From(또는 To) 하나에 max개까지
          const kRels = new Set(all.relations.filter((r) => r.source !== 'work').map((r) => r.id)), STEP = /^\^?[A-Za-z][\w-]{0,59}$/;
          const base = { id: it.id, label: clip(it.label || it.id, 80), desc: clip(it.desc, 300) };
          let nx;
          if (it.kind === 'chain') {
            const steps = Array.isArray(it.if) ? it.if.map(String) : [];
            if (steps.length < 1 || steps.length > 3 || !steps.every((st) => STEP.test(st))) return sendJson(res, 400, { error: 'a chain rule has 1 to 3 steps (a relation id, ^ in front for the reverse direction)' }), true;
            const bad = [...steps.map((st) => st.replace(/^\^/, '')), String(it.then || '')].find((r) => !kRels.has(r));
            if (bad !== undefined) return sendJson(res, 400, { error: `unknown Knowledge relation ${bad || '(then)'}` }), true;
            if (steps.length === 1 && steps[0] === it.then) return sendJson(res, 400, { error: 'that rule says nothing new' }), true;
            nx = { ...base, kind: 'chain', if: steps, then: String(it.then) };
          } else if (it.kind === 'limit') {
            const max = Number(it.max);
            if (!kRels.has(String(it.rel || ''))) return sendJson(res, 400, { error: `unknown Knowledge relation ${it.rel || ''}` }), true;
            if (!Number.isInteger(max) || max < 1 || max > 1000) return sendJson(res, 400, { error: 'max must be a whole number from 1 to 1000' }), true;
            nx = { ...base, kind: 'limit', rel: String(it.rel), per: it.per === 'to' ? 'to' : 'from', max };
          } else return sendJson(res, 400, { error: 'rule kind must be chain|limit' }), true;
          if (cur) { for (const k of Object.keys(cur)) delete cur[k]; Object.assign(cur, nx); } else list.push(nx);
          saveOntology(o); audit(actor(req), `ontology.${body.action}`, `rule ${it.id}`); broadcast({ kind: 'ontology' });
          return sendJson(res, 200, { ok: true, ontology: systemOntology() }), true;
        }
        const next = kind === 'classes'
          ? { id: it.id, label: clip(it.label || it.id, 80), desc: clip(it.desc, 300), parent: clip(it.parent, 60) }
          : { id: it.id, label: clip(it.label || it.id, 80), desc: clip(it.desc, 300), domain: clip(it.domain, 60), range: clip(it.range, 60),
              inverse: clip(it.inverse, 60), symmetric: it.symmetric === true, transitive: it.transitive === true };   // 규칙 추론에 쓰는 성질
        if (next.inverse && !all.relations.some((x) => x.id === next.inverse) && next.inverse !== next.id) return sendJson(res, 400, { error: `unknown inverse relation ${next.inverse}` }), true;
        if (next.parent && (!clsIds.has(next.parent) || next.parent === next.id)) return sendJson(res, 400, { error: `unknown parent class ${next.parent}` }), true;
        for (const end of ['domain', 'range']) if (next[end] && !clsIds.has(next[end]) && !(kind === 'classes')) return sendJson(res, 400, { error: `unknown ${end} class ${next[end]}` }), true;
        if (cur) Object.assign(cur, next); else list.push(next);
      }
      saveOntology(o); audit(actor(req), `ontology.${body.action}`, `${{ classes: 'class', relations: 'relation', rules: 'rule' }[kind]} ${it.id}`);
      broadcast({ kind: 'ontology' });
      return sendJson(res, 200, { ok: true, ontology: systemOntology() }), true;
    }
    // ---- Workspace › Knowledge › 지식그래프(이 워크스페이스에 쌓인 개체·사실) ----
    if (p === '/api/kg' && req.method === 'GET') {
      const kg = loadKgStore(curWs()), ont = systemOntology(), lens = kgLens(kg, ont);
      return sendJson(res, 200, { ...lens, version: kg.version || 1, ontology: ont }), true;
    }
    if (p === '/api/kg/ttl' && req.method === 'GET') {
      const ws = curWs(), kg = loadKgStore(ws);
      const body = Buffer.from(analysisTurtle({ id: 'kg', ontology: systemOntology(), graph: kg, summary: `Knowledge graph of workspace ${ws}` }, ws, 'knowledge-graph'));
      res.writeHead(200, { 'content-type': 'text/turtle; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store', 'content-disposition': `attachment; filename="ana-knowledge-graph-${ws}.ttl"` });
      return res.end(body), true;
    }
    if (p === '/api/kg' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      const ws = curWs(), kg = loadKgStore(ws);
      if (body.action === 'remove-entity') {
        const before = kg.entities.length; kg.entities = kg.entities.filter((e) => e.id !== body.id);
        if (kg.entities.length === before) return sendJson(res, 404, { error: 'not found' }), true;
        kg.facts = kg.facts.filter((f) => f.from !== body.id && f.to !== body.id);
      } else if (body.action === 'remove-fact') {
        const before = kg.facts.length; kg.facts = kg.facts.filter((f) => !(f.from === body.from && f.rel === body.rel && f.to === body.to));
        if (kg.facts.length === before) return sendJson(res, 404, { error: 'not found' }), true;
      } else return sendJson(res, 400, { error: 'action must be remove-entity|remove-fact' }), true;
      saveKgStore(ws, kg); audit(actor(req), `kg.${body.action}`, String(body.id || `${body.from} ${body.rel} ${body.to}`).slice(0, 80)); broadcast({ kind: 'analysis' });
      return sendJson(res, 200, { ok: true }), true;
    }
    if (p.startsWith('/api/analysis')) {
      const ws = curWs(), a = loadAnalysis(ws);
      const job = (id) => a.jobs.find((j) => j.id === Number(id));
      const tell = () => broadcast({ kind: 'analysis', version: a.version });
      if (p === '/api/analysis' && req.method === 'GET') { const kg = loadKgStore(ws); return sendJson(res, 200, { jobs: a.jobs, latest: a.jobs[a.jobs.length - 1] || null, ontology: systemOntology(), kg: { entities: kg.entities.length, facts: kg.facts.length } }), true; }
      if (p === '/api/analysis/ttl' && req.method === 'GET') {
        const j = job(url.searchParams.get('id')); if (!j || j.status !== 'done') return sendJson(res, 404, { error: 'no finished analysis' }), true;
        const body = Buffer.from(analysisTurtle(j, ws));
        res.writeHead(200, { 'content-type': 'text/turtle; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store', 'content-disposition': `attachment; filename="ana-analysis-${j.id}.ttl"` });
        return res.end(body), true;
      }
      if (p === '/api/analysis/input' && req.method === 'GET') {
        const j = job(url.searchParams.get('id')); if (!j) return sendJson(res, 404, { error: 'no such analysis' }), true;
        const st = loadData(ws), want = new Set(j.itemIds);
        const items = [
          ...st.notes.filter((n) => want.has(n.id)).map((n) => ({ id: n.id, kind: 'Note', title: n.title || '', text: clip(n.text, 8000) })),
          ...st.items.filter((t) => want.has(t.id)).map((t) => ({ id: t.id, kind: 'Task', title: t.title || t.text || '', due: t.due || '', done: !!t.done })),
          ...st.events.filter((e) => want.has(e.id)).map((e) => ({ id: e.id, kind: 'Event', title: e.title || '', date: e.date || '', time: e.time || '', done: !!e.done })),
        ];
        return sendJson(res, 200, { id: j.id, focus: j.focus, items, links: (st.links || []).filter((l) => want.has(l.from) && want.has(l.to)),
          ontology: { ...systemOntology(),
            note: 'The shared ontology of this ANA — a guide, not a limit. Two layers: source "work" = the Work ontology, what this app stores (its notes, tasks, events… — fixed by the code); source "knowledge" = the Knowledge ontology, what is found in the work (kept by the admin). Your entities and facts belong to the Knowledge layer. "rules" derive facts automatically when the graph is read (chains, inverse, symmetric, transitive) or mark facts that break a limit — do not state facts a rule already implies. Prefer these ids when they fit. When they do not, say what you actually found: add your own classes/relations (declare them in ontology.classes/relations). Nothing is dropped for not fitting; it is kept, shown as not fitting yet, and the admin is asked to add or adjust the concept.' },
          rules: 'Use class ids for entity.class and relation ids for fact.rel — from the ontology or ones you declare. A fact should respect its relation\'s domain → range (sub-classes count); facts that do not are kept but marked as not fitting and listed under issues. Only facts pointing at missing entities are dropped.' }), true;
      }
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' }), true;
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res, 4 * 1024 * 1024); if (!body) return true;
      const now = new Date().toISOString();
      if (p === '/api/analysis/start') {
        if (a.jobs.some((j) => j.status === 'running')) return sendJson(res, 409, { error: 'An analysis is already running — wait for it or cancel it' }), true;
        const kinds = (Array.isArray(body.kinds) ? body.kinds : []).filter((k) => ANALYSIS_KINDS[k]);
        if (!kinds.length) return sendJson(res, 400, { error: 'Pick at least one of notes, tasks, events' }), true;
        const st = loadData(ws), openOnly = body.openOnly === true;
        const ids = [
          ...(kinds.includes('notes') ? st.notes.map((n) => n.id) : []),
          ...(kinds.includes('tasks') ? st.items.filter((t) => !openOnly || !t.done).map((t) => t.id) : []),
          ...(kinds.includes('events') ? st.events.filter((e) => !openOnly || !e.done).map((e) => e.id) : []),
        ];
        if (!ids.length) return sendJson(res, 400, { error: 'Nothing to analyze in the chosen items' }), true;
        const j = { id: a.next++, status: 'running', progress: 0, step: 'Waiting for the agent', kinds, openOnly, focus: clip(body.focus, 300), itemIds: ids,
          counts: { notes: kinds.includes('notes') ? st.notes.length : 0, tasks: ids.filter((x) => st.items.some((t) => t.id === x)).length, events: ids.filter((x) => st.events.some((e) => e.id === x)).length }, at: now, updatedAt: now };
        a.jobs.push(j); while (a.jobs.length > 10) a.jobs.shift();
        saveAnalysis(ws, a); audit(actor(req), 'analysis.start', `#${j.id} ${ids.length} items`); tell();
        return sendJson(res, 200, { ok: true, job: j }), true;
      }
      const j = job(body.id); if (!j) return sendJson(res, 404, { error: 'no such analysis' }), true;
      // 외부 뷰어용 공개 링크(24시간). 이미 있고 6시간 넘게 남았으면 그대로 쓴다.
      if (p === '/api/analysis/share') {
        if (j.status !== 'done') return sendJson(res, 409, { error: 'Only a finished analysis can be opened elsewhere' }), true;
        if (!j.share || Date.parse(j.share.exp) - Date.now() < 6 * 3600 * 1000) {
          j.share = { token: crypto.randomBytes(20).toString('hex'), exp: new Date(Date.now() + SHARE_TTL_MS).toISOString() };
          saveAnalysis(ws, a); audit(actor(req), 'analysis.share', `#${j.id}`);
        }
        return sendJson(res, 200, { ok: true, path: `/api/analysis/shared/${j.share.token}/ana-analysis-${j.id}.ttl`, exp: j.share.exp }), true;
      }
      if (p === '/api/analysis/progress') {
        if (j.status !== 'running') return sendJson(res, 409, { error: `analysis is ${j.status}` }), true;
        const pct = Number(body.progress);
        if (Number.isFinite(pct)) j.progress = Math.max(j.progress, Math.min(99, Math.round(pct)));   // 완료(100)는 result가 정한다
        if (body.step) j.step = clip(body.step, 200);
        j.updatedAt = now; saveAnalysis(ws, a); tell(); return sendJson(res, 200, { ok: true }), true;
      }
      if (p === '/api/analysis/result') {
        if (j.status !== 'running') return sendJson(res, 409, { error: `analysis is ${j.status}` }), true;
        const sys = systemOntology();
        const r2 = cleanAnalysis(body, new Set(j.itemIds), sys);
        if (!r2.ontology.classes.length && !r2.graph.entities.length) return sendJson(res, 400, { error: 'result needs ontology.classes or graph.entities', issues: r2.issues }), true;
        // 시스템 온톨로지에 없는 개념 → 관리자 승인요청(승인되면 개념이 추가되고, 그 개념을 쓰는 사실이 지식그래프에 들어간다)
        const known = { classes: new Set(sys.classes.map((c) => c.id)), relations: new Set(sys.relations.map((x) => x.id)) };
        const newConcepts = [];
        // 결과가 선언 없이 쓴 클래스·관계도 개념 후보로(에이전트가 틀 밖에서 자유롭게 쓴 말을 관리자가 정리할 수 있게)
        const declared = { classes: new Set(r2.ontology.classes.map((c) => c.id)), relations: new Set(r2.ontology.relations.map((x) => x.id)) };
        for (const e of r2.graph.entities) if (e.class && !known.classes.has(e.class) && !declared.classes.has(e.class) && CONCEPT_ID.test(e.class)) { declared.classes.add(e.class); r2.ontology.classes.push({ id: e.class, label: e.class, desc: '', parent: '', undeclared: true }); }
        for (const f of r2.graph.facts) if (!known.relations.has(f.rel) && !declared.relations.has(f.rel) && CONCEPT_ID.test(f.rel)) { declared.relations.add(f.rel); r2.ontology.relations.push({ id: f.rel, label: f.rel, desc: '', domain: '', range: '', undeclared: true }); }
        for (const [k, what] of [['classes', 'class'], ['relations', 'relation']]) for (const c of r2.ontology[k]) {
          if (c.inherited || known[k].has(c.id) || !CONCEPT_ID.test(c.id)) continue;
          const r = addAdminItem({ type: 'approval', title: `Add ${what} "${c.label || c.id}" to the ontology`, ref: `onto:${what}:${c.id}`,   // 막는 승인이 아니라 정리: 이미 지식그래프에 쓰이고 있다
            desc: [c.desc, what === 'class' ? (c.parent ? `Kind of ${c.parent}` : '') : `${c.domain || 'any'} → ${c.range || 'any'}`, `Proposed by analysis #${j.id} in workspace ${ws}`].filter(Boolean).join('\n'),
            action: { kind: 'ontology.add', what, item: c } }, { kind: 'agent', by: 'ana' }, ws);
          if (r.item) newConcepts.push({ what, id: c.id, label: c.label || c.id, adminId: r.item.id });
        }
        if (newConcepts.length) broadcast({ kind: 'admin' });
        Object.assign(j, r2, { status: 'done', progress: 100, step: 'Done', updatedAt: now, doneAt: now, newConcepts, applied: false });
        saveAnalysis(ws, a); audit(actor(req), 'analysis.done', `#${j.id} ${r2.ontology.classes.length} classes, ${r2.graph.entities.length} entities`); tell();
        return sendJson(res, 200, { ok: true, classes: r2.ontology.classes.length, relations: r2.ontology.relations.length, entities: r2.graph.entities.length, facts: r2.graph.facts.length, issues: r2.issues,
          newConcepts: newConcepts.map((c) => `${c.what} ${c.id}`), note: 'The user approves adding this to the workspace knowledge graph (Inbox › Approvals). Nothing that does not fit the ontology is lost: it is kept and shown as not fitting yet, and new concepts go to the admin to tidy up.' }), true;
      }
      // 분석 결과를 이 워크스페이스의 지식그래프에 더하기(실무자 승인) / 버리기
      if (p === '/api/analysis/apply' || p === '/api/analysis/discard') {
        if (j.status !== 'done' || j.applied || j.discarded) return sendJson(res, 409, { error: 'Only a finished analysis that is not added yet' }), true;
        if (p.endsWith('discard')) { j.discarded = true; j.decidedAt = now; saveAnalysis(ws, a); audit(actor(req), 'analysis.discard', `#${j.id}`); tell(); return sendJson(res, 200, { ok: true }), true; }
        const r = mergeIntoKg(ws, j.graph || {}, j.id);
        Object.assign(j, { applied: true, decidedAt: now, appliedBy: actor(req), appliedCount: r.added });
        saveAnalysis(ws, a); audit(actor(req), 'analysis.apply', `#${j.id} +${r.added.entities} entities +${r.added.facts} facts`); tell();
        return sendJson(res, 200, { ok: true, added: r.added }), true;
      }
      if (p === '/api/analysis/fail' || p === '/api/analysis/cancel') {
        if (j.status !== 'running') return sendJson(res, 409, { error: `analysis is ${j.status}` }), true;
        j.status = p.endsWith('fail') ? 'failed' : 'cancelled'; j.step = j.status === 'failed' ? clip(body.reason || 'Failed', 300) : 'Cancelled'; j.updatedAt = now;
        saveAnalysis(ws, a); tell(); return sendJson(res, 200, { ok: true }), true;
      }
      return sendJson(res, 404, { error: 'unknown analysis route' }), true;
    }

    // ---- 관리자 함 ----
    //  GET  /api/admin/inbox            관리자: 전부 / 실무자: 내가 올린 것만(mine)
    //  POST /api/admin/requests         {type: approval|work, title, desc?, ref?, action?{kind,…}} — 실무자·에이전트 누구나
    //  POST /api/admin/act              {id, action: approve|reject|start|done|fail|cancel|reopen, note?} — 관리자만
    if (p === '/api/admin/inbox' && req.method === 'GET') {
      const a = loadAdmin(), me = actor(req), admin = isAdmin(req);
      return sendJson(res, 200, { role: roleOf(req), me, items: admin ? a.items : a.items.filter((x) => x.from && x.from.by === me), version: a.version || 1 }), true;
    }
    if (p === '/api/admin/requests' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      const r = addAdminItem(body, { kind: who(req) ? 'member' : 'agent', by: actor(req) }, curWs());
      if (r.error) return sendJson(res, 400, { error: r.error }), true;
      if (!r.existing) { audit(actor(req), `admin.${r.item.type}`, `#${r.item.id}`); broadcast({ kind: 'admin' }); }
      return sendJson(res, 200, { ok: true, item: r.item, existing: !!r.existing }), true;
    }
    if (p === '/api/admin/act' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      const a = loadAdmin(), it = a.items.find((x) => x.id === Number(body.id));
      if (!it) return sendJson(res, 404, { error: 'not found' }), true;
      // 실무자는 자기가 올린 것을 취소만 할 수 있다
      if (!isAdmin(req) && !(body.action === 'cancel' && it.from && it.from.by === actor(req))) return needAdmin(res, 'This');
      const NEXT = { approve: 'done', reject: 'rejected', start: 'doing', done: 'done', fail: 'failed', cancel: 'cancelled', reopen: 'open' };
      if (!NEXT[body.action]) return sendJson(res, 400, { error: 'action must be approve|reject|start|done|fail|cancel|reopen' }), true;
      if (it.type === 'approval' && ['start'].includes(body.action)) return sendJson(res, 400, { error: 'approvals are approved or rejected' }), true;
      if (it.type === 'work' && ['approve', 'reject'].includes(body.action)) return sendJson(res, 400, { error: 'action requests are started, done, failed or cancelled' }), true;
      const now = new Date().toISOString();
      it.status = NEXT[body.action]; it.updatedAt = now;
      it.note = body.action === 'reopen' ? '' : String(body.note || it.note || '').slice(0, 1000);
      if (body.action !== 'start' && body.action !== 'reopen') { it.decidedBy = actor(req); it.decidedAt = now; }
      saveAdmin(a); audit(actor(req), `admin.${body.action}`, `#${it.id}`); broadcast({ kind: 'admin' });
      // 에이전트가 올린 것은 결과를 에이전트에게 알린다(승인된 동작의 실행은 관리자 화면이 맡는다)
      if (it.from && it.from.kind === 'agent' && ['approve', 'reject', 'done', 'fail', 'cancel'].includes(body.action)) {
        queueNotify('admin.decision', `Admin ${it.type} #${it.id} "${it.title.replace(/[\r\n]+/g, ' ')}" was ${it.status}${it.note ? ': ' + it.note.replace(/[\r\n]+/g, ' ') : ''}.`);
        tryDeliver(ctx).catch(() => {});
      }
      return sendJson(res, 200, { ok: true, item: it }), true;
    }

    // 진화 제안 조회 — ?scope=system|workspace (workspace는 지금 워크스페이스 것만)
    if (p === '/api/evolve' && req.method === 'GET') {
      const ev = loadEvolve(), sc = url.searchParams.get('scope'), ws = curWs();
      if (!sc) return sendJson(res, 200, ev), true;
      return sendJson(res, 200, { ...ev, proposals: ev.proposals.filter((x) => (x.scope || 'system') === sc && (sc === 'system' || x.ws === ws)) }), true;
    }
    // 데이터 변경 제안 전체(대기·적용 중·적용됨·거절됨) — 협업 › Approvals의 네 목록용. 이 워크스페이스, 최근 100개
    if (p === '/api/proposals' && req.method === 'GET') {
      const ws = curWs();
      return sendJson(res, 200, { proposals: loadProposals().proposals.filter((x) => (x.ws || DEFAULT_WS) === ws).slice(-100) }), true;
    }

    // 진화 제안 등록 (에이전트 curl)
    if (p === '/api/evolve' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      const incoming = Array.isArray(body.proposals) ? body.proposals : (body.title ? [body] : []);
      const valid = [];
      for (const x of incoming) {
        if (!x || typeof x !== 'object' || typeof x.title !== 'string' || !x.title.trim()) continue;
        if (x.type !== undefined && !['improve', 'add', 'remove'].includes(x.type)) return sendJson(res, 400, { error: `invalid type: ${x.type}` }), true;
        valid.push(x);
      }
      if (!valid.length) return sendJson(res, 400, { error: 'proposals[] with title required' }), true;
      const ev = loadEvolve();
      const seen = new Set(ev.proposals.filter((p2) => !['done', 'dismissed', 'failed'].includes(p2.status)).map((p2) => (p2.title || '').trim()));
      const added = [];
      for (const x of valid) {
        const title = String(x.title).slice(0, 200);
        if (seen.has(title.trim())) continue; // dedup(coding-M6)
        seen.add(title.trim());
        const scope = x.scope === 'workspace' ? 'workspace' : 'system';
        const pr = { id: ev.next++, type: x.type || 'improve', title, desc: String(x.desc || '').slice(0, 1000), status: 'new', at: new Date().toISOString(),
          scope, ...(scope === 'workspace' ? { ws: curWs() } : {}) };
        if (Number.isInteger(x.reqId) && loadRequirements().items.some((r) => r.id === x.reqId)) pr.reqId = x.reqId;   // 어느 요구사항에서 나온 제안인지
        ev.proposals.push(pr); added.push(pr);
      }
      if (ev.proposals.length > 50) ev.proposals = ev.proposals.slice(-50);
      ev.version = (ev.version || 1) + 1; saveEvolve(ev);
      broadcast({ kind: 'evolve', version: ev.version });
      return sendJson(res, 200, { ok: true, ids: added.map((x) => x.id), added: added.length, version: ev.version }), true;
    }

    // 진화 제안 처리: do → 수행요청 통지(pull큐) / done → 완료 / ignore → 제거
    if (p === '/api/evolve-act' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      if (!['do', 'done', 'fail', 'ignore', 'reopen', 'escalate'].includes(body.action)) return sendJson(res, 400, { error: 'action must be do|done|fail|ignore|reopen|escalate' }), true;
      const ev = loadEvolve();
      const pr = ev.proposals.find((x) => x.id === body.id);
      if (!pr) return sendJson(res, 404, { error: 'not found' }), true;
      const system = (pr.scope || 'system') === 'system';
      // 시스템 진화를 시작·취소·되살리는 결정은 관리자만(완료·실패 보고는 실행한 쪽이 한다)
      if (system && ['do', 'ignore', 'reopen'].includes(body.action) && !isAdmin(req)) return needAdmin(res, `Starting system proposal #${pr.id}`);
      // 워크스페이스 제안을 시스템으로 올리기 — 새 기능이 있어야 할 때. 원래 제안은 그대로 두고 서로 잇는다
      if (body.action === 'escalate') {
        if (system) return sendJson(res, 400, { error: 'Already a system proposal' }), true;
        if (pr.escalatedTo && ev.proposals.some((x) => x.id === pr.escalatedTo && !['done', 'dismissed', 'failed'].includes(x.status)))
          return sendJson(res, 200, { ok: true, proposal: ev.proposals.find((x) => x.id === pr.escalatedTo), existing: true }), true;
        const np = { id: ev.next++, type: pr.type, title: pr.title, desc: [pr.desc, `From workspace proposal #${pr.id} (${pr.ws}).`].filter(Boolean).join('\n').slice(0, 1000),
          status: 'new', at: new Date().toISOString(), scope: 'system', fromId: pr.id, fromWs: pr.ws, ...(pr.reqId ? { reqId: pr.reqId } : {}) };
        ev.proposals.push(np); pr.escalatedTo = np.id; pr.updatedAt = np.at;
        if (ev.proposals.length > 80) ev.proposals = ev.proposals.slice(-80);
        ev.version = (ev.version || 1) + 1; saveEvolve(ev); broadcast({ kind: 'evolve', version: ev.version });
        audit(actor(req), 'evolve.escalate', `#${pr.id} → #${np.id}`);
        return sendJson(res, 200, { ok: true, proposal: np }), true;
      }
      pr.status = { do: 'doing', done: 'done', fail: 'failed', ignore: 'dismissed', reopen: 'new' }[body.action];
      pr.failReason = body.action === 'fail' ? String(body.reason || '').trim().slice(0, 1000) : body.action === 'reopen' || body.action === 'do' ? '' : (pr.failReason || '');
      pr.updatedAt = new Date().toISOString();   // 협업 목록(대기·처리 중·완료·취소)에서 최근 것부터 보이게
      audit(actor(req), `evolve.${body.action}`, `#${pr.id}`);
      ev.version = (ev.version || 1) + 1; saveEvolve(ev);
      broadcast({ kind: 'evolve', version: ev.version });
      // 요구사항에서 나온 제안이 끝나면 그 요구사항을 '다시 확인 필요'로 — 정말 반영됐는지 다시 분석하게
      if (pr.reqId && body.action === 'done') {
        const rq = loadRequirements(), it = rq.items.find((x) => x.id === pr.reqId);
        if (it) { it.recheck = { proposalId: pr.id, at: pr.updatedAt }; if (it.analysis) it.analysis.stale = true; saveRequirements(rq, broadcast); }
      }
      let notified;
      if (body.action === 'do') {
        const scopeNote = system ? '' : ` This is a WORKSPACE proposal for workspace "${pr.ws}": change only that workspace's data through the APIs (diff via POST /api/agent, /api/link, notes/tasks/events routes, with ?ws=${pr.ws}) — do not change code; if it needs a new feature, escalate it with POST /api/evolve-act {"id":${pr.id},"action":"escalate"}.`;
        const n = queueNotify('evolve.do', `Evolve proposal #${pr.id} requested — [${pr.type}] ${pr.title.replace(/[\r\n]+/g, ' ')}.${scopeNote} After applying, mark it done with POST /api/evolve-act {"id":${pr.id},"action":"done"}; if it can't be done, POST {"id":${pr.id},"action":"fail","reason":"why"}.`);
        notified = await tryDeliver(ctx);
        return sendJson(res, 200, { ok: true, status: pr.status, version: ev.version, notified, notifyId: n.id }), true;
      }
      return sendJson(res, 200, { ok: true, status: pr.status, version: ev.version }), true;
    }

    return false; // 미처리 → 채널 라우트로
  }

  const snapshotExtra = () => { try { return { version: dataVersion() }; } catch { return { version: 1 }; } };
  // 채팅 주입 시 채널 코어가 부르는 훅
  const identify = (req) => {
    const e = who(req);
    if (!e) return null;
    const pr = profileOf(e);
    // 접두어 파서(dashboard.html ID_PREFIX)는 '[', ']', '·'를 구분자로 쓴다. 이름에 남아 있을 수 있는
    // 이 문자들을 여기서도 제거해(저장 전 정화가 없던 과거 프로필 방어) 발신자 위조를 원천 차단한다.
    const safe = String(pr.name || '').replace(/[[\]·\r\n]/g, ' ').replace(/\s+/g, ' ').trim() || e.split('@')[0];
    return { email: e, label: `${safe}·${e}` };
  };
  // 채널 코어가 '사람별 최근 세션'을 기억할 때 쓰는 키 — 신원이 없으면 빈 값(단일 사용자)
  const userKey = (req) => who(req);
  // 화면 버튼이 대신 보낸 지시문은 채팅이 아니라 그 일의 요청으로 기록한다(사용 기록이 실제 사용을 보여 주게)
  const INSTR_ACTION = { Analyze: 'analysis.request', Evolve: 'evolve.request', Requirements: 'requirements.request', Update: 'update.request', Requests: 'requests.request', Approvals: 'approvals.request' };
  const onChat = (req, text) => {
    const me = actor(req); touchUser(me);
    const t = String(text), m = /^\[(Analyze|Evolve|Requirements|Update|Requests|Approvals|Request #\d+)\]\s*/.exec(t);
    // 대화 원문은 에이전트 기록에 이미 있다 — 여기에는 앞 60자와 길이만
    if (!m) { const one = t.replace(/\s+/g, ' ').trim(); return audit(me, 'chat.send', one.length > 60 ? one.slice(0, 60) + '…' : one, `${t.length} chars`); }
    audit(me, m[1].startsWith('Request #') ? 'request.answer' : INSTR_ACTION[m[1]], `${m[1].startsWith('Request #') ? m[1].slice(8) + ' ' : ''}${t.slice(m[0].length).split('\n')[0]}`.replace(/\s+/g, ' ').slice(0, 80));
  };

  return {
    extraApi, snapshotExtra, bootstrap, identify, onChat, userKey,
    // 테스트 export
    applyDiff, hasDiff, validateDiff, loadData, saveData, loadProposals, saveProposals, loadEvolve, saveEvolve, loadRequests, nextPid,
    loadWorkspaces,
  };
}

module.exports = { createDashboardApi };
