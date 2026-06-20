/* =========================================================================
   대시보드 + 채팅 브리지 서버 (Node 내장 모듈만, 의존성 0)
   ------------------------------------------------------------------------
   - 정적 대시보드 서빙 + 채팅 브리지 API + 데이터 상태(JSON 파일)
   - 사용자 채팅 → inbox(요청) → 릴레이가 fakechat 채널로 전달 → Claude 세션
   - Claude 가 POST /api/agent 로 리치 응답(텍스트/제안) → 대시보드 표시
   - 사용자가 승인하면 서버가 데이터에 적용(+version 증가) → 모든 기기 동기화
   실행: node server.js   (PORT 환경변수로 포트 변경)
   ========================================================================= */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT ? +process.env.PORT : 8777;
const DATA = path.join(ROOT, "data", "state.json");   // { version, items: [...] }
const FEED = path.join(ROOT, "data", "feed.json");     // { messages, requests, nextMsg, nextReq }

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

function loadFeed() { try { return JSON.parse(fs.readFileSync(FEED, "utf8")); } catch (e) { return { messages: [], requests: [], nextMsg: 1, nextReq: 1 }; } }
function saveFeed(s) { fs.writeFileSync(FEED, JSON.stringify(s, null, 2)); }
function loadData() { try { return JSON.parse(fs.readFileSync(DATA, "utf8")); } catch (e) { return { version: 1, items: [] }; } }
function saveData(s) { fs.writeFileSync(DATA, JSON.stringify(s, null, 2)); }

let state = loadFeed();
let sseClients = [], inboxWaiters = [];

function now() { return Date.now(); }
function broadcast(msg) { const data = "data: " + JSON.stringify(msg) + "\n\n"; sseClients = sseClients.filter(c => { try { c.write(data); return true; } catch (e) { return false; } }); }
function wakeInbox() {
  const pend = state.requests.filter(r => r.status === "new");
  if (!pend.length || !inboxWaiters.length) return;
  inboxWaiters.forEach(w => { clearTimeout(w.timer); try { w.res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); w.res.end(JSON.stringify({ requests: pend })); } catch (e) {} });
  inboxWaiters = [];
}
function addMsg(msg) { msg.id = state.nextMsg++; msg.ts = now(); state.messages.push(msg); broadcast(msg); return msg; }

/* ---- 데이터 변경 적용 (제안 diff 또는 수동 편집) ---- */
function applyDiff(diff) {
  const s = loadData(); const summary = { added: 0, updated: 0, removed: 0 }; diff = diff || {};
  (diff.remove || []).forEach(id => { const b = s.items.length; s.items = s.items.filter(it => it.id !== id); if (s.items.length < b) summary.removed++; });
  (diff.update || []).forEach(u => { const it = s.items.find(x => x.id === u.id); if (it) { Object.assign(it, u); summary.updated++; } });
  (diff.add || []).forEach(a => { s.items.push(Object.assign({ id: a.id || ("a" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)), done: false }, a)); summary.added++; });
  s.version = (s.version || 1) + 1; saveData(s);
  return { summary, version: s.version };
}

function sendJson(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(b); }
function readBody(req, cb) { let d = ""; req.on("data", c => { d += c; if (d.length > 1e6) req.destroy(); }); req.on("end", () => { try { cb(d ? JSON.parse(d) : {}); } catch (e) { cb({}); } }); }

