'use strict';
// dashboard-api.js — 대시보드 상태 API (채널 코어 위에 얹힌 계층).
// 담당: /api/state · /api/agent(제안) · /api/approve · /api/apply · /api/done · /api/note · /api/evolve · /api/evolve-act
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

function createDashboardApi(core, opts) {
  const { ROOT } = opts;
  const DATA_FILE = opts.DATA_FILE || path.join(ROOT, 'data', 'state.json');
  const PROPOSALS_FILE = opts.PROPOSALS_FILE || path.join(ROOT, 'data', 'proposals.json');
  const EVOLVE_FILE = opts.EVOLVE_FILE || path.join(ROOT, 'data', 'evolve.json');
  const NOTIFY_AGENT = opts.NOTIFY_AGENT !== false;
  const MAX_TEXT = opts.MAX_TEXT || 8000;
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

  // ---- 상태 파일 (원자적 + shape 검증) ----
  function loadData() {
    const s = readJsonStrict(DATA_FILE, () => ({ version: 1, items: [], events: [], notes: [] }));
    if (!s || typeof s !== 'object' || Array.isArray(s) || !Array.isArray(s.items))
      throw new Error(`state.json shape invalid (${DATA_FILE})`);
    if (!Array.isArray(s.events)) s.events = []; // 일정(달력) — 할일(items)과 별도
    if (!Array.isArray(s.notes)) s.notes = []; // 메모 — {id, title, text, updatedAt}
    // 미팅(회의록) — {id, title, date, time, endTime, place, attendees[], notes[], decisions[], actions[], photos[], at}
    if (!Array.isArray(s.meetings)) s.meetings = [];
    if (typeof s.version !== 'number' || !Number.isFinite(s.version)) s.version = 1;
    return s;
  }
  const newId = (p) => p + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
  const saveData = (s) => writeJsonAtomic(DATA_FILE, s);

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
    if (typeof v === 'object') return '';                 // {a:1} 같은 값이 state.json에 저장되지 않도록
    return String(v).slice(0, FIELD_MAX[k] || 200);
  };
  function assignFields(target, src) {
    for (const k of Object.keys(src)) {
      if (k === 'id') continue;
      if (ITEM_FIELDS.has(k)) target[k] = coerceField(k, src[k]);
    }
  }
  // 방어적 적용: caller id 무시(QA-M5), 키 화이트리스트(QA-m3), done 불리언, 실제 변경 0이면 version 미증가(QA-m2)
  function applyDiff(diff) {
    const s = loadData();
    const summary = { added: 0, updated: 0, removed: 0 };
    (diff.remove || []).forEach((id) => { const b = s.items.length; s.items = s.items.filter((it) => it.id !== id); if (s.items.length < b) summary.removed++; });
    (diff.update || []).forEach((u) => { const it = s.items.find((x) => x.id === u.id); if (it) { assignFields(it, u); summary.updated++; } });
    (diff.add || []).forEach((a) => { const it = { id: 'a' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), done: false }; assignFields(it, a); s.items.push(it); summary.added++; });
    const changed = summary.added || summary.updated || summary.removed;
    if (changed) { s.version = (s.version || 1) + 1; saveData(s); }
    return { summary, version: s.version, changed };
  }
  const dataVersion = () => { try { return loadData().version || 1; } catch { return 1; } };

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
      let raw = '';
      if (process.platform === 'darwin') {
        raw = await new Promise((resolve) => execFile('security',
          ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
          { timeout: 3000 }, (e, so) => resolve(e ? '' : String(so))));
      }
      if (!raw) raw = await fsp.readFile(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8').catch(() => '');
      const oa = (JSON.parse(raw) || {}).claudeAiOauth;
      if (oa && Number.isFinite(oa.expiresAt)) out.login = {
        expiresAt: oa.expiresAt,
        daysLeft: Math.floor((oa.expiresAt - Date.now()) / 86400000),
        subscriptionType: typeof oa.subscriptionType === 'string' ? oa.subscriptionType : null,
      };
    } catch {}
    return out;
  }

  // ---- 라우트 ----
  async function extraApi(req, res, url, ctx) {
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
    // ---- 멤버 카드 ----
    // 계정 기록 + 감사 로그 + 실제 콘텐츠를 합쳐 한 번에 내려준다(클라이언트에서 조인하지 않도록).
    if (p === '/api/members' && req.method === 'GET') {
      const users = loadUsers().users;
      const log = readAudit(0);
      let st = null; try { st = loadData(); } catch {}
      const seen = new Map();
      const slot = (email) => {
        if (!seen.has(email)) {
          const u = users[email] || {};
          seen.set(email, {
            email, name: u.name || (email === 'ana' ? 'ANA' : email.split('@')[0]), avatar: u.avatar || '',
            firstSeen: u.firstSeen || '', lastSeen: u.lastSeen || '',
            registered: !!users[email],
            // 표시 이름을 바꿨거나 사진을 올렸으면 '프로필을 손본 사람'
            customized: !!(u.avatar || (u.name && u.name !== email.split('@')[0])),
            profileUpdatedAt: '', activity: 0, lastAt: '', lastAction: '',
            counts: { todos: 0, meetings: 0, notes: 0, events: 0, comments: 0, chats: 0 },
          });
        }
        return seen.get(email);
      };
      Object.keys(users).forEach(slot);
      for (const a of log) {
        const m = slot(a.by || 'ana');
        m.activity++;
        if (!m.lastAt || a.at > m.lastAt) { m.lastAt = a.at; m.lastAction = a.action; }
        if (a.action === 'chat.send') m.counts.chats++;
        if (a.action === 'comment.add') m.counts.comments++;
        if (a.action === 'profile.update' && (!m.profileUpdatedAt || a.at > m.profileUpdatedAt)) m.profileUpdatedAt = a.at;
      }
      if (st) {
        for (const it of st.items || []) if (it.by) slot(it.by).counts.todos++;
        for (const ev of st.events || []) if (ev.by) slot(ev.by).counts.events++;
        for (const n of st.notes || []) if (n.by) slot(n.by).counts.notes++;
        for (const mt of st.meetings || []) if (mt.by) slot(mt.by).counts.meetings++;
      }
      const members = [...seen.values()].sort((a, b) => (b.activity - a.activity) || a.email.localeCompare(b.email));
      return sendJson(res, 200, { members, me: who(req) }), true;
    }
    // ---- 활동 이력 / 통계 ----
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
      const mineCount = (arr) => (arr || []).filter((x) => x.by === me).length;
      return sendJson(res, 200, {
        me,
        mine: me ? {
          ...(per[me] || { total: 0, today: 0, actions: {} }),
          todos: mineCount(s4 && s4.items), meetings: mineCount(s4 && s4.meetings),
          events: mineCount(s4 && s4.events), notes: mineCount(s4 && s4.notes),
        } : null,
        all: {
          total: log.length, actions, days,
          people: Object.values(per).sort((a, b) => b.total - a.total),
          todos: (s4 && s4.items || []).length, meetings: (s4 && s4.meetings || []).length,
          events: (s4 && s4.events || []).length, notes: (s4 && s4.notes || []).length,
        },
      }), true;
    }

    if (p === '/api/usage' && req.method === 'GET') {
      if (!usageCache.data || Date.now() - usageCache.at > 3600_000) {
        usageCache = { at: Date.now(), data: await collectUsage() };
      }
      return sendJson(res, 200, usageCache.data), true;
    }

    if (p === '/api/state' && req.method === 'GET') {
      let s; try { s = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      const ps = loadProposals();
      return sendJson(res, 200, { ...s, proposals: ps.proposals.filter((x) => x.status === 'pending').slice(-50) }), true;
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
      return sendJson(res, 200, { ok: true, path: file, name, size: buf.length }), true;
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

    // 공유 링크 — /m/<id> 는 읽기 전용 회의록 페이지를 그대로 내려준다.
    // 이 경로에는 자체 접근 통제가 없다. 링크를 아는 사람은 서버에 닿을 수만 있으면 열람할 수 있으므로,
    // 공개 배포라면 앞단(리버스 프록시·SSO 게이트웨이)에서 인증을 걸어야 한다.
    if (/^\/m\/[\w-]+$/.test(p) && (req.method === 'GET' || req.method === 'HEAD')) {
      const abs = path.join(ROOT, 'share.html');
      let body; try { body = await fsp.readFile(abs); } catch { return sendJson(res, 404, { error: 'not found' }), true; }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : body), true;
    }

    // 미팅 단건 조회(공유 페이지용)
    if (p === '/api/meeting' && req.method === 'GET') {
      let s3; try { s3 = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      const m = s3.meetings.find((x) => x.id === url.searchParams.get('id'));
      if (!m) return sendJson(res, 404, { error: 'not found' }), true;
      return sendJson(res, 200, { meeting: m }), true;
    }

    // 미팅(회의록) — {action: add|remove|thumb}
    if (p === '/api/meeting' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      const me = actor(req); touchUser(me);
      let s2; try { s2 = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      const lines = (v, max, len) => (Array.isArray(v) ? v : [])
        .map((n) => String(n || '').trim()).filter(Boolean).slice(0, max).map((n) => n.slice(0, len));
      // 사진은 업로드된 파일명만 신뢰한다(절대경로가 와도 파일명으로 환원). {full, thumb} 또는 문자열 모두 허용.
      // safeName은 빈 입력에 'file'을 돌려주므로(기본값), 빈 값은 여기서 먼저 걸러야 한다.
      const one = (v) => { const t = String(v || '').split('/').pop(); return t ? safeName(t) : ''; };
      const photoOf = (f) => {
        if (f && typeof f === 'object') { const full = one(f.full); return full ? { full, thumb: one(f.thumb) } : null; }
        const full = one(f); return full ? { full, thumb: '' } : null;
      };
      if (body.action === 'add') {
        const title = String(body.title || '').trim();
        const date = String(body.date || '').trim();
        if (!title) return sendJson(res, 400, { error: 'title required' }), true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { error: 'date must be YYYY-MM-DD' }), true;
        const hhmm = (v) => { const t = String(v || '').trim(); return /^\d{2}:\d{2}$/.test(t) ? t : ''; };
        if (body.time && !hhmm(body.time)) return sendJson(res, 400, { error: 'time must be HH:MM' }), true;
        if (body.endTime && !hhmm(body.endTime)) return sendJson(res, 400, { error: 'endTime must be HH:MM' }), true;
        const actions = (Array.isArray(body.actions) ? body.actions : []).slice(0, 30).map((a) => ({
          task: String((a && a.task) || '').trim().slice(0, 300),
          owner: String((a && a.owner) || '').trim().slice(0, 60),
          due: /^\d{4}-\d{2}-\d{2}$/.test(String((a && a.due) || '')) ? a.due : String((a && a.due) || '').trim().slice(0, 40),
        })).filter((a) => a.task);
        s2.meetings.push({
          id: newId('m'), title: title.slice(0, 200), date,
          time: hhmm(body.time), endTime: hhmm(body.endTime),
          place: String(body.place || '').trim().slice(0, 200),
          attendees: lines(body.attendees, 50, 60),
          notes: lines(body.notes, 40, 300),
          decisions: lines(body.decisions, 30, 300),
          actions,
          photos: (Array.isArray(body.photos) ? body.photos : []).map(photoOf).filter(Boolean).slice(0, 12),
          comments: [],
          by: me, at: new Date().toISOString(),
        });
        audit(me, 'meeting.add', title.slice(0, 80));
      } else if (body.action === 'update') {
        // 부분 수정 — 보낸 필드만 갈아끼운다(사진·썸네일은 건드리지 않는다).
        const m = s2.meetings.find((x) => x.id === body.id);
        if (!m) return sendJson(res, 404, { error: 'not found' }), true;
        if (!owns(m, me)) return sendJson(res, 403, { error: 'Only the author can edit this' }), true;
        const hhmm = (v) => { const t = String(v || '').trim(); return /^\d{2}:\d{2}$/.test(t) ? t : ''; };
        if (body.title !== undefined) {
          const t = String(body.title).trim();
          if (!t) return sendJson(res, 400, { error: 'title required' }), true;
          m.title = t.slice(0, 200);
        }
        if (body.date !== undefined) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) return sendJson(res, 400, { error: 'date must be YYYY-MM-DD' }), true;
          m.date = body.date;
        }
        if (body.time !== undefined) m.time = hhmm(body.time);
        if (body.endTime !== undefined) m.endTime = hhmm(body.endTime);
        if (body.place !== undefined) m.place = String(body.place).trim().slice(0, 200);
        if (body.attendees !== undefined) m.attendees = lines(body.attendees, 50, 60);
        if (body.notes !== undefined) m.notes = lines(body.notes, 40, 300);
        if (body.decisions !== undefined) m.decisions = lines(body.decisions, 30, 300);
        if (body.photos !== undefined) {
          m.photos = (Array.isArray(body.photos) ? body.photos : []).map(photoOf).filter(Boolean).slice(0, 12);
        }
        if (body.actions !== undefined) {
          m.actions = (Array.isArray(body.actions) ? body.actions : []).slice(0, 30).map((a) => ({
            task: String((a && a.task) || '').trim().slice(0, 300),
            owner: String((a && a.owner) || '').trim().slice(0, 60),
            due: String((a && a.due) || '').trim().slice(0, 40),
          })).filter((a) => a.task);
        }
        audit(me, 'meeting.update', m.title.slice(0, 80));
      } else if (body.action === 'comment') {
        const m = s2.meetings.find((x) => x.id === body.id);
        if (!m) return sendJson(res, 404, { error: 'not found' }), true;
        const text = String(body.text || '').trim();
        if (!text) return sendJson(res, 400, { error: 'text required' }), true;
        if (!Array.isArray(m.comments)) m.comments = [];
        if (m.comments.length >= 200) return sendJson(res, 413, { error: 'too many comments' }), true;
        // 대댓글은 1단까지만 — 답글에 답글을 달면 최상위 부모에 붙인다(스레드가 깊어지지 않게).
        let parent = '';
        if (body.parent) {
          const pc = m.comments.find((x) => x.id === body.parent);
          if (!pc) return sendJson(res, 404, { error: 'parent not found' }), true;
          parent = pc.parent || pc.id;
        }
        m.comments.push({ id: newId('c'), text: text.slice(0, 1000), by: me, parent, at: new Date().toISOString() });
        audit(me, parent ? 'comment.reply' : 'comment.add', m.title.slice(0, 80), text.slice(0, 60));
      } else if (body.action === 'comment-update') {
        const m = s2.meetings.find((x) => x.id === body.id);
        if (!m || !Array.isArray(m.comments)) return sendJson(res, 404, { error: 'not found' }), true;
        const c = m.comments.find((x) => x.id === body.cid);
        if (!c) return sendJson(res, 404, { error: 'not found' }), true;
        if (!owns(c, me)) return sendJson(res, 403, { error: 'Only the author can edit this' }), true;
        const text = String(body.text || '').trim();
        if (!text) return sendJson(res, 400, { error: 'text required' }), true;
        c.text = text.slice(0, 1000);
        c.editedAt = new Date().toISOString();
        audit(me, 'comment.update', m.title.slice(0, 80), text.slice(0, 60));
      } else if (body.action === 'comment-remove') {
        const m = s2.meetings.find((x) => x.id === body.id);
        if (!m || !Array.isArray(m.comments)) return sendJson(res, 404, { error: 'not found' }), true;
        const c = m.comments.find((x) => x.id === body.cid);
        if (!c) return sendJson(res, 404, { error: 'not found' }), true;
        if (!owns(c, me)) return sendJson(res, 403, { error: 'Only the author can delete this' }), true;
        // 부모를 지우면 딸린 답글도 함께 사라진다(고아 답글을 남기지 않는다).
        const gone = m.comments.filter((x) => x.id === body.cid || x.parent === body.cid).length;
        m.comments = m.comments.filter((x) => x.id !== body.cid && x.parent !== body.cid);
        audit(me, 'comment.remove', m.title.slice(0, 80), gone > 1 ? `incl. ${gone - 1} replies` : '');
      } else if (body.action === 'thumb') {
        // 브라우저가 만든 썸네일 연결(서버에 이미지 라이브러리가 없어 리사이즈는 클라이언트가 한다)
        const m = s2.meetings.find((x) => x.id === body.id);
        if (!m) return sendJson(res, 404, { error: 'not found' }), true;
        const full = one(body.full);
        const thumb = one(body.thumb);
        const ph = (m.photos || []).find((x) => x && x.full === full);
        if (!ph || !thumb) return sendJson(res, 400, { error: 'full/thumb required' }), true;
        ph.thumb = thumb;
      } else if (body.action === 'remove') {
        const m = s2.meetings.find((x) => x.id === body.id);
        if (!m) return sendJson(res, 404, { error: 'not found' }), true;
        if (!owns(m, me)) return sendJson(res, 403, { error: 'Only the author can delete this' }), true;
        s2.meetings = s2.meetings.filter((x) => x.id !== body.id);
        audit(me, 'meeting.remove', m.title.slice(0, 80));
      } else return sendJson(res, 400, { error: 'action must be add|update|remove|comment|comment-update|comment-remove|thumb' }), true;
      s2.version = (s2.version || 1) + 1; saveData(s2);
      broadcast({ kind: 'data', version: s2.version });
      return sendJson(res, 200, { ok: true, version: s2.version }), true;
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
        const pr = { id: nextPid(ps), text: text || 'Change proposal', diff: body.diff, status: 'pending', at: new Date().toISOString() };
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
      if (!pr || pr.status !== 'pending') return sendJson(res, 400, { error: 'invalid or already-decided proposal' }), true;
      if (body.decision === 'approve') {
        // 상태를 먼저 마킹·저장(부분 실패 시 이중 적용 방지 — QA/BE-M8), 그다음 적용
        pr.status = 'applying'; saveProposals(ps);
        let result;
        try { result = applyDiff(pr.diff); }
        catch (e) { pr.status = 'pending'; saveProposals(ps); return sendJson(res, 500, { error: 'apply failed', detail: e.message }), true; }
        pr.status = 'applied'; saveProposals(ps);
        const entry = commit({ role: 'system', text: `Changes applied (+${result.summary.added} ~${result.summary.updated} -${result.summary.removed}, v${result.version})`, src: 'api' });
        broadcast({ kind: 'commit', messages: [entry] });
        broadcast({ kind: 'proposal', proposal: pr });
        broadcast({ kind: 'data', version: result.version });
        const n = queueNotify('proposal.applied', `Proposal #${pr.id} approved → already applied by the server (v${result.version}). No refetch needed.`);
        const notified = await tryDeliver(ctx);
        return sendJson(res, 200, { ok: true, applied: true, version: result.version, notified, notifyId: n.id }), true;
      }
      pr.status = 'rejected'; saveProposals(ps);
      const entry = commit({ role: 'system', text: `Proposal #${pr.id} was rejected.`, src: 'api' });
      broadcast({ kind: 'commit', messages: [entry] });
      broadcast({ kind: 'proposal', proposal: pr });
      broadcast({ kind: 'data', version: dataVersion() }); // 거절도 version 노출 갱신(remote: 폴링 스테일 방지)
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
      if (body.action === 'add') {
        const title = String(body.title || '').trim();
        const date = String(body.date || '').trim();
        if (!title) return sendJson(res, 400, { error: 'title required' }), true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { error: 'date must be YYYY-MM-DD' }), true;
        const time = String(body.time || '').trim();
        if (time && !/^\d{2}:\d{2}$/.test(time)) return sendJson(res, 400, { error: 'time must be HH:MM' }), true;
        s.events.push({ id: newId('e'), title: title.slice(0, 200), date, time, done: false, by: actor(req) });
        audit(actor(req), 'event.add', title.slice(0, 80));
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
      return sendJson(res, 200, { ok: true, version: s.version }), true;
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
      touchUser(actor(req)); audit(actor(req), 'todo.add', title.slice(0, 80));
      s.version = (s.version || 1) + 1; saveData(s);
      broadcast({ kind: 'data', version: s.version });
      return sendJson(res, 200, { ok: true, version: s.version, id: it.id }), true;
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

    // 진화 제안 조회
    if (p === '/api/evolve' && req.method === 'GET') return sendJson(res, 200, loadEvolve()), true;

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
      const seen = new Set(ev.proposals.map((p2) => (p2.title || '').trim()));
      const added = [];
      for (const x of valid) {
        const title = String(x.title).slice(0, 200);
        if (seen.has(title.trim())) continue; // dedup(coding-M6)
        seen.add(title.trim());
        const pr = { id: ev.next++, type: x.type || 'improve', title, desc: String(x.desc || '').slice(0, 1000), status: 'new', at: new Date().toISOString() };
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
      if (!['do', 'done', 'ignore'].includes(body.action)) return sendJson(res, 400, { error: 'action must be do|done|ignore' }), true;
      const ev = loadEvolve();
      const pr = ev.proposals.find((x) => x.id === body.id);
      if (!pr) return sendJson(res, 404, { error: 'not found' }), true;
      pr.status = body.action === 'do' ? 'doing' : body.action === 'done' ? 'done' : 'dismissed';
      ev.version = (ev.version || 1) + 1; saveEvolve(ev);
      broadcast({ kind: 'evolve', version: ev.version });
      let notified;
      if (body.action === 'do') {
        const n = queueNotify('evolve.do', `Evolve proposal #${pr.id} requested — [${pr.type}] ${pr.title.replace(/[\r\n]+/g, ' ')}. After applying, mark it done with POST /api/evolve-act {"id":${pr.id},"action":"done"}.`);
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
  const onChat = (req, text) => { const me = actor(req); touchUser(me); audit(me, 'chat.send', String(text).replace(/\s+/g, ' ').slice(0, 80)); };

  return {
    extraApi, snapshotExtra, bootstrap, identify, onChat,
    // 테스트 export
    applyDiff, hasDiff, validateDiff, loadData, saveData, loadProposals, saveProposals, loadEvolve, saveEvolve, nextPid,
  };
}

module.exports = { createDashboardApi };
