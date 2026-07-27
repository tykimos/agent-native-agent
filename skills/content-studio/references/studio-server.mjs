/* =============================================================
 * studio-server.mjs — 콘텐츠 스튜디오 (ANA) 백엔드 · 의존성 0(Node 내장)
 *   Watch + Converse: 문서 HTML을 보며 요소를 '칩'으로 집어 대화로 수정.
 *   - 정적: studio.html · 문서 HTML(DOC_ROUTE)
 *   - 채팅 브리지: /api/chat → inbox → (bridge) → fakechat → Claude 세션
 *   - 리치 응답: 세션이 POST /api/agent (텍스트/제안) · /api/approve 로 승인
 *   실행: node studio/studio-server.mjs   (PORT 기본 8791)
 * ============================================================= */
import { createServer } from 'node:http';
import { readFile, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');                 // repo root
const PORT = process.env.STUDIO_PORT || 8791;
const TOKEN = (process.env.STUDIO_TOKEN || '').trim();      // 있으면 API 인증
const STATE_F = join(__dir, 'studio-state.json');

/* ▼▼ 프로젝트별 설정 — 여기만 바꾸면 다른 문서에 이식된다 ▼▼
 *   (원본 키트는 특정 교재 HTML 경로/이름을 하드코딩했다. 상수·환경변수로 분리함.) */
const DOC_FILE = process.env.STUDIO_DOC || join(ROOT, 'docs/document.html');  // 렌더된 문서 HTML 실제 경로
const DOC_ROUTE = process.env.STUDIO_DOC_ROUTE || '/document.html';           // 뷰어 iframe이 부르는 라우트(studio.js·studio-capture.mjs의 DOC_URL과 동일해야 함)
const DOC_NAME = process.env.STUDIO_DOC_NAME || 'Document v1';                // 사이드바에 표시할 문서 이름/버전
/* ▲▲ 프로젝트별 설정 끝 ▲▲ */

// ---- 상태(버전 동기화) ----
const now = () => Math.floor(Date.now() / 1000);
let S = load();
if (!S.bookVersion) S.bookVersion = 1;   // 문서 전용 버전(메시지 저장과 분리 — 채팅마다 뷰어 리로드 방지)
function load() {
  try { return JSON.parse(readFileSync(STATE_F, 'utf8')); }
  catch { return { version: 1, bookVersion: 1, book: DOC_NAME, page: 1, messages: [], inbox: [], proposals: [] }; }
}
function save() { S.version++; writeFileSync(STATE_F, JSON.stringify(S, null, 2)); }
let mid = (S.messages.at(-1)?.id || 0);
const nextId = () => (++mid);
const SYNC = Date.now();   // 서버 부팅 에폭 — 재기동/피드리셋 시 바뀜 → 클라가 감지해 초기화

// ---- HTTP 유틸 ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json' };
const ATT = join(__dir, 'att');   // 채팅 첨부 이미지 서빙 디렉토리
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); };
function body(req) { return new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); }); }
function authed(req) { if (!TOKEN) return true; const h = req.headers['authorization'] || ''; const q = new URL(req.url, 'http://x').searchParams.get('token') || ''; return h === `Bearer ${TOKEN}` || q === TOKEN; }

// 롱폴 대기자(브리지 인바운드)
let waiters = [];
function pushInbox(item) { S.inbox.push(item); save(); const w = waiters; waiters = []; w.forEach(fn => fn()); }