function handleApi(req, res, url) {
  const p = url.pathname;

  // 대시보드 데이터
  if (p === "/api/state" && req.method === "GET") return sendJson(res, 200, loadData());

  // 채팅 피드(+version 동기화). 폴링이 항상 이걸로 데이터 변화도 감지한다.
  if (p === "/api/feed" && req.method === "GET") {
    const since = +(url.searchParams.get("since") || 0);
    let ver = 1; try { ver = loadData().version || 1; } catch (e) {}
    return sendJson(res, 200, { messages: state.messages.filter(m => m.id > since), version: ver });
  }

  // 저지연 실시간(SSE). 터널이 버퍼링할 수 있으니 프론트는 폴링도 함께 돌릴 것.
  if (p === "/api/stream" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "Connection": "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    const since = +(url.searchParams.get("since") || 0);
    state.messages.filter(m => m.id > since).forEach(m => res.write("data: " + JSON.stringify(m) + "\n\n"));
    sseClients.push(res); req.on("close", () => { sseClients = sseClients.filter(c => c !== res); });
    return;
  }

  // 사용자 채팅 → 요청 큐(릴레이가 fakechat 으로 전달)
  if (p === "/api/chat" && req.method === "POST") return readBody(req, b => {
    const text = (b.text || "").toString().trim(); if (!text) return sendJson(res, 400, { error: "empty" });
    const reqId = state.nextReq++;
    state.requests.push({ id: reqId, text, status: "new", ts: now() });
    const m = addMsg({ role: "user", kind: "text", text, reqId }); saveFeed(state); wakeInbox();
    return sendJson(res, 200, { ok: true, msgId: m.id, reqId });
  });

  // 릴레이 롱폴: 새 요청이 올 때까지 최대 25초 대기
  if (p === "/api/inbox-wait" && req.method === "GET") {
    const pend = state.requests.filter(r => r.status === "new");
    if (pend.length) return sendJson(res, 200, { requests: pend });
    const w = { res, timer: null };
    w.timer = setTimeout(() => { inboxWaiters = inboxWaiters.filter(x => x !== w); try { sendJson(res, 200, { requests: [] }); } catch (e) {} }, 25000);
    inboxWaiters.push(w); req.on("close", () => { clearTimeout(w.timer); inboxWaiters = inboxWaiters.filter(x => x !== w); });
    return;
  }

  // Claude(두뇌)의 리치 응답: 텍스트 또는 diff 제안
  if (p === "/api/agent" && req.method === "POST") return readBody(req, b => {
    const r = state.requests.find(x => x.id === b.reqId);
    const hasDiff = b.diff && ((b.diff.add || []).length || (b.diff.update || []).length || (b.diff.remove || []).length);
    const m = addMsg({ role: "assistant", kind: hasDiff ? "proposal" : "text", text: b.text || "", diff: hasDiff ? b.diff : null, status: hasDiff ? "pending" : "info", reqId: b.reqId || null });
    if (r) r.status = hasDiff ? "proposed" : "done";
    saveFeed(state); return sendJson(res, 200, { ok: true, msgId: m.id });
  });

  // 수동 편집 즉시 적용 (제안 없이)
  if (p === "/api/apply" && req.method === "POST") return readBody(req, b => {
    const result = applyDiff(b.diff || {}); return sendJson(res, 200, { ok: true, version: result.version, summary: result.summary });
  });

  // 상태 토글(예: 완료) — 서버 저장으로 모든 기기 공유
  if (p === "/api/done" && req.method === "POST") return readBody(req, b => {
    const s = loadData(); const it = s.items.find(x => x.id === b.id); if (!it) return sendJson(res, 404, { error: "not found" });
    it.done = !!b.done; s.version = (s.version || 1) + 1; saveData(s);
    return sendJson(res, 200, { ok: true, version: s.version, id: b.id, done: it.done });
  });

  // 사용자가 제안 승인/거절
  if (p === "/api/approve" && req.method === "POST") return readBody(req, b => {
    const m = state.messages.find(x => x.id === b.msgId);
    if (!m || m.kind !== "proposal" || m.status !== "pending") return sendJson(res, 400, { error: "invalid" });
    if (b.decision === "approve") {
      const result = applyDiff(m.diff); m.status = "applied";
      if (m.reqId) { const r = state.requests.find(x => x.id === m.reqId); if (r) r.status = "applied"; }
      addMsg({ role: "system", kind: "applied", text: "변경 적용 완료", version: result.version }); saveFeed(state);
      return sendJson(res, 200, { ok: true, applied: true, version: result.version });
    } else {
      m.status = "rejected"; if (m.reqId) { const r = state.requests.find(x => x.id === m.reqId); if (r) r.status = "rejected"; }
      addMsg({ role: "system", kind: "text", text: "변경을 취소했어요." }); saveFeed(state);
      return sendJson(res, 200, { ok: true, applied: false });
    }
  });

  return sendJson(res, 404, { error: "not found" });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname); if (rel === "/") rel = "/index.html";
  const fp = path.normalize(path.join(ROOT, rel));
  if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("404"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url);
  return serveStatic(req, res, url);
}).listen(PORT, () => console.log("dashboard+bridge server on http://localhost:" + PORT));

setInterval(() => { sseClients = sseClients.filter(c => { try { c.write(":ping\n\n"); return true; } catch (e) { return false; } }); }, 20000);
