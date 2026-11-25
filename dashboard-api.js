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
const relgraph = require('./graph-index.js');   // 업무 항목·지식·문서를 한 그래프로 — NodeRel 색인(graph-index.sqlite)
const codexSettings = require('./codex-settings.js');
const permissionMode = require('./permission-mode.js');
const { createAgentLog } = require('./agent-log.js');

// ---- System: 재시작 ----
const STARTED_AT = new Date().toISOString();
let restarting = false;
function pluginVersion() {
  try { return JSON.parse(require('node:fs').readFileSync(path.join(__dirname, '.claude-plugin', 'plugin.json'), 'utf8')).version || ''; } catch { return ''; }
}
// 누가 이 서버를 지키고 있나 — 지키는 쪽이 있으면 끝내기만 하면 그쪽이 다시 띄운다(launchd KeepAlive, systemd Restart=)
function supervisor() {
  const env = process.env;
  if (env.ANA_SUPERVISED === '1') return 'supervisor';
  if (env.INVOCATION_ID) return 'systemd';
  if (process.platform === 'darwin' && process.ppid === 1) {
    // 부모가 1이라고 다 launchd 잡은 아니다(터미널을 닫아 고아가 된 nohup 프로세스도 그렇다) — launchctl 목록에 이 pid가 있어야 한다
    try { const out = require('node:child_process').execFileSync('launchctl', ['list'], { encoding: 'utf8', timeout: 2000 }); if (new RegExp(`^${process.pid}\t`, 'm').test(out)) return 'launchd'; } catch {}
    return 'self';
  }
  return 'self';
}
function restartServer(how) {
  if (how === 'self') {
    // 지키는 쪽이 없으면 스스로: 포트가 풀릴 때까지 잠깐 기다렸다가 같은 명령·환경으로 다시 띄우는 분리된 프로세스를 남긴다
    const fs = require('node:fs'), { spawn } = require('node:child_process');
    const dir = process.env.ANA_DATA_DIR || path.join(__dirname, '.ana');
    let out = 'ignore'; try { fs.mkdirSync(dir, { recursive: true }); out = fs.openSync(path.join(dir, 'server.log'), 'a'); } catch {}
    const child = spawn('/bin/sh', ['-c', 'sleep 1; exec "$0" "$@"', process.execPath, ...process.execArgv, ...process.argv.slice(1)],
      { cwd: process.cwd(), env: process.env, detached: true, stdio: ['ignore', out, out] });
    child.unref();
  }
  console.log(`[ana] restarting the server (${how})`);
  process.exit(0);
}