const server = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); return res.end(); }

  // ---- 정적 ----
  if (p === '/' || p === '/studio.html') return serve(res, join(__dir, 'studio.html'));
  if (p === DOC_ROUTE) return serve(res, DOC_FILE);
  if (p === '/studio.js') return serve(res, join(__dir, 'studio.js'));
  if (p.startsWith('/att/')) { const name = decodeURIComponent(p.slice(5)); if (/^[\w.\-]+$/.test(name)) return serve(res, join(ATT, name)); res.writeHead(404); return res.end('bad'); }

  // ---- API (인증) ----
  if (p.startsWith('/api/')) {
    if (!authed(req)) return json(res, 401, { error: 'unauthorized' });

    // 대시보드 상태(버전 동기화)
    if (p === '/api/state' && req.method === 'GET')
      return json(res, 200, { version: S.version, bookVersion: S.bookVersion, book: S.book, page: S.page });

    // 문서가 실제로 바뀌었을 때만 뷰어 리로드(세션이 편집·재렌더 후 호출)
    if (p === '/api/rerender' && req.method === 'POST') {
      S.bookVersion = (S.bookVersion || 1) + 1; save();
      return json(res, 200, { ok: true, bookVersion: S.bookVersion });
    }

    // 채팅 피드 + 제안 (폴링)
    if (p === '/api/feed' && req.method === 'GET') {
      const since = +(u.searchParams.get('since') || 0);
      const status = (S.status && (now() - S.status.ts) < 60) ? S.status.text : '';   // 60초 TTL
      return json(res, 200, { version: S.version, sync: SYNC, messages: S.messages.filter(m => m.id > since), proposals: S.proposals.filter(x => x.status === 'pending'), status });
    }

    // ANA 미러: 세션 활동(사용자 입력·도구 활동·응답)을 피드에 게시
    if (p === '/api/activity' && req.method === 'POST') {
      const b = await body(req);
      const text = (b.text || '').trim();
      if (!text) return json(res, 200, { ok: true });
      S.messages.push({ id: nextId(), role: b.role || 'assistant', kind: b.kind || 'text', text, ts: now() });
      // 피드 폭주 방지: 최근 400건만 유지
      if (S.messages.length > 400) S.messages = S.messages.slice(-400);
      save();
      return json(res, 200, { ok: true });
    }

    // 상단 '처리 중…' 상태(60초 TTL)
    if (p === '/api/status' && req.method === 'POST') {
      const b = await body(req);
      S.status = { text: (b.text || '').trim(), ts: now() };
      return json(res, 200, { ok: true });
    }

    // 사용자 채팅 → 피드 + inbox(→브리지→세션)
    if (p === '/api/chat' && req.method === 'POST') {
      const { text = '', chips = [] } = await body(req);
      if (!text.trim() && !chips.length) return json(res, 400, { error: 'empty' });
      // 중복 방지: 직전 user 메시지와 동일 텍스트가 3초 내면 무시(IME·연타 이중전송 방어)
      const last = S.messages[S.messages.length - 1];
      if (last && last.role === 'user' && last.text === text && (now() - last.ts) <= 3) return json(res, 200, { ok: true, id: last.id, dup: true });
      const m = { id: nextId(), role: 'user', text, chips, ts: now() };
      S.messages.push(m);
      pushInbox({ id: m.id, text, chips, ts: m.ts });     // save() 포함
      return json(res, 200, { ok: true, id: m.id });
    }

    // 브리지 롱폴: 새 인바운드를 fakechat로 밀어넣기 위해 대기
    if (p === '/api/inbox-wait' && req.method === 'GET') {
      const take = () => { const it = S.inbox.shift(); if (it) { save(); json(res, 200, it); return true; } return false; };
      if (take()) return;
      const to = setTimeout(() => { waiters = waiters.filter(f => f !== on); json(res, 200, {}); }, 25000);
      const on = () => { clearTimeout(to); if (!take()) json(res, 200, {}); };
      waiters.push(on);
      return;
    }

    // 세션의 리치 응답(텍스트/제안 카드)
    if (p === '/api/agent' && req.method === 'POST') {
      const b = await body(req);
      const m = { id: nextId(), role: 'agent', text: b.text || '', ts: now() };
      if (b.proposal) {   // 승인 카드
        const pr = { id: nextId(), title: b.proposal.title || '수정 제안', summary: b.proposal.summary || '', diff: b.proposal.diff || '', before: b.proposal.before || '', after: b.proposal.after || '', chips: b.proposal.chips || [], status: 'pending', ts: now() };
        S.proposals.push(pr); m.proposalId = pr.id;
      }
      S.messages.push(m); save();
      return json(res, 200, { ok: true, id: m.id });
    }

    // 제안 승인/반려 → 세션이 /api/inbox-wait 로 결과 받아 실제 적용
    if (p === '/api/approve' && req.method === 'POST') {
      const { id, decision = 'approve', reason = '' } = await body(req);
      const pr = S.proposals.find(x => x.id === id);
      if (!pr) return json(res, 404, { error: 'no proposal' });
      pr.status = decision === 'approve' ? 'approved' : 'rejected'; pr.reason = reason;
      S.messages.push({ id: nextId(), role: 'system', text: `제안#${id} ${pr.status}${reason ? ' — ' + reason : ''}`, ts: now() });
      pushInbox({ kind: 'decision', proposalId: id, decision: pr.status, reason, chips: pr.chips });
      return json(res, 200, { ok: true });
    }

    // 영역 캡처: 문서좌표 clip(+여백)을 헤드리스로 캡처 → att/ 저장 → url 반환
    if (p === '/api/capture' && req.method === 'POST') {
      const b = await body(req);
      const args = [Math.max(0, Math.round(+b.x || 0)), Math.max(0, Math.round(+b.y || 0)), Math.max(8, Math.round(+b.w || 0)), Math.max(8, Math.round(+b.h || 0))];
      const name = 'cap-' + Date.now() + '.png';
      try { mkdirSync(ATT, { recursive: true }); } catch { }
      const outPath = join(ATT, name);
      const ok = await new Promise(r => {
        const proc = spawn(process.execPath, [join(__dir, 'studio-capture.mjs'), ...args.map(String), outPath], { env: { ...process.env, STUDIO_PORT: String(PORT), STUDIO_DOC_ROUTE: DOC_ROUTE }, stdio: 'ignore' });
        const to = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { } r(false); }, 25000);
        proc.on('exit', c => { clearTimeout(to); r(c === 0 && existsSync(outPath)); });
        proc.on('error', () => { clearTimeout(to); r(false); });
      });
      if (!ok) return json(res, 500, { error: 'capture failed' });
      return json(res, 200, { ok: true, url: '/att/' + name });
    }

    // 페이지 이동 동기화
    if (p === '/api/page' && req.method === 'POST') {
      const { page } = await body(req); if (page) { S.page = page; save(); }
      return json(res, 200, { ok: true, page: S.page });
    }
    return json(res, 404, { error: 'no route' });
  }
  res.writeHead(404); res.end('not found');
});

function serve(res, file) {
  readFile(file, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'access-control-allow-origin': '*' });
    res.end(buf);
  });
}

server.listen(PORT, () => console.log(`content studio :${PORT} (doc: ${DOC_FILE}, state: ${STATE_F})${TOKEN ? ' [token on]' : ''}`));
