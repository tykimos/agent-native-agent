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

  // ---- 상태 파일 (원자적 + shape 검증) ----
  function loadData() {
    const s = readJsonStrict(DATA_FILE, () => ({ version: 1, items: [], events: [], notes: [] }));
    if (!s || typeof s !== 'object' || Array.isArray(s) || !Array.isArray(s.items))
      throw new Error(`state.json shape invalid (${DATA_FILE})`);
    if (!Array.isArray(s.events)) s.events = []; // 일정(달력) — 할일(items)과 별도
    if (!Array.isArray(s.notes)) s.notes = []; // 메모 — {id, title, text, updatedAt}
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
  function assignFields(target, src) {
    for (const k of Object.keys(src)) {
      if (k === 'id') continue;
      if (ITEM_FIELDS.has(k)) target[k] = k === 'done' ? !!src[k] : src[k];
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
  function queueNotify(kind, text) {
    const n = { id: kind.replace(/[^a-z]/gi, '') + '-' + Date.now().toString(36), kind, text, at: new Date().toISOString(), delivered: false };
    pendingNotifs.push(n);
    if (pendingNotifs.length > 100) pendingNotifs.splice(0, pendingNotifs.length - 100);
    return n;
  }
  // best-effort 주입. 고정 문구 + 답하지마세요. 못 보내면 큐에 남아 pull로 조회 가능. 반환: 전달 여부.
  async function tryDeliver(ctx) {
    if (!NOTIFY_AGENT) return false;
    const n = pendingNotifs.find((x) => !x.delivered);
    if (!n) return false;
    try {
      if (!(await ctx.hasSession()) || !(await ctx.agentAlive()) || ctx.lastDraft) return false;
      const msg = `[ANA-NOTIFY id=${n.id} kind=${n.kind}] ${n.text}\n(이 알림에는 답하지 마세요. 사용자의 다음 요청을 기다리세요.)`;
      await ctx.enqueue(() => ctx.ch.injectText(msg));
      n.delivered = true;
      return true;
    } catch { return false; }
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

    if (p === '/api/usage' && req.method === 'GET') {
      if (!usageCache.data || Date.now() - usageCache.at > 3600_000) {
        usageCache = { at: Date.now(), data: await collectUsage() };
      }
      return sendJson(res, 200, usageCache.data), true;
    }

    if (p === '/api/state' && req.method === 'GET') {
      let s; try { s = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }); }
      const ps = loadProposals();
      return sendJson(res, 200, { ...s, proposals: ps.proposals.filter((x) => x.status === 'pending').slice(-50) }), true;
    }

    // 에이전트 pull 통지 조회
    if (p === '/api/notifications' && req.method === 'GET') {
      const since = url.searchParams.get('since') || '';
      const list = since ? pendingNotifs.slice(pendingNotifs.findIndex((n) => n.id === since) + 1) : pendingNotifs;
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
        const pr = { id: nextPid(ps), text: text || '변경 제안', diff: body.diff, status: 'pending', at: new Date().toISOString() };
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
        const entry = commit({ role: 'system', text: `변경 적용 완료 (+${result.summary.added} ~${result.summary.updated} -${result.summary.removed}, v${result.version})`, src: 'api' });
        broadcast({ kind: 'commit', messages: [entry] });
        broadcast({ kind: 'proposal', proposal: pr });
        broadcast({ kind: 'data', version: result.version });
        const n = queueNotify('proposal.applied', `제안 #${pr.id} 승인 → 서버가 이미 적용 완료 (v${result.version}). 재조회 불필요.`);
        const notified = await tryDeliver(ctx);
        return sendJson(res, 200, { ok: true, applied: true, version: result.version, notified, notifyId: n.id }), true;
      }
      pr.status = 'rejected'; saveProposals(ps);
      const entry = commit({ role: 'system', text: `제안 #${pr.id} 을(를) 취소했어요.`, src: 'api' });
      broadcast({ kind: 'commit', messages: [entry] });
      broadcast({ kind: 'proposal', proposal: pr });
      broadcast({ kind: 'data', version: dataVersion() }); // 거절도 version 노출 갱신(remote: 폴링 스테일 방지)
      const n = queueNotify('proposal.rejected', `제안 #${pr.id} 거절됨${body.reason ? ' — 사유: ' + String(body.reason).replace(/[\r\n]+/g, ' ').slice(0, 200) : ''}.`);
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
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      let s; try { s = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      const it = s.items.find((x) => x.id === body.id);
      if (!it) return sendJson(res, 404, { error: 'not found' }), true;
      it.done = !!body.done;
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
        s.events.push({ id: newId('e'), title: title.slice(0, 200), date, time, done: false });
      } else if (body.action === 'remove') {
        const b = s.events.length; s.events = s.events.filter((e) => e.id !== body.id);
        if (s.events.length === b) return sendJson(res, 404, { error: 'not found' }), true;
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
      const it = { id: newId('a'), title: title.slice(0, 200), done: false };
      if (body.due && /^\d{4}-\d{2}-\d{2}$/.test(String(body.due))) it.due = String(body.due);
      s.items.push(it);
      s.version = (s.version || 1) + 1; saveData(s);
      broadcast({ kind: 'data', version: s.version });
      return sendJson(res, 200, { ok: true, version: s.version, id: it.id }), true;
    }

    // 할일 삭제 — {id}
    if (p === '/api/todo-remove' && req.method === 'POST') {
      if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' }), true;
      const body = await jsonBody(req, res); if (!body) return true;
      let s; try { s = loadData(); } catch (e) { return sendJson(res, 500, { error: 'state file corrupt', detail: e.message }), true; }
      const b = s.items.length; s.items = s.items.filter((x) => x.id !== body.id);
      if (s.items.length === b) return sendJson(res, 404, { error: 'not found' }), true;
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
        const n = { id: newId('n'), title: String(body.title || '').slice(0, 200), text: String(body.text || '').slice(0, 20000), updatedAt: new Date().toISOString() };
        s.notes.push(n); noteId = n.id;
      } else if (body.action === 'update') {
        const n = s.notes.find((x) => x.id === body.id);
        if (!n) return sendJson(res, 404, { error: 'not found' }), true;
        if (body.title !== undefined) n.title = String(body.title).slice(0, 200);
        if (body.text !== undefined) n.text = String(body.text).slice(0, 20000);
        n.updatedAt = new Date().toISOString(); noteId = n.id;
      } else if (body.action === 'remove') {
        const b = s.notes.length; s.notes = s.notes.filter((x) => x.id !== body.id);
        if (s.notes.length === b) return sendJson(res, 404, { error: 'not found' }), true;
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
        const n = queueNotify('evolve.do', `진화 제안 #${pr.id} 수행 요청 — [${pr.type}] ${pr.title.replace(/[\r\n]+/g, ' ')}. 반영 후 POST /api/evolve-act {"id":${pr.id},"action":"done"} 로 완료 표시.`);
        notified = await tryDeliver(ctx);
        return sendJson(res, 200, { ok: true, status: pr.status, version: ev.version, notified, notifyId: n.id }), true;
      }
      return sendJson(res, 200, { ok: true, status: pr.status, version: ev.version }), true;
    }

    return false; // 미처리 → 채널 라우트로
  }

  const snapshotExtra = () => { try { return { version: dataVersion() }; } catch { return { version: 1 }; } };

  return {
    extraApi, snapshotExtra, bootstrap,
    // 테스트 export
    applyDiff, hasDiff, validateDiff, loadData, saveData, loadProposals, saveProposals, loadEvolve, saveEvolve, nextPid,
  };
}

module.exports = { createDashboardApi };