function createDashboardApi(core, opts) {
  const { ROOT } = opts;
  const DATA_FILE = opts.DATA_FILE || path.join(ROOT, 'data', 'work-graph.json');   // 기본 워크스페이스의 워크 그래프
  const PROPOSALS_FILE = opts.PROPOSALS_FILE || path.join(ROOT, 'data', 'proposals.json');
  const EVOLVE_FILE = opts.EVOLVE_FILE || path.join(ROOT, 'data', 'evolve.json');
  const REQUESTS_FILE = opts.REQUESTS_FILE || path.join(path.dirname(EVOLVE_FILE), 'requests.json');
  // PRD — 이 ANA가 무엇을 하는 앱인지. 에이전트가 쓰고 사람이 고친다. 판마다 이력으로 남는다
  const PRD_FILE = opts.PRD_FILE || path.join(path.dirname(EVOLVE_FILE), 'prd.json');
  // Knowledge — 일에서 쌓이는 것: 온톨로지(종류 · 관계)와 그래프(개체 · 사실). 처음엔 비어 있고 에이전트가 채운다
  const KNOWLEDGE_FILE = opts.KNOWLEDGE_FILE || path.join(path.dirname(EVOLVE_FILE), 'knowledge.json');
  // Knowledge › Documents — 사람이 올린 파일(명세서·가격표·매뉴얼…). 에이전트가 읽고 지식을 쌓는다
  const DOCS_DIR = opts.DOCS_DIR || path.join(path.dirname(EVOLVE_FILE), 'documents');
  const DOCS_FILE = path.join(DOCS_DIR, 'documents.json');
  const DOC_MAX = opts.DOC_MAX || 25 * 1024 * 1024;
  // Update — 업스트림(agent-native-agent)과 기능 단위로 비교한 결과와 그 처리 상태
  const UPDATES_FILE = opts.UPDATES_FILE || path.join(path.dirname(EVOLVE_FILE), 'updates.json');
  const UPSTREAM_DIR = opts.UPSTREAM_DIR || path.join(path.dirname(EVOLVE_FILE), 'upstream');
  const UPSTREAM_URL = opts.UPSTREAM_URL || 'https://github.com/tykimos/agent-native-agent';
  const UPDATE_TARGET = opts.UPDATE_TARGET || ROOT;   // 비교할 ANA 폴더(기본: 이 ANA). 시험·호스트용으로 바꿀 수 있다
  const NOTIFY_AGENT = opts.NOTIFY_AGENT !== false;
  const MAX_TEXT = opts.MAX_TEXT || 8000;
  // Claude Code 세션의 구조화된 대화 기록(읽기 전용) — 채팅을 Claude 앱과 같은 모양으로 그린다
  const agentLog = createAgentLog({ socket: opts.TMUX_SOCKET || '' });
  const permOverride = new Map();
  async function codexDefaultMode(start) {
    if (/--dangerously-bypass-approvals-and-sandbox|--yolo\b/.test(start || '')) return 'full';
    let cfg = ''; try { cfg = await fsp.readFile(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml'), 'utf8'); } catch {}
    return /^\s*approvals_reviewer\s*=\s*"auto_review"/m.test(cfg) ? 'auto' : 'ask';
  }   // Codex: 바꾼 직후 다음 turn_context가 오기 전까지 기억하는 모드
  const { writeJsonAtomic, readJsonStrict, sendJson } = core;
  // 큰 JSON(그래프가 큰 ANA의 Knowledge는 1MB를 넘는다)은 브라우저가 받으면 gzip으로 — 공용 sendJson(channel-core)은 건드리지 않는다. x-raw-length = 풀린 크기(진행 막대용)
  const sendJsonGz = (req, res, code, obj) => {
    const body = Buffer.from(JSON.stringify(obj));
    if (body.length < 32768 || !/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) return sendJson(res, code, obj);
    const gz = require('zlib').gzipSync(body, { level: 6 });
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-encoding': 'gzip', vary: 'accept-encoding', 'content-length': gz.length, 'x-raw-length': body.length, 'access-control-expose-headers': 'x-raw-length' });
    res.end(gz);
  };

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
  // 내려받기 헤더 — 한글 파일 이름도 그대로(RFC 5987)
  const attachment = (n) => `attachment; filename="${String(n).replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(n)}`;
  const safeName = (n) => {
    const base = String(n || 'file').split(/[\\/]/).pop() || 'file';
    const clean = base.replace(/[^\w.\-가-힣]+/g, '_').replace(/^[._]+/, '').slice(-80);
    return clean || 'file';
  };

  // ---- 워크스페이스: 하나 ----
  // 이 판은 워크스페이스가 하나다. 예전 판에서 받은 기록의 ws 값(default)은 그대로 둔다.
  const DEFAULT_WS = 'default';
  const curWs = () => DEFAULT_WS;
  const dataFileOf = () => DATA_FILE;
  // 0.11: 데이터 파일 이름을 개념에 맞췄다 — state.json → work-graph.json. 옛 색인 graph.sqlite는 캐시라 지운다(graph-index.sqlite는 다시 만들어지는 색인이라 둔다).
  // 옛 이름만 있으면 사본(<옛 이름>.pre-0.11)을 남기고 새 이름으로 옮긴다. 새 이름이 이미 있으면 건드리지 않는다.
  // DATA_FILE을 직접 지정한 배포는 그 이름을 그대로 쓴다(이름이 새 기본값일 때만 옮긴다).
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
    if (path.basename(DATA_FILE) === 'work-graph.json') { move(path.join(path.dirname(DATA_FILE), 'state.json'), DATA_FILE); }
    dropCache(path.dirname(DATA_FILE));
  })();

  // ---- 상태 파일 (원자적 + shape 검증) ----
  function loadData(ws) {
    const file = dataFileOf(ws || curWs());
    const s = readJsonStrict(file, () => ({ version: 1, links: [] }));
    if (!s || typeof s !== 'object' || Array.isArray(s))
      throw new Error(`work graph file shape invalid (${file})`);
    if (!Array.isArray(s.links)) s.links = []; // 명시적 관계 — {from, to, type, at, by} (graph-index.js 참고)
    for (const l of relgraph.workLists()) if (!Array.isArray(s[l])) s[l] = [];   // work-ontology.js가 선언한 업무 종류마다 배열 하나(베이스는 없음)
    if (typeof s.version !== 'number' || !Number.isFinite(s.version)) s.version = 1;
    return s;
  }
  const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
  const newId = (p) => p + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  const CLIENT_EVENTS = { 'tab.view': /^[a-z]{2,20}(\.[a-z]{2,20})?$/ };
  const saveData = (s, ws) => { relgraph.pruneLinks(s); writeJsonAtomic(dataFileOf(ws || curWs()), s); };
  // 업무 항목(work-graph.json)·지식(knowledge.json)·문서를 한 그래프로 — NodeRel 색인(graph-index.sqlite), 원천이 바뀌면 다음 읽기에 다시 만든다.
  const graph = relgraph.createGraph({ loadData, dataFileOf, loadKnowledge: () => loadKnowledge(), loadDocs: () => loadDocs() });
  // 온톨로지 규칙 — work-ontology.js의 rules 선언 그대로. ANA가 work-rules.js(checkRules(lists) → {규칙 id: {checked, bad, unknown, unknownWhy, examples}})를
  // 두면 지금 데이터로 검사한 결과를 합친다. 검사 코드가 없는 규칙은 noCheck(화면에 '—')
  const RULES_FILE = process.env.ANA_WORK_RULES || path.join(__dirname, 'work-rules.js');
  function ontologyRules() {
    const decl = relgraph.work().rules || [];
    if (!decl.length) return [];
    let res = {};
    if (require('node:fs').existsSync(RULES_FILE)) { delete require.cache[require.resolve(RULES_FILE)]; res = require(RULES_FILE).checkRules(loadData()) || {}; }
    return decl.map((d) => ({ ...d, ...(res[d.id] || { checked: 0, bad: 0, unknown: 0, unknownWhy: {}, examples: [], noCheck: true }) }));
  }

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
  // ---- 진화 제안: 거리·근거·밖의 사례 ----
  const EVO_HORIZONS = ['tidy', 'improve', 'reimagine'];
  function evoInsight(x) {
    const out = {};
    if (EVO_HORIZONS.includes(x.horizon)) out.horizon = x.horizon;
    if (x.because) out.because = clip(x.because, 600);      // 본 것: 일과 지식에서 본 문제(도메인 말)
    if (x.outcome) out.outcome = clip(x.outcome, 600);      // 바뀌는 것: 사람에게 무엇이 달라지나
    if (x.how) out.how = clip(x.how, 1500);                  // 어떻게: 기술 설명(온톨로지·동작·API) — 화면에서는 접혀 있다
    const src = (Array.isArray(x.sources) ? x.sources : []).map((s0) => (typeof s0 === 'string' ? { url: s0 } : s0 || {}))
      .filter((s0) => /^https?:\/\/[^\s]{3,500}$/.test(String(s0.url || ''))).slice(0, 5)
      .map((s0) => ({ url: String(s0.url), title: clip(s0.title || '', 120), note: clip(s0.note || '', 300) }));
    if (src.length) out.sources = src;
    return out;
  }
  // 받은함 항목의 사람 말 칸 — 무슨 일인지(why) · 무엇을 해 달라는지(ask) · 무엇이 달라지는지(effect) · 안 하면(ifNot)
  function plainFields(x) {
    const out = {};
    for (const [k, n] of [['why', 600], ['ask', 300], ['effect', 600], ['ifNot', 300]]) if (x && x[k]) out[k] = clip(x[k], n);
    return out;
  }
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
  // ---- PRD: 판(version)마다 통째로 남긴다. 마지막 판이 지금 것 ----
  const PRD_MAX = 200000, PRD_KEEP = 50;
  function loadPrd() {
    const d = readJsonStrict(PRD_FILE, () => ({ next: 1, versions: [] }));
    return d && Array.isArray(d.versions) ? d : { next: 1, versions: [] };
  }
  function addPrdVersion(md, note, source, by) {
    const d = loadPrd(), cur = d.versions[d.versions.length - 1];
    if (cur && cur.md === md) return { d, v: cur, unchanged: true };
    const v = { v: d.next++, md, note: clip(note, 300), source: ['agent', 'sample'].includes(source) ? source : 'person', by, at: new Date().toISOString() };
    d.versions.push(v); while (d.versions.length > PRD_KEEP) d.versions.shift();
    d.version = (d.version || 1) + 1; writeJsonAtomic(PRD_FILE, d);
    return { d, v };
  }
  // ---- Knowledge: 온톨로지(classes · relations)와 그래프(entities · facts). id로 덮어쓰고(같은 사실은 하나), 지울 수 있다 ----
  const K_ID = /^[\w:.-]{1,60}$/;
  function loadKnowledge() {
    const k = readJsonStrict(KNOWLEDGE_FILE, () => ({}));
    const arr = (x) => (Array.isArray(x) ? x : []);
    return { version: (k && k.version) || 1, classes: arr(k && k.classes), relations: arr(k && k.relations), entities: arr(k && k.entities), facts: arr(k && k.facts) };
  }
  const saveKnowledge = (k) => { k.version = (k.version || 1) + 1; writeJsonAtomic(KNOWLEDGE_FILE, k); };
  const factKey = (f) => `${f.from}|${f.rel}|${f.to}`;
  // 받은 것을 다듬어 더한다. 틀에 없는 종류·관계를 쓴 개체·사실도 버리지 않는다(화면이 '아직 온톨로지에 없음'으로 보인다)
  function mergeKnowledge(k, b) {
    const list = (x, n) => (Array.isArray(x) ? x : []).slice(0, n);
    const upsert = (arr, x) => { const i = arr.findIndex((y) => y.id === x.id); if (i < 0) arr.push(x); else arr[i] = { ...arr[i], ...x }; };
    let n = 0;
    for (const c of list(b.classes, 200)) if (c && K_ID.test(c.id)) { upsert(k.classes, { id: c.id, label: clip(c.label || c.id, 80), desc: clip(c.desc, 300), parent: K_ID.test(c.parent || '') ? c.parent : '' }); n++; }
    for (const r of list(b.relations, 200)) if (r && K_ID.test(r.id)) { upsert(k.relations, { id: r.id, label: clip(r.label || r.id, 80), desc: clip(r.desc, 300), domain: K_ID.test(r.domain || '') ? r.domain : '', range: K_ID.test(r.range || '') ? r.range : '' }); n++; }
    for (const e of list(b.entities, 1000)) if (e && K_ID.test(e.id)) { upsert(k.entities, { id: e.id, label: clip(e.label || e.id, 120), class: K_ID.test(e.class || '') ? e.class : '', items: list(e.items, 20).map(String).filter((x) => K_ID.test(x)) }); n++; }
    for (const f of list(b.facts, 3000)) {
      if (!f || !K_ID.test(f.from || '') || !K_ID.test(f.rel || '') || !K_ID.test(f.to || '')) continue;
      const x = { from: f.from, rel: f.rel, to: f.to, items: list(f.items, 20).map(String).filter((y) => K_ID.test(y)) };
      const i = k.facts.findIndex((y) => factKey(y) === factKey(x)); if (i < 0) k.facts.push(x); else k.facts[i] = x; n++;
    }
    return n;
  }
  // ---- Knowledge › Documents: 파일은 DOCS_DIR/<id>-<이름>, 목록은 documents.json ----
  function loadDocs() {
    const d = readJsonStrict(DOCS_FILE, () => ({ next: 1, items: [] }));
    return d && Array.isArray(d.items) ? d : { next: 1, items: [] };
  }
  const saveDocs = (d) => { d.version = (d.version || 1) + 1; writeJsonAtomic(DOCS_FILE, d); };
  const docPath = (x) => path.join(DOCS_DIR, x.file);
  // 화면 안에서 바로 열어도 안전한 종류만 inline(그림·PDF·글). 나머지(HTML·SVG 등)는 늘 내려받기로 — 같은 출처에서 스크립트가 돌지 않게
  const DOC_INLINE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.json': 'text/plain; charset=utf-8' };
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
  // diff는 work-ontology.js가 선언한 종류의 배열(list)에 적용된다: add는 list가 필요하고, update·remove는 id로 모든 배열에서 찾는다
  const MAX_DIFF_ITEMS = 500, FIELD_KEY = /^[A-Za-z_][\w-]{0,39}$/;
  function validateDiff(diff) {
    if (!diff || typeof diff !== 'object' || Array.isArray(diff)) return 'diff must be an object';
    for (const k of ['add', 'update', 'remove']) if (k in diff && !Array.isArray(diff[k])) return `diff.${k} must be an array`;
    const total = (diff.add || []).length + (diff.update || []).length + (diff.remove || []).length;
    if (total > MAX_DIFF_ITEMS) return `too many diff items (>${MAX_DIFF_ITEMS})`;
    for (const a of diff.add || []) {
      if (a === null || typeof a !== 'object' || Array.isArray(a)) return 'diff.add items must be objects';
      if (typeof a.list !== 'string' || !FIELD_KEY.test(a.list)) return 'diff.add items need list — the work-graph.json array of their kind (declared in work-ontology.js)';
    }
    for (const u of diff.update || []) if (!u || typeof u !== 'object' || Array.isArray(u) || typeof u.id === 'undefined') return 'diff.update items must be objects with id';
    for (const r of diff.remove || []) if (typeof r !== 'string' && typeof r !== 'number' && !(r && typeof r === 'object' && typeof r.id !== 'undefined')) return 'diff.remove items must be an id (string|number) or {id}';
    return null;
  }
  const hasDiff = (d) => !!d && !!((Array.isArray(d.add) && d.add.length) || (Array.isArray(d.update) && d.update.length) || (Array.isArray(d.remove) && d.remove.length));
  // 값은 원시값(불리언·유한수·문자열 ≤ 20000자)이나 그 배열(≤ 100개)만 — 중첩 객체는 버린다(빈 문자열). id·list는 필드가 아니다.
  const FIELD_MAX = 20000, LIST_MAX = 100;
  const scalar = (v) => (typeof v === 'boolean' ? v : typeof v === 'number' && Number.isFinite(v) ? v : v === null || v === undefined || typeof v === 'object' ? '' : String(v).slice(0, FIELD_MAX));
  const coerceField = (k, v) => (Array.isArray(v) ? v.slice(0, LIST_MAX).map(scalar) : scalar(v));
  function assignFields(target, src) {
    for (const k of Object.keys(src)) {
      if (k === 'id' || k === 'list' || !FIELD_KEY.test(k)) continue;
      target[k] = coerceField(k, src[k]);
    }
  }
  // 방어적 적용: caller id 무시(QA-M5), 키 화이트리스트(QA-m3), done 불리언, 실제 변경 0이면 version 미증가(QA-m2)
  function applyDiff(diff, ws) {
    const s = loadData(ws), lists = relgraph.workLists();
    for (const a of diff.add || []) if (!lists.includes(a.list)) throw new Error(`unknown list "${a.list}" — declare its kind in work-ontology.js (declared: ${lists.join(', ') || 'none'})`);
    const summary = { added: 0, updated: 0, removed: 0 };
    const where = (id) => { for (const l of lists) { const i = (s[l] || []).findIndex((x) => x && x.id === id); if (i >= 0) return [l, i]; } return null; };
    (diff.remove || []).forEach((r) => { const w = where(typeof r === 'object' ? r.id : r); if (w) { s[w[0]].splice(w[1], 1); summary.removed++; } });
    (diff.update || []).forEach((u) => { const w = where(u.id); if (w) { assignFields(s[w[0]][w[1]], u); summary.updated++; } });
    (diff.add || []).forEach((a) => { const it = { id: 'a' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex') }; assignFields(it, a); s[a.list].push(it); summary.added++; });
    const changed = summary.added || summary.updated || summary.removed;
    if (changed) { s.version = (s.version || 1) + 1; saveData(s, ws); }
    return { summary, version: s.version, changed };
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
  const DEFAULT_CLAUDE = { dir: path.join(os.homedir(), '.claude'), explicit: false };
  const cfgKey = (c) => `${c.dir}|${c.explicit ? 1 : 0}`;
  const usageCache = new Map();   // cfgKey → {at, data}
  // 세션마다 계정이 다를 수 있다(CLAUDE_CONFIG_DIR · CODEX_HOME — 채팅 세션 목록의 + New session, docs/multi-account.md). 사용량·로그인은 '설정 폴더'별로 읽고 캐시한다.
  async function claudeConfigOf(target) {
    if (!target) return DEFAULT_CLAUDE;
    const r = await agentLog.resolve(target).catch(() => ({}));
    return r && r.kind === 'claude' && r.configDir ? { dir: r.configDir, explicit: !!r.configExplicit } : DEFAULT_CLAUDE;   // Codex 세션의 configDir은 CODEX_HOME
  }
  // ---- 에이전트 계정(세션마다) — Claude Code와 Codex ----
  // 계정 = 그 에이전트의 설정 폴더. Claude: 'default' = ~/.claude, <id> = ~/.claude-<id> (CLAUDE_CONFIG_DIR)
  //                                  Codex:  'default' = ~/.codex,  <id> = ~/.codex-<id>  (CODEX_HOME)
  // ANA가 만든 폴더에는 .ana-account 표시가 있다. 세션의 계정을 바꾸면 tmux 세션 환경에 그 변수를 넣고 팬을 다시 띄운다.
  // 로그인: Claude는 새 폴더에서 Claude가 스스로 묻고 채팅이 그 화면을 보인다. Codex는 서버가 `codex login --device-auth`를 돌려
  // 링크와 한 번 쓰는 코드를 화면에 보이고, 로그인이 끝나면 팬을 다시 띄운다(원격 ANA에서도 휴대폰으로 로그인할 수 있다).
  const CLAUDE_HOME = opts.CLAUDE_HOME || process.env.ANA_CLAUDE_HOME || os.homedir();
  const ACCT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
  const AGENT_ACCT = {
    claude: { name: 'Claude', env: 'CLAUDE_CONFIG_DIR', prefix: '.claude-', def: () => DEFAULT_CLAUDE.dir, marks: ['.claude.json', '.ana-account'], copy: 'settings.json' },
    codex: { name: 'Codex', env: 'CODEX_HOME', prefix: '.codex-', def: () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), marks: ['auth.json', 'config.toml', '.ana-account'], copy: 'config.toml' },
  };
  const acctDir = (kind, id) => (id === 'default' ? AGENT_ACCT[kind].def() : path.join(CLAUDE_HOME, AGENT_ACCT[kind].prefix + id));
  const tilde = (d) => (d.startsWith(os.homedir()) ? '~' + d.slice(os.homedir().length) : d);
  function acctIds(kind) {
    const fs = require('node:fs'), A = AGENT_ACCT[kind], out = ['default'], re = new RegExp(`^${A.prefix.replace('.', '\\.')}([a-z0-9][a-z0-9-]{0,31})$`);
    for (const d of fs.readdirSync(CLAUDE_HOME, { withFileTypes: true }).filter((x) => x.isDirectory())) {
      const m = re.exec(d.name), dir = m && path.join(CLAUDE_HOME, d.name);
      if (m && A.marks.some((f) => fs.existsSync(path.join(dir, f)))) out.push(m[1]);   // 그 에이전트의 설정 폴더로 보이는 것만
    }
    return out;
  }
  // 세션의 에이전트 종류: 기록으로 안 것(claude|codex), 모르면 처음 띄운 명령으로 짐작
  const kindOfSession = (where) => (where.kind === 'codex' || where.kind === 'claude' ? where.kind : /codex/i.test(where.start || '') ? 'codex' : 'claude');
  // 계정 정보: 이메일·이름과 로그인 여부. 토큰은 서버 밖으로 내보내지 않는다
  async function acctInfo(kind, id) {
    const dir = acctDir(kind, id);
    if (kind === 'codex') {
      let j = null; try { j = JSON.parse(await fsp.readFile(path.join(dir, 'auth.json'), 'utf8')); } catch {}
      const t = j && j.tokens, apiKey = !!(j && j.OPENAI_API_KEY);
      let claims = {}; try { claims = JSON.parse(Buffer.from(String(t.id_token).split('.')[1], 'base64url').toString('utf8')) || {}; } catch {}   // 이메일만 읽는다(검증 없음 — 표시용)
      const plan = ((claims['https://api.openai.com/auth'] || {}).chatgpt_plan_type) || '';
      return { id, dir: tilde(dir), email: claims.email || '', name: apiKey && !t ? 'API key' : '', org: plan ? `ChatGPT ${plan}` : '', signedIn: !!((t && (t.access_token || t.refresh_token)) || apiKey) };
    }
    let a = null; try { a = JSON.parse(await fsp.readFile(id === 'default' ? path.join(os.homedir(), '.claude.json') : path.join(dir, '.claude.json'), 'utf8')).oauthAccount || null; } catch {}
    const oa = await readOauth({ dir, explicit: id !== 'default' }).catch(() => null);
    return { id, dir: tilde(dir), email: (a && a.emailAddress) || '', name: (a && (a.displayName || a.fullName)) || '', org: (a && a.organizationName) || '', signedIn: !!(oa && oa.accessToken) };
  }
  // Codex 기기 로그인(세션마다 하나): codex login --device-auth 출력에서 링크·코드를 읽고, 끝나면 onDone
  const codexLogins = new Map();   // target → {proc, state: starting|waiting|done|error, url, code, id, error, at}
  function startCodexLogin(target, id, dir, onDone) {
    const old = codexLogins.get(target); if (old && old.proc) try { old.proc.kill(); } catch {}
    const st = { state: 'starting', url: '', code: '', id, error: '', at: Date.now(), proc: null };
    codexLogins.set(target, st);
    const proc = require('node:child_process').spawn('codex', ['login', '--device-auth'], { env: { ...process.env, CODEX_HOME: dir, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    st.proc = proc; let out = '';
    const read = (b) => {
      out += String(b).replace(/\x1b\[[0-9;]*m/g, '');
      const u = /https:\/\/\S+/.exec(out), c = /\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/.exec(out);
      if (u && c && st.state === 'starting') { st.url = u[0]; st.code = c[1]; st.state = 'waiting'; }
    };
    proc.stdout.on('data', read); proc.stderr.on('data', read);
    const kill = setTimeout(() => { try { proc.kill(); } catch {} }, 16 * 60 * 1000);   // 코드는 15분 뒤 만료
    proc.on('error', (e) => { st.state = 'error'; st.error = `Could not run codex — ${e.message}`; st.proc = null; clearTimeout(kill); });
    proc.on('exit', async (code) => {
      clearTimeout(kill); st.proc = null;
      if (st.state === 'cancelled') return;
      if (code === 0 && require('node:fs').existsSync(path.join(dir, 'auth.json'))) {
        try { await onDone(); st.state = 'done'; } catch (e) { st.state = 'error'; st.error = e.message; }
      } else { st.state = 'error'; st.error = (out.split('\n').map((x) => x.trim()).filter(Boolean).slice(-1)[0] || `codex login ended (${code})`).slice(0, 300); }
    });
    return st;
  }
  // 서버가 멈추면 띄운 로그인도 같이 멈춘다(남으면 쓰이지 않는 코드가 계속 살아 있다). SIGTERM·SIGINT는 기본 동작(종료)을 지킨다
  const stopLogins = () => { for (const st of codexLogins.values()) if (st.proc) try { st.proc.kill(); } catch {} };
  process.once('exit', stopLogins);
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { stopLogins(); process.kill(process.pid, sig); });
  const loginView = (st) => (st ? { state: st.state, url: st.url, code: st.code, account: st.id, error: st.error } : null);
  // Claude Code 로그인 정보(macOS keychain → <설정 폴더>/.credentials.json). 토큰은 서버 밖으로 내보내지 않는다.
  // 키체인 항목 이름은 Claude Code와 같게: CLAUDE_CONFIG_DIR이 있으면 'Claude Code-credentials-<sha256(폴더) 앞 8자>'
  async function readOauth(cfg = DEFAULT_CLAUDE) {
    let raw = '';
    if (process.platform === 'darwin') {
      const svc = `Claude Code-credentials${cfg.explicit ? '-' + crypto.createHash('sha256').update(String(cfg.dir).normalize('NFC')).digest('hex').slice(0, 8) : ''}`;
      raw = await new Promise((resolve) => execFile('security',
        ['find-generic-password', '-s', svc, '-w'],
        { timeout: 3000 }, (e, so) => resolve(e ? '' : String(so))));
    }
    if (!raw) raw = await fsp.readFile(path.join(cfg.dir, '.credentials.json'), 'utf8').catch(() => '');
    try { return (JSON.parse(raw) || {}).claudeAiOauth || null; } catch { return null; }
  }
  const limitsCache = new Map();   // cfgKey → {at, data}
  async function collectLimits(cfg = DEFAULT_CLAUDE) {
    const oa = await readOauth(cfg);
    if (!oa || !oa.accessToken) return { available: false, error: 'Not signed in to Claude Code' };
    const r = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: { Authorization: `Bearer ${oa.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { available: false, error: `Usage unavailable (HTTP ${r.status})` };
    const j = await r.json();
    const pick = (x) => (x && Number.isFinite(x.utilization) ? { percent: Math.round(x.utilization), resetsAt: x.resets_at || null } : null);
    return { available: true, fiveHour: pick(j.five_hour), week: pick(j.seven_day), checkedAt: Date.now() };
  }
  async function collectUsage(cfg = DEFAULT_CLAUDE) {
    const out = { checkedAt: Date.now(), today: null, login: null, account: cfg.explicit ? cfg.dir.replace(os.homedir(), '~') : null };
    try {
      const root = path.join(cfg.dir, 'projects');
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
      const oa = await readOauth(cfg);
      if (oa && Number.isFinite(oa.expiresAt)) out.login = {
        expiresAt: oa.expiresAt,
        daysLeft: Math.floor((oa.expiresAt - Date.now()) / 86400000),
        subscriptionType: typeof oa.subscriptionType === 'string' ? oa.subscriptionType : null,
      };
    } catch {}
    return out;
  }

  // ---- 라우트 ----
  const extraApi = (req, res, url, ctx) => routes(req, res, url, ctx);
  async function routes(req, res, url, ctx) {
    const p = url.pathname;
    const { commit, broadcast, csrfOk, jsonBody } = ctx;

    // ---- 내 계정 ----
    if (p === '/api/me' && req.method === 'GET') {
      const email = who(req);
      if (email) touchUser(email);
      return sendJson(res, 200, {
        signedIn: !!email,
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
      // 업무 항목 수는 선언된 종류(배열)마다 — { quotes: 12, leads: 3 }
      const counts = (pick) => Object.fromEntries(relgraph.workLists().map((l) => [l, ((s4 && s4[l]) || []).filter(pick).length]));
      return sendJson(res, 200, {
        me,
        mine: me ? { ...(per[me] || { total: 0, today: 0, actions: {} }), work: counts((x) => x && x.by === me) } : null,
        all: {
          total: log.length, actions, days,
          people: Object.values(per).sort((a, b) => b.total - a.total),
          work: counts(() => true),
        },
        graph: g4,
      }), true;
    }

    if (p === '/api/limits' && req.method === 'GET') {
      // Codex 세션이면 그 세션 기록(token_count)의 한도를, 아니면 Claude 요금제 한도를 준다
      const target = String(url.searchParams.get('target') || '');
      if (target && /^[\w.:@%+-]{1,100}$/.test(target)) {
        const r = await agentLog.resolve(target);
        if (r.kind === 'codex') { const d = await agentLog.read(target, 1e12).catch(() => null); return sendJson(res, 200, (d && d.limits) || { available: false }), true; }
      }
      // 이 세션의 계정(설정 폴더)의 한도 — 세션마다 다른 Claude 계정을 쓰면 각자 자기 한도가 보인다
      const cfg = await claudeConfigOf(target && /^[\w.:@%+-]{1,100}$/.test(target) ? target : ctx.target), key = cfgKey(cfg), hit = limitsCache.get(key);
      if (!hit || Date.now() - hit.at > 60_000) {
        let data; try { data = await collectLimits(cfg); } catch (e) { data = { available: false, error: 'Usage unavailable' }; }
        limitsCache.set(key, { at: Date.now(), data });
      }
      return sendJson(res, 200, limitsCache.get(key).data), true;
    }

    if (p === '/api/usage' && req.method === 'GET') {
      const t0 = String(url.searchParams.get('target') || ''), cfg = await claudeConfigOf(t0 && /^[\w.:@%+-]{1,100}$/.test(t0) ? t0 : ctx.target), key = cfgKey(cfg), hit = usageCache.get(key);
      if (!hit || Date.now() - hit.at > 3600_000) usageCache.set(key, { at: Date.now(), data: await collectUsage(cfg) });
      return sendJson(res, 200, usageCache.get(key).data), true;
    }

    if (p === '/api/state' && req.method === 'GET') {
      let s; try { s = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      const ps = loadProposals();
      const ws = curWs();
      let g; try { g = graph.view(ws, s); } catch (e) { g = { links: [], error: e.message }; }
      return sendJson(res, 200, { ...s, workspace: ws, graph: g,
        proposals: ps.proposals.filter((x) => x.status === 'pending' && (x.ws || DEFAULT_WS) === ws).slice(-50) }), true;
    }

    // ---- 그래프(NodeRel) ----
    // 읽기: 이웃·추적·AI 스키마. 쓰기는 업무 연결은 /api/link, 지식은 /api/knowledge — 원천을 고치면 다음 읽기에 그대로 보인다.
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
      const nameOf = (id) => { const x = relgraph.workLists().flatMap((l) => s[l] || []).find((y) => y && y.id === id); return x ? String(x.title || x.text || '(untitled)').split('\n')[0].slice(0, 30) : id; };
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
      const dl = url.searchParams.get('download') === '1' || type === 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff',
        ...(dl ? { 'content-disposition': attachment(name) } : {}) });
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
        const pr = { id: nextPid(ps), text: text || 'Change proposal', diff: body.diff, ...plainFields(body), status: 'pending', ws: curWs(), at: new Date().toISOString() };
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
        // 상태를 먼저 마킹·저장(부분 실패 시 이중 적용 방지 — QA/BE-M8), 그다음 적용
        pr.status = 'applying'; saveProposals(ps);
        let result;
        try { result = applyDiff(pr.diff, pr.ws || DEFAULT_WS); }
        catch (e) {   // 실패는 '대기'로 조용히 되돌리지 않고 Failed로 남긴다(이유와 함께) — 다시 시도하거나 거절할 수 있다
          pr.status = 'failed'; pr.failReason = String(e.message || e).replace(/'\/[^']*\/([^'/]+)'/g, "'$1'").replace(/(^|\s)\/\S*\/([^\s/]+)/g, '$1$2').slice(0, 300);   // 긴 절대 경로는 파일 이름만
          pr.decidedAt = new Date().toISOString(); saveProposals(ps);
          broadcast({ kind: 'proposal', proposal: pr });
          return sendJson(res, /unknown list/.test(e.message) ? 400 : 500, { error: 'apply failed', detail: e.message }), true;   // 선언 안 된 종류는 요청 쪽 잘못(400)
        }
        pr.status = 'applied'; pr.failReason = ''; pr.decidedAt = new Date().toISOString(); saveProposals(ps);
        const entry = commit({ role: 'system', text: `Changes applied — ${[[result.summary.added, 'added'], [result.summary.updated, 'changed'], [result.summary.removed, 'removed']].filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(', ') || 'nothing changed'}`, src: 'api' });
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
      let result; try { result = applyDiff(body.diff); } catch (e) { const known = /unknown list/.test(e.message); return sendJson(res, known ? 400 : 500, { error: known ? e.message : 'apply failed', detail: e.message }), true; }
      if (result.changed) broadcast({ kind: 'data', version: result.version });
      return sendJson(res, 200, { ok: true, version: result.version, changed: !!result.changed, summary: result.summary }), true;
    }

    // 에이전트가 답에 넣은 그림 파일 — ![…](/절대/경로.png). 그림 확장자만, 그 팬의 작업 폴더나 그 폴더의 Claude 스크래치패드
    // (/tmp/claude-<uid>/<폴더>/…) 안에 실제로(realpath) 있는 것만 준다. 다른 곳의 파일은 403.
    if (p === '/api/agentfile' && (req.method === 'GET' || req.method === 'HEAD')) {
      const target = String(url.searchParams.get('target') || ''), want = String(url.searchParams.get('path') || '');
      if (!/^[\w.:@%+-]{1,100}$/.test(target) || !path.isAbsolute(want)) return sendJson(res, 400, { error: 'target and absolute path required' }), true;
      // download=1이면 어떤 파일이든 내려받기(attachment)로 준다 — 채팅의 [이름](/절대/경로) 링크. 그 밖엔 그림만.
      const dl = url.searchParams.get('download') === '1';
      const imgType = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[path.extname(want).toLowerCase()];
      if (!imgType && !dl) return sendJson(res, 403, { error: 'images only' }), true;
      const type = dl ? 'application/octet-stream' : imgType;
      const r = await agentLog.resolve(target).catch(() => null);
      if (!r || !r.cwd) return sendJson(res, 404, { error: 'agent not found' }), true;
      let abs; try { abs = await fsp.realpath(want); } catch { return sendJson(res, 404, { error: 'not found' }), true; }
      const real = async (d) => { try { return await fsp.realpath(d); } catch { return null; } };
      const slug = r.cwd.replace(/[^A-Za-z0-9]/g, '-'), uid = typeof process.getuid === 'function' ? process.getuid() : '';
      const roots = (await Promise.all([r.cwd, path.join('/tmp', `claude-${uid}`, slug), path.join(os.tmpdir(), `claude-${uid}`, slug)].map(real))).filter(Boolean);
      if (!roots.some((d) => abs.startsWith(d + path.sep))) return sendJson(res, 403, { error: 'forbidden' }), true;
      let st; try { st = await fsp.stat(abs); } catch { return sendJson(res, 404, { error: 'not found' }), true; }
      if (!st.isFile() || st.size > (dl ? 2048 : 25) * 1024 * 1024) return sendJson(res, 404, { error: 'not found' }), true;
      res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'private, no-cache', 'x-content-type-options': 'nosniff',
        ...(dl ? { 'content-disposition': attachment(path.basename(abs)) } : {}) });
      if (req.method === 'HEAD') return res.end(), true;
      require('node:fs').createReadStream(abs).pipe(res);
      return true;
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
          ref: typeof x.ref === 'string' ? x.ref.slice(0, 60) : '', ws: x.workspace === false ? '' : ws, ...plainFields(x),
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

    // ---- 새 에이전트 세션: POST /api/sessions {name, agent: claude|codex} ----
    // tmux 세션 <ANA>-<name>을 이 폴더에서 띄운다. 세션마다 자기 로그인 폴더(~/.claude-<ANA>-<name> · ~/.codex-<ANA>-<name>)를 쓴다 —
    // 같은 이름으로 다시 만들면 그 폴더(로그인)를 그대로 쓴다. Claude는 채팅에 뜨는 첫 실행 화면에서 로그인하고,
    // 로그인 전인 Codex는 서버가 기기 로그인(링크·코드)을 시작하고 세션은 로그인이 끝나면 codex를 띄운다.
    if (p === '/api/sessions' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      const name = String(body.name || '').trim().toLowerCase(), kind = body.agent === 'codex' ? 'codex' : body.agent === 'claude' ? 'claude' : '';
      if (!kind) return sendJson(res, 400, { error: 'agent: claude or codex' }), true;
      const ana = opts.ANA_NAME || core.anaNameOf(ROOT, process.env), id = `${ana}-${name}`, sess = id;
      if (!/^[a-z0-9][a-z0-9-]{0,23}$/.test(name) || !ACCT_ID.test(id)) return sendJson(res, 400, { error: 'Name: lowercase letters, digits and -, up to 24' }), true;
      if (await ctx.ch.tmux(['has-session', '-t', `=${sess}`]).then(() => true, () => false)) return sendJson(res, 409, { error: `A session named ${sess} is already running — pick it from the list` }), true;
      const A = AGENT_ACCT[kind], dir = acctDir(kind, id), fs = require('node:fs');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (!fs.existsSync(path.join(dir, '.ana-account'))) fs.writeFileSync(path.join(dir, '.ana-account'), `created by ANA for ${sess} ${new Date().toISOString()}\n`);
      try { if (!fs.existsSync(path.join(dir, A.copy))) fs.copyFileSync(path.join(A.def(), A.copy), path.join(dir, A.copy)); } catch {}   // 설정만, 로그인은 아니다
      const signedIn = (await acctInfo(kind, id)).signedIn;
      // 사용자의 로그인 셸로 띄운다(launchd로 뜬 서버의 PATH에는 claude·codex가 없을 수 있다). 로그인 전 Codex는 auth.json이 생기면 그때 codex로
      const run = kind === 'claude' ? 'exec claude'
        : signedIn ? 'exec codex'
        : `printf 'Waiting for Codex sign-in — follow the link in the ANA chat...\\n'; while [ ! -s "$CODEX_HOME/auth.json" ]; do sleep 1; done; exec codex`;
      try {
        await ctx.ch.tmux(['new-session', '-d', '-s', sess, '-c', ROOT, '-x', '160', '-y', '48', '-e', `${A.env}=${dir}`, `${process.env.SHELL || '/bin/zsh'} -lc ${JSON.stringify(run).replace(/\$/g, '\\$')}`]);
      } catch (e) { return sendJson(res, 500, { error: `Could not start the session — ${e.message}` }), true; }
      audit(actor(req), 'session.create', `${sess}: ${kind}${signedIn ? '' : ' (sign-in)'}`);
      let login = null;
      if (kind === 'codex' && !signedIn) {
        const st = startCodexLogin(sess, id, dir, async () => {});
        for (let n = 0; n < 40 && st.state === 'starting'; n++) await new Promise((r) => setTimeout(r, 250));
        login = loginView(st);
      }
      return sendJson(res, 201, { ok: true, session: sess, agent: kind, signedIn, login }), true;
    }
    //   GET /api/agent-login?target=   진행 중인 Codex 로그인(채팅의 로그인 카드) — 없으면 null
    if (p === '/api/agent-login' && req.method === 'GET') {
      const t = String(url.searchParams.get('target') || ctx.target);
      return sendJson(res, 200, { target: t, login: loginView(codexLogins.get(t)) }), true;
    }
    //   POST /api/agent-login {target, action:'cancel'|'restart'}   취소 또는 새 코드로 다시
    if (p === '/api/agent-login' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      const t = String(body.target || ctx.target), st = codexLogins.get(t);
      if (body.action === 'cancel') { if (st) { st.state = 'cancelled'; if (st.proc) try { st.proc.kill(); } catch {} codexLogins.delete(t); } return sendJson(res, 200, { ok: true }), true; }
      if (body.action === 'restart') {
        const ana = opts.ANA_NAME || core.anaNameOf(ROOT, process.env), id = st ? st.id : (t.startsWith(ana + '-') ? t : '');
        if (!id || !ACCT_ID.test(id)) return sendJson(res, 400, { error: 'No Codex sign-in for this session' }), true;
        const n = startCodexLogin(t, id, acctDir('codex', id), async () => {});
        for (let k = 0; k < 40 && n.state === 'starting'; k++) await new Promise((r) => setTimeout(r, 250));
        return sendJson(res, 200, { ok: true, login: loginView(n) }), true;
      }
      return sendJson(res, 400, { error: "action: 'cancel' or 'restart'" }), true;
    }

    // ---- 에이전트 계정(세션마다) ----
    //   GET  /api/agent-account            지금 세션의 에이전트(claude|codex)와 그 계정, 이 컴퓨터의 계정 목록, 진행 중인 Codex 로그인
    //   POST /api/agent-account {target, account, create?}   그 계정으로 이 세션을 다시 띄운다. 로그인 안 된 Codex 계정이면 기기 로그인부터
    //   POST /api/agent-account {action:'cancel'}            진행 중인 Codex 로그인 취소
    //   (/api/claude-account = 같은 것, 0.28.0 이름)
    if ((p === '/api/agent-account' || p === '/api/claude-account') && req.method === 'GET') {
      const where = await agentLog.resolve(ctx.target).catch(() => ({})), kind = kindOfSession(where);
      const dir = where.configDir || AGENT_ACCT[kind].def(), explicit = !!where.configExplicit;
      const ids = acctIds(kind), cur = !explicit && path.resolve(dir) === path.resolve(AGENT_ACCT[kind].def()) ? 'default' : ids.find((id) => path.resolve(acctDir(kind, id)) === path.resolve(dir)) || '';
      const accounts = await Promise.all(ids.map((id) => acctInfo(kind, id)));
      return sendJson(res, 200, { target: ctx.target, kind, agent: AGENT_ACCT[kind].name, current: cur, ...(cur ? {} : { customDir: tilde(dir) }), accounts, login: loginView(codexLogins.get(ctx.target)) }), true;
    }
    if ((p === '/api/agent-account' || p === '/api/claude-account') && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      const t = ctx.target;
      if (body.target && body.target !== t) return sendJson(res, 409, { error: 'Agent session changed — reopen the account menu' }), true;
      if (body.action === 'cancel') { const st = codexLogins.get(t); if (st) { st.state = 'cancelled'; if (st.proc) try { st.proc.kill(); } catch {} codexLogins.delete(t); } return sendJson(res, 200, { ok: true }), true; }
      const id = String(body.account || '');
      if (id !== 'default' && !ACCT_ID.test(id)) return sendJson(res, 400, { error: 'Account name: lowercase letters, digits and -, up to 32' }), true;
      if (!t || !(await ctx.hasSession())) return sendJson(res, 409, { error: 'No agent session' }), true;
      const where = await agentLog.resolve(t).catch(() => ({})), kind = kindOfSession(where), A = AGENT_ACCT[kind];
      const dir = acctDir(kind, id), fs = require('node:fs');
      if (body.create && id !== 'default') {
        if (fs.existsSync(dir) && acctIds(kind).includes(id)) return sendJson(res, 409, { error: `An account named "${id}" already exists — pick it from the list` }), true;
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(dir, '.ana-account'), `created by ANA ${new Date().toISOString()}\n`);
        // 설정(모델·권한)은 기본 계정 것을 가져와 같은 방식으로 일하게 한다 — 로그인 정보는 가져오지 않는다
        try { if (!fs.existsSync(path.join(dir, A.copy))) fs.copyFileSync(path.join(A.def(), A.copy), path.join(dir, A.copy)); } catch {}
      } else if (!acctIds(kind).includes(id)) return sendJson(res, 404, { error: `No ${A.name} account named "${id}"` }), true;
      // 처음 띄운 명령 그대로. 다른 계정엔 없는 대화를 가리키는 것(claude --resume <id> · codex resume <id>)은 뺀다. 셸만 있던 팬이면 claude|codex로
      let cmd = '';
      try {
        const start = (await ctx.ch.tmux(['display-message', '-p', '-t', t, '#{pane_start_command}'])).trim();
        const clean = start.replace(/\s(?:--resume|-r)(?:=|\s+)[0-9a-f-]{8,}/gi, '').replace(/\bresume\s+(?:--last\b|[0-9a-f-]{8,})/gi, '').replace(/\s{2,}/g, ' ').trim();
        cmd = !start ? kind : clean !== start ? clean : '';
      } catch {}
      const sess = String(t).split(':')[0];
      const relaunch = async () => {
        if (id === 'default' && !process.env[A.env]) await ctx.ch.tmux(['set-environment', '-t', sess, '-u', A.env]).catch(() => {});
        else await ctx.ch.tmux(['set-environment', '-t', sess, A.env, dir]);
        await ctx.ch.tmux(['respawn-pane', '-k', '-t', t, ...(id === 'default' && !process.env[A.env] ? [] : ['-e', `${A.env}=${dir}`]), ...(cmd ? [cmd] : [])]);
        agentLog.forget(t);
      };
      // Codex 계정이 아직 로그인 전이면: 기기 로그인을 먼저(링크·코드를 화면에), 끝나면 다시 띄운다
      if (kind === 'codex' && !(await acctInfo(kind, id)).signedIn) {
        const st = startCodexLogin(t, id, dir, async () => { await relaunch(); audit(actor(req), 'agent.account', `${t}: codex ${id} (signed in)`); });
        for (let n = 0; n < 40 && st.state === 'starting'; n++) await new Promise((r) => setTimeout(r, 250));   // 링크·코드가 나올 때까지(최대 10초)
        if (st.state === 'error') return sendJson(res, 502, { error: st.error }), true;
        return sendJson(res, 202, { ok: true, target: t, kind, login: loginView(st) }), true;
      }
      try { await relaunch(); } catch (e) { return sendJson(res, 500, { error: `Could not restart the agent — ${e.message}` }), true; }
      audit(actor(req), 'agent.account', `${t}: ${kind} ${id}${body.create ? ' (new)' : ''}`);
      return sendJson(res, 200, { ok: true, target: t, kind, account: await acctInfo(kind, id) }), true;
    }

    // ---- System: 이 ANA의 상태와 재시작 ----
    //   GET  /api/system                        이름 · 버전 · 가동 시간 · 노드 · 포트 · 감독자 · 에이전트 세션
    //   POST /api/system/restart {what}         'server' = 이 서버 프로세스를 다시 띄운다, 'agent' = 에이전트 팬을 같은 명령으로 다시 띄운다
    if (p === '/api/system' && req.method === 'GET') {
      let agent = { target: '', alive: false, command: '' };
      try { agent.target = ctx.ch.getTarget(); agent.alive = !!(await ctx.hasSession()); if (agent.alive) agent.command = (await ctx.ch.tmux(['display-message', '-p', '-t', agent.target, '#{pane_current_command}'])).trim(); } catch {}
      return sendJson(res, 200, { name: path.basename(ROOT), version: pluginVersion(), node: process.version, pid: process.pid, startedAt: STARTED_AT, uptimeSec: Math.round(process.uptime()),
        port: opts.PORT || null, bind: opts.BIND || '', platform: `${os.type()} ${os.release()}`, supervisor: supervisor(), restarting: !!restarting, agent }), true;
    }
    if (p === '/api/system/restart' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      if (body.what === 'agent') {
        let t = ''; try { t = ctx.ch.getTarget(); } catch {}
        if (!t || !(await ctx.hasSession())) return sendJson(res, 409, { error: 'No agent session to restart' }), true;
        // 팬을 처음 띄운 명령 그대로 다시 실행한다(예: claude --continue → 대화는 이어진다)
        try { await ctx.ch.tmux(['respawn-pane', '-k', '-t', t]); } catch (e) { return sendJson(res, 500, { error: `Could not restart the agent — ${e.message}` }), true; }
        audit(actor(req), 'system.restart', `agent ${t}`);
        return sendJson(res, 200, { ok: true, what: 'agent', target: t }), true;
      }
      if (body.what === 'server') {
        if (restarting) return sendJson(res, 409, { error: 'Already restarting' }), true;
        if (opts.NO_RESTART) return sendJson(res, 409, { error: 'Restart is turned off for this server' }), true;
        restarting = true; const how = supervisor();
        audit(actor(req), 'system.restart', `server (${how})`);
        sendJson(res, 202, { ok: true, what: 'server', supervisor: how, startedAt: STARTED_AT });
        setTimeout(() => restartServer(how), 400);   // 응답이 나간 뒤에
        return true;
      }
      return sendJson(res, 400, { error: "what: 'server' or 'agent'" }), true;
    }

    // 에이전트에게 보내는 지시문의 주소. 브라우저 주소(예: 로그인 게이트웨이 뒤의 base.anahub.io)는 에이전트의 curl이
    // 통과하지 못하므로, 같은 컴퓨터에서 도는 에이전트가 바로 닿는 이 서버의 로컬 주소를 알려 준다.
    if (p === '/api/agent-base' && req.method === 'GET') {
      const b = String(opts.BIND || '127.0.0.1'), host = b === '0.0.0.0' || b === '::' ? '127.0.0.1' : b.includes(':') ? `[${b}]` : b;
      return sendJson(res, 200, { host: opts.PORT ? `${host}:${opts.PORT}` : '' }), true;
    }
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
      it.status = { do: 'doing', done: 'done', fail: 'failed', ignore: 'dismissed', reopen: 'new' }[body.action];
      it.updatedAt = new Date().toISOString();
      it.failReason = body.action === 'fail' ? String(body.reason || '').trim().slice(0, 1000) : '';
      saveUpdates(u); audit(actor(req), `update.${body.action}`, it.title.slice(0, 80));
      broadcast({ kind: 'updates', version: u.version });
      return sendJson(res, 200, { ok: true, status: it.status, item: it, upstreamDir: UPSTREAM_DIR }), true;
    }

    // Knowledge › Documents — GET: 목록(에이전트가 읽을 절대 경로 포함) / POST {name, type, data(base64), note?}: 올리기
    //   POST {action:'remove', id}: 지우기 / GET /api/documents/<id>/file: 내려받기(안전한 종류만 화면에서 열림)
    if (p === '/api/documents' && req.method === 'GET') {
      return sendJson(res, 200, { items: loadDocs().items.map((x) => ({ ...x, path: docPath(x) })).reverse(), max: DOC_MAX }), true;
    }
    if (p === '/api/documents' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res, Math.ceil(DOC_MAX * 4 / 3) + 8192); if (!body) return true;
      const d = loadDocs();
      if (body.action === 'remove') {
        const x = d.items.find((y) => y.id === body.id); if (!x) return sendJson(res, 404, { error: 'not found' }), true;
        d.items = d.items.filter((y) => y !== x); saveDocs(d);
        await fsp.rm(docPath(x), { force: true }).catch(() => {});
        audit(actor(req), 'document.remove', x.name.slice(0, 80)); broadcast({ kind: 'documents', version: d.version });
        return sendJson(res, 200, { ok: true }), true;
      }
      const b64 = typeof body.data === 'string' ? body.data.replace(/^data:[^,]*,/, '') : '';
      if (!b64) return sendJson(res, 400, { error: 'data required (base64)' }), true;
      const buf = Buffer.from(b64, 'base64');
      if (!buf.length) return sendJson(res, 400, { error: 'empty file' }), true;
      if (buf.length > DOC_MAX) return sendJson(res, 413, { error: `file too large (over ${Math.round(DOC_MAX / 1048576)} MB)` }), true;
      const name = clip(String(body.name || 'file').split(/[\\/]/).pop().replace(/[\r\n]+/g, ' ').trim() || 'file', 160);
      const x = { id: `doc-${d.next++}`, name, file: '', size: buf.length, type: clip(body.type, 100), note: clip(body.note, 300), by: actor(req), at: new Date().toISOString() };
      x.file = `${x.id}-${safeName(name)}`;
      try { await fsp.mkdir(DOCS_DIR, { recursive: true }); await fsp.writeFile(docPath(x), buf); } catch (e) { return sendJson(res, 500, { error: `Save failed: ${e.message}` }), true; }
      d.items.push(x); saveDocs(d);
      audit(actor(req), 'document.add', `${(path.extname(name) || '?').toLowerCase()} ${buf.length}`);
      broadcast({ kind: 'documents', version: d.version });
      return sendJson(res, 200, { ok: true, item: { ...x, path: docPath(x) } }), true;
    }
    if (/^\/api\/documents\/[\w-]+\/file$/.test(p) && (req.method === 'GET' || req.method === 'HEAD')) {
      const x = loadDocs().items.find((y) => y.id === p.split('/')[3]); if (!x) return sendJson(res, 404, { error: 'not found' }), true;
      let st; try { st = await fsp.stat(docPath(x)); } catch { return sendJson(res, 404, { error: 'file missing' }), true; }
      const inline = DOC_INLINE[path.extname(x.name).toLowerCase()];
      res.writeHead(200, { 'content-type': inline || 'application/octet-stream', 'content-length': st.size, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store',
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(x.name)}` });
      if (req.method === 'HEAD') return res.end(), true;
      require('node:fs').createReadStream(docPath(x)).pipe(res);
      return true;
    }
    // Knowledge — GET: 온톨로지와 그래프 / POST {classes?, relations?, entities?, facts?}: 더하기(같은 id는 고침)
    //   POST {action:'remove', kind: class|relation|entity|fact, id | from,rel,to}: 지우기(개체를 지우면 그 개체의 사실도)
    if (p === '/api/knowledge' && req.method === 'GET') { let g = null; try { g = graph.ontology(curWs()); } catch (e) { g = { error: e.message }; } let rules = null; try { rules = ontologyRules(); } catch (e) { rules = { error: e.message }; } return sendJsonGz(req, res, 200, { ...loadKnowledge(), graph: g, rules }), true; }
    if (p === '/api/knowledge' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res, 2 * 1024 * 1024); if (!body) return true;
      const k = loadKnowledge();
      if (body.action === 'remove') {
        const before = k.classes.length + k.relations.length + k.entities.length + k.facts.length;
        if (body.kind === 'class') k.classes = k.classes.filter((x) => x.id !== body.id);
        else if (body.kind === 'relation') k.relations = k.relations.filter((x) => x.id !== body.id);
        else if (body.kind === 'entity') { k.entities = k.entities.filter((x) => x.id !== body.id); k.facts = k.facts.filter((f) => f.from !== body.id && f.to !== body.id); }
        else if (body.kind === 'fact') k.facts = k.facts.filter((f) => factKey(f) !== factKey(body));
        else return sendJson(res, 400, { error: 'kind must be class|relation|entity|fact' }), true;
        if (k.classes.length + k.relations.length + k.entities.length + k.facts.length === before) return sendJson(res, 404, { error: 'not found' }), true;
        saveKnowledge(k); audit(actor(req), 'knowledge.remove', `${body.kind} ${clip(body.id || factKey(body), 60)}`);
        broadcast({ kind: 'knowledge', version: k.version });
        return sendJson(res, 200, { ok: true, version: k.version }), true;
      }
      const n = mergeKnowledge(k, body);
      if (!n) return sendJson(res, 400, { error: 'nothing to add — send classes, relations, entities or facts with valid ids' }), true;
      saveKnowledge(k); audit(actor(req), 'knowledge.add', `${n} items`);
      broadcast({ kind: 'knowledge', version: k.version });
      return sendJson(res, 200, { ok: true, added: n, version: k.version }), true;
    }
    // PRD — GET: 지금 판 + 이력 / POST {md, note, source}: 새 판 / POST {action:'restore', v}: 옛 판을 새 판으로
    if (p === '/api/prd' && req.method === 'GET') {
      const d = loadPrd();
      return sendJson(res, 200, { current: d.versions[d.versions.length - 1] || null, history: d.versions.slice(0, -1).reverse(), version: d.version || 1 }), true;
    }
    if (p === '/api/prd' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res, PRD_MAX + 8192); if (!body) return true;
      let md = body.md, note = body.note, source = body.source;
      if (body.action === 'restore') {
        const old = loadPrd().versions.find((x) => x.v === body.v);
        if (!old) return sendJson(res, 404, { error: 'no such version' }), true;
        md = old.md; note = `Restored version ${old.v}`; source = 'person';
      }
      if (typeof md !== 'string' || !md.trim()) return sendJson(res, 400, { error: 'md (markdown text) required' }), true;
      if (md.length > PRD_MAX) return sendJson(res, 413, { error: `PRD too long (>${PRD_MAX} chars)` }), true;
      const { d, v, unchanged } = addPrdVersion(md, note, source, actor(req));
      if (!unchanged) { audit(actor(req), 'prd.save', `v${v.v}`, clip(v.note, 80)); broadcast({ kind: 'prd', version: d.version }); }
      return sendJson(res, 200, { ok: true, v: v.v, unchanged: !!unchanged }), true;
    }
    if (p === '/api/evolve' && req.method === 'GET') {
      return sendJson(res, 200, loadEvolve()), true;
    }
    // 데이터 변경 제안 전체(대기·적용 중·적용됨·거절됨) — 협업 › Approvals의 네 목록용. 이 워크스페이스, 최근 100개
    if (p === '/api/proposals' && req.method === 'GET') {
      const ws = curWs();
      return sendJson(res, 200, { proposals: loadProposals().proposals.filter((x) => (x.ws || DEFAULT_WS) === ws).slice(-100) }), true;
    }

    // 진화 제안 등록 (에이전트 curl)
    // 진화 제안의 거리와 근거: horizon(tidy 정리 · improve 개선 · reimagine 재구상), because(무엇을 보고), sources(밖에서 본 사례 — http(s) 링크만)
    if (p === '/api/evolve' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      const incoming = Array.isArray(body.proposals) ? body.proposals : (body.title ? [body] : []);
      const valid = [];
      for (const x of incoming) {
        if (!x || typeof x !== 'object' || typeof x.title !== 'string' || !x.title.trim()) continue;
        if (x.type !== undefined && !['improve', 'add', 'remove'].includes(x.type)) return sendJson(res, 400, { error: `invalid type: ${x.type}` }), true;
        if (x.horizon !== undefined && !EVO_HORIZONS.includes(x.horizon)) return sendJson(res, 400, { error: `horizon must be ${EVO_HORIZONS.join('|')}` }), true;
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
        const pr = { id: ev.next++, type: x.type || 'improve', title, desc: String(x.desc || '').slice(0, 1000), status: 'new', at: new Date().toISOString(), ...evoInsight(x) };
        ev.proposals.push(pr); added.push(pr);
      }
      if (ev.proposals.length > 50) ev.proposals = ev.proposals.slice(-50);
      ev.version = (ev.version || 1) + 1; saveEvolve(ev);
      broadcast({ kind: 'evolve', version: ev.version });
      return sendJson(res, 200, { ok: true, ids: added.map((x) => x.id), added: added.length, version: ev.version }), true;
    }

    // 진화 제안 처리 — {id, action: do|done|fail|ignore|reopen}
    if (p === '/api/evolve-act' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      if (!['do', 'done', 'fail', 'ignore', 'reopen'].includes(body.action)) return sendJson(res, 400, { error: 'action must be do|done|fail|ignore|reopen' }), true;
      const ev = loadEvolve();
      const pr = ev.proposals.find((x) => x.id === body.id);
      if (!pr) return sendJson(res, 404, { error: 'not found' }), true;
      pr.status = { do: 'doing', done: 'done', fail: 'failed', ignore: 'dismissed', reopen: 'new' }[body.action];
      pr.failReason = body.action === 'fail' ? String(body.reason || '').trim().slice(0, 1000) : body.action === 'reopen' || body.action === 'do' ? '' : (pr.failReason || '');
      pr.updatedAt = new Date().toISOString();   // 협업 목록(대기·처리 중·완료·취소)에서 최근 것부터 보이게
      audit(actor(req), `evolve.${body.action}`, `#${pr.id}`);
      ev.version = (ev.version || 1) + 1; saveEvolve(ev);
      broadcast({ kind: 'evolve', version: ev.version });
      let notified;
      if (body.action === 'do') {
        const n = queueNotify('evolve.do', `Evolve proposal #${pr.id} requested — [${pr.type}] ${pr.title.replace(/[\r\n]+/g, ' ')}. After applying, if what the app does changed, update the PRD (GET /api/prd, then POST /api/prd {"md":"…","note":"what changed","source":"agent"}), and mark it done with POST /api/evolve-act {"id":${pr.id},"action":"done"}; if it can't be done, POST {"id":${pr.id},"action":"fail","reason":"why"}.`);
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
  const INSTR_ACTION = { Evolve: 'evolve.request', PRD: 'prd.request', Knowledge: 'knowledge.request', Update: 'update.request', Requests: 'requests.request', Approvals: 'approvals.request' };
  const onChat = (req, text) => {
    const me = actor(req); touchUser(me);
    const t = String(text), m = /^\[(Evolve|Requests|Approvals|PRD|Knowledge|Update|Request #\d+)\]\s*/.exec(t);
    // 대화 원문은 에이전트 기록에 이미 있다 — 여기에는 앞 60자와 길이만
    if (!m) { const one = t.replace(/\s+/g, ' ').trim(); return audit(me, 'chat.send', one.length > 60 ? one.slice(0, 60) + '…' : one, `${t.length} chars`); }
    audit(me, m[1].startsWith('Request #') ? 'request.answer' : INSTR_ACTION[m[1]], `${m[1].startsWith('Request #') ? m[1].slice(8) + ' ' : ''}${t.slice(m[0].length).split('\n')[0]}`.replace(/\s+/g, ' ').slice(0, 80));
  };

  return {
    extraApi, snapshotExtra, bootstrap, identify, onChat, userKey,
    // 테스트 export
    applyDiff, hasDiff, validateDiff, loadData, saveData, loadProposals, saveProposals, loadEvolve, saveEvolve, loadRequests, nextPid,
  };
}

module.exports = { createDashboardApi };
