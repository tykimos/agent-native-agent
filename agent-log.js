'use strict';
// agent-log.js — Claude Code 세션의 구조화된 대화 기록(~/.claude/projects/<cwd>/<session>.jsonl)을 채팅 항목으로 바꾼다.
//
// 채널 코어의 원장은 tmux 화면을 긁어 만든 것이라, 도구 출력·diff·줄바꿈이 본문에 섞인다. Claude Code는 같은 대화를
// 구조화된 JSONL로 남기므로, 대상 세션이 Claude Code면 그 파일을 읽어 Claude 앱과 같은 모양
// (사용자 말풍선 · 응답 본문 · 'Ran 3 commands ›' 도구 묶음 · 이미지)으로 그릴 수 있다.
// 주입·바쁨·다이얼로그는 여전히 채널 코어가 맡는다 — 여기는 읽기 전용 표시 계층이다.
//
// 세션 찾기: tmux 팬의 현재 경로 → ~/.claude/projects/<경로의 비영숫자를 '-'로> → 가장 최근에 바뀐 *.jsonl
// Codex 세션이면 ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl(첫 줄 session_meta.cwd가 팬 경로와 같은 가장 최근 파일)을
// 같은 항목 모양으로 바꾼다 — 사용자 메시지·응답·명령 실행·파일 변경·웹 검색, 그리고 token_count의 요금제 한도.
// 증분 읽기: 파일 오프셋을 기억해 새로 붙은 줄만 파싱한다. 항목이 나중에 바뀌면(도구 결과 도착) rev를 올려
// 클라이언트가 since=rev로 바뀐 것만 받아 id로 덮어쓴다.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const MAX_RESULT = 4000;          // 도구 결과 본문 상한(화면용)
const PROJECTS = path.join(os.homedir(), '.claude', 'projects');
const CODEX_SESSIONS = path.join(os.homedir(), '.codex', 'sessions');

const VERB = {
  Bash: ['Ran', 'command', 'commands'], Read: ['Read', 'file', 'files'], Edit: ['Edited', 'file', 'files'], MultiEdit: ['Edited', 'file', 'files'],
  Write: ['Wrote', 'file', 'files'], NotebookEdit: ['Edited', 'notebook', 'notebooks'], Grep: ['Searched', 'search', 'searches'],
  Glob: ['Searched', 'search', 'searches'], WebFetch: ['Fetched', 'page', 'pages'], WebSearch: ['Searched the web', 'search', 'searches'],
  Task: ['Ran', 'agent', 'agents'], Agent: ['Ran', 'agent', 'agents'], TodoWrite: ['Updated', 'todo list', 'todo lists'],
};
const base = (p) => String(p || '').split('/').pop();
function toolLabel(name, input) {
  const i = input || {};
  const arg = name === 'Bash' ? (i.description || i.command || '')
    : ['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(name) ? base(i.file_path || i.notebook_path)
    : ['Grep', 'Glob'].includes(name) ? (i.pattern || '')
    : name === 'WebFetch' ? (i.url || '') : name === 'WebSearch' ? (i.query || '')
    : ['Task', 'Agent'].includes(name) ? (i.description || '') : (i.description || '');
  const verb = (VERB[name] || [name])[0];
  return { verb, arg: String(arg).split('\n')[0].slice(0, 160) };
}
// 사용자 입력에서 에이전트용 부가물을 걷어낸다(시스템 리마인더·슬래시 명령 래퍼 등)
function cleanUser(t) {
  let s = String(t || '');
  s = s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
  const cmd = /<command-name>([\s\S]*?)<\/command-name>/.exec(s);
  if (cmd) { const args = (/<command-args>([\s\S]*?)<\/command-args>/.exec(s) || [])[1] || ''; return `${cmd[1].trim()} ${args.trim()}`.trim(); }
  if (/^\s*<(local-command-stdout|local-command-stderr|bash-stdout|bash-stderr|command-message)>/.test(s)) return '';
  return s.trim();
}
// 'claude-opus-5-5' → 'Opus 5.5', 'claude-haiku-4-5-20251001' → 'Haiku 4.5', 'claude-sonnet-5' → 'Sonnet 5'
function modelName(id) {
  const m = /^claude-([a-z]+)-(\d+(?:-\d+)*?)(?:-\d{8})?$/.exec(String(id || ''));
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2].replace(/-/g, '.')}` : String(id || '');
}
// 'gpt-6-astra' → 'GPT-6 Astra', 'gpt-5.6-sol' → 'GPT-5.6 Sol'
function codexModelName(id) {
  const m = /^gpt-([\d.]+)(?:-(.+))?$/i.exec(String(id || ''));
  return m ? `GPT-${m[1]}${m[2] ? ' ' + m[2].split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : ''}` : String(id || '');
}
// Codex rate_limits → {fiveHour, week}: 창 길이(분)로 구분한다(300분 ≈ 5시간, 10080분 = 7일)
function codexLimits(rl) {
  const out = { available: true, fiveHour: null, week: null };
  for (const w of [rl && rl.primary, rl && rl.secondary]) {
    if (!w || !Number.isFinite(w.used_percent)) continue;
    const v = { percent: Math.round(w.used_percent), resetsAt: w.resets_at ? new Date(w.resets_at * 1000).toISOString() : null };
    if (w.window_minutes <= 360) out.fiveHour = v; else out.week = v;
  }
  return out.fiveHour || out.week ? out : null;
}
// 이 경로(cwd)에서 가장 최근에 쓰인 Codex rollout — 최근 7일 폴더만 본다
function findCodexRollout(cwd) {
  const files = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000);
    const dir = path.join(CODEX_SESSIONS, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
    let names = []; try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) if (n.startsWith('rollout-') && n.endsWith('.jsonl')) { try { files.push({ f: path.join(dir, n), m: fs.statSync(path.join(dir, n)).mtimeMs }); } catch {} }
  }
  files.sort((a, b) => b.m - a.m);
  for (const { f } of files) {
    let first = '';
    try { const fd = fs.openSync(f, 'r'); try { const buf = Buffer.alloc(64 * 1024); const n = fs.readSync(fd, buf, 0, buf.length, 0); first = buf.toString('utf8', 0, n).split('\n')[0]; } finally { fs.closeSync(fd); } } catch { continue; }
    try { const j = JSON.parse(first); if (j.type === 'session_meta' && j.payload && j.payload.cwd === cwd) return f; } catch {}
  }
  return null;
}
const resultText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text).join('\n') : '');

function createAgentLog({ socket = '' } = {}) {
  const logs = new Map();       // file → 파서 상태
  const where = new Map();      // target → {file, cwd, at}

  function tmuxInfo(target) {
    return new Promise((resolve) => {
      const args = [...(socket ? ['-L', socket] : []), 'display-message', '-p', '-t', target, '#{pane_current_path}\t#{pane_current_command}\t#{pane_start_command}'];
      execFile('tmux', args, { timeout: 3000 }, (err, out) => {
        if (err) return resolve(null);
        const [cwd, cmd, start] = String(out).trim().split('\t');
        resolve({ cwd, cmd, start: start || '' });
      });
    });
  }
  // 대상 세션의 기록 파일. Claude Code가 아니면 null(→ 화면은 기존 원장으로 그린다)
  async function resolve(target) {
    const hit = where.get(target);
    if (hit && Date.now() - hit.at < 5000) return hit;
    const info = await tmuxInfo(target);
    let file = null, kind = '';
    if (info && info.cwd && !/claude/i.test(info.cmd || '') && /codex/i.test(`${info.cmd} ${info.start} ${target}`)) {
      kind = 'codex'; file = findCodexRollout(info.cwd);
    } else if (info && /claude/i.test(info.cmd || '') && info.cwd) {
      kind = 'claude';
      const dir = path.join(PROJECTS, info.cwd.replace(/[^A-Za-z0-9]/g, '-'));
      try {
        file = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
          .map((f) => ({ f: path.join(dir, f), m: fs.statSync(path.join(dir, f)).mtimeMs }))
          .sort((a, b) => b.m - a.m)[0]?.f || null;
      } catch { file = null; }
    }
    const r = { file, kind, cwd: info && info.cwd, at: Date.now() };
    where.set(target, r);
    return r;
  }

  function state(file, kind) {
    if (!logs.has(file)) logs.set(file, { kind: kind || 'claude', offset: 0, rev: 0, items: [], byId: new Map(), tools: new Map(), title: '', session: path.basename(file, '.jsonl'), carry: '' });
    return logs.get(file);
  }
  // 새로 붙은 줄만 읽는다. 파일이 줄었으면(교체) 처음부터.
  function update(file, kind) {
    const st = state(file, kind);
    let size; try { size = fs.statSync(file).size; } catch { return st; }
    if (size < st.offset) { logs.delete(file); return update(file, kind); }
    if (size === st.offset) return st;
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - st.offset);
      fs.readSync(fd, buf, 0, buf.length, st.offset);
      let pos = st.offset - Buffer.byteLength(st.carry);
      const text = st.carry + buf.toString('utf8');
      const lines = text.split('\n');
      st.carry = lines.pop();                         // 아직 다 안 쓰인 마지막 줄
      for (const line of lines) {
        const len = Buffer.byteLength(line) + 1;
        if (line.trim()) { let j; try { j = JSON.parse(line); } catch { j = null; } if (j) (st.kind === 'codex' ? ingestCodex : ingest)(st, j, pos, len); }
        pos += len;
      }
      st.offset = size;
    } finally { fs.closeSync(fd); }
    return st;
  }

  const touch = (st, it) => { it.rev = ++st.rev; };
  function push(st, it) { st.items.push(it); st.byId.set(it.id, it); touch(st, it); return it; }
  const last = (st) => st.items[st.items.length - 1];
  // 이미지는 본문 대신 위치(줄 오프셋·블록 경로)만 기억했다가 요청 때 그 줄만 다시 읽는다
  const imgRef = (off, len, p) => `${off}.${len}.${p.join('-')}`;

  function userItem(st, j, blocks, off, len, pathPrefix, queued) {
    const texts = [], images = [];
    blocks.forEach((b, i) => {
      if (b.type === 'text') texts.push(b.text);
      else if (b.type === 'image') images.push(imgRef(off, len, [...pathPrefix, i]));
    });
    const text = cleanUser(texts.join('\n'));
    if (!text && !images.length) return;
    push(st, { id: j.uuid || `u${off}`, kind: 'user', text, images, at: j.timestamp || (j.attachment && j.attachment.timestamp) || '', queued: !!queued });
  }

  function ingest(st, j, off, len) {
    if (j.type === 'ai-title' && j.aiTitle) { st.title = j.aiTitle; st.rev++; return; }
    if (j.isSidechain) return;                                   // 서브에이전트 내부 대화는 숨긴다
    if (j.type === 'attachment' && j.attachment && j.attachment.type === 'queued_command') {
      const p = j.attachment.prompt;
      userItem(st, j, typeof p === 'string' ? [{ type: 'text', text: p }] : (Array.isArray(p) ? p : []), off, len, ['attachment', 'prompt'], true);
      return;
    }
    if (j.type === 'system' && j.subtype === 'compact_boundary') { push(st, { id: j.uuid, kind: 'event', text: 'Earlier conversation was compacted' }); return; }
    if (j.type === 'user' && j.message) {
      if (j.isMeta || j.isCompactSummary) return;
      const c = j.message.content;
      if (typeof c === 'string') { userItem(st, j, [{ type: 'text', text: c }], off, len, ['message', 'content'], false); return; }
      if (!Array.isArray(c)) return;
      // 도구 결과는 해당 도구에 붙인다
      c.forEach((b, i) => {
        if (b.type !== 'tool_result') return;
        const t = st.tools.get(b.tool_use_id); if (!t) return;
        t.tool.done = true; t.tool.isError = !!b.is_error;
        t.tool.result = resultText(b.content).slice(0, MAX_RESULT);
        if (Array.isArray(b.content)) b.content.forEach((x, k) => { if (x.type === 'image') t.tool.images.push(imgRef(off, len, ['message', 'content', i, 'content', k])); });
        touch(st, t.item);
      });
      const rest = c.filter((b) => b.type === 'text' || b.type === 'image');
      if (rest.length && !c.some((b) => b.type === 'tool_result')) {
        if (/^\[Request interrupted by user/.test(resultText(rest))) { push(st, { id: j.uuid, kind: 'event', text: 'Interrupted' }); return; }
        userItem(st, j, c, off, len, ['message', 'content'], false);
      }
      return;
    }
    if (j.type === 'assistant' && j.message && j.message.model && !/synthetic/.test(j.message.model) && j.message.model !== st.model) { st.model = j.message.model; st.rev++; }
    if (j.type === 'assistant' && typeof j.effort === 'string' && j.effort !== st.effort) { st.effort = j.effort; st.rev++; }
    if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
      for (const b of j.message.content) {
        if (b.type === 'text' && b.text.trim()) {
          const prev = last(st);
          // 같은 응답(message.id)의 연속 텍스트는 한 덩어리로
          if (prev && prev.kind === 'assistant' && prev.mid === j.message.id) { prev.text += '\n\n' + b.text; touch(st, prev); }
          else push(st, { id: j.uuid, mid: j.message.id, kind: 'assistant', text: b.text });
        } else if (b.type === 'tool_use') {
          let grp = last(st);
          if (!grp || grp.kind !== 'tools') grp = push(st, { id: `g-${b.id}`, kind: 'tools', tools: [] });
          const tool = { id: b.id, name: b.name, ...toolLabel(b.name, b.input), done: false, isError: false, result: '', images: [] };
          grp.tools.push(tool); st.tools.set(b.id, { item: grp, tool }); touch(st, grp);
        }
      }
    }
  }

  // Codex rollout 한 줄 → 항목. item_completed 이벤트만 보면 사용자·응답·도구가 깔끔하게 나뉜다.
  function codexTool(st, id, tool) {
    let grp = last(st);
    if (!grp || grp.kind !== 'tools') grp = push(st, { id: `g-${id}`, kind: 'tools', tools: [] });
    grp.tools.push({ id, images: [], done: true, isError: false, result: '', ...tool }); touch(st, grp);
  }
  function ingestCodex(st, j) {
    const p = j.payload || {};
    if (j.type === 'turn_context' && p.model && p.model !== st.model) { st.model = p.model; st.rev++; }
    if (j.type !== 'event_msg') return;
    if (p.type === 'thread_settings_applied' && p.thread_settings && p.thread_settings.model && p.thread_settings.model !== st.model) { st.model = p.thread_settings.model; st.rev++; }
    if (p.type === 'token_count' && p.rate_limits) { const l = codexLimits(p.rate_limits); if (l) st.limits = l; }
    if (p.type === 'turn_aborted') { push(st, { id: `abort-${p.turn_id}`, kind: 'event', text: 'Interrupted' }); return; }
    if (p.type !== 'item_completed' || !p.item) return;
    const it = p.item, texts = (c) => (Array.isArray(c) ? c.filter((x) => typeof x.text === 'string').map((x) => x.text).join('\n') : '');
    if (it.type === 'UserMessage') { const t = texts(it.content).trim(); if (t) push(st, { id: it.id, kind: 'user', text: t, images: [], at: '' }); }
    else if (it.type === 'AgentMessage') { const t = texts(it.content).trim(); if (t) push(st, { id: it.id, kind: 'assistant', text: t }); }
    else if (it.type === 'CommandExecution') {
      const cmd = Array.isArray(it.command) ? it.command[it.command.length - 1] : String(it.command || '');
      codexTool(st, it.id, { name: 'Bash', verb: 'Ran', arg: String(cmd).split('\n')[0].slice(0, 160), isError: it.exit_code !== 0 && it.exit_code != null,
        result: String(it.formatted_output || it.aggregated_output || '').slice(0, MAX_RESULT) });
    } else if (it.type === 'FileChange') {
      const files = Object.keys(it.changes || {});
      codexTool(st, it.id, { name: 'Edit', verb: 'Edited', arg: files.map(base).join(', ').slice(0, 160),
        result: files.map((f) => `${f}\n${(it.changes[f] && it.changes[f].unified_diff) || ''}`).join('\n').slice(0, MAX_RESULT) });
    } else if (it.type === 'Extension' && /search/.test(it.kind || '')) {
      codexTool(st, it.id, { name: 'WebSearch', verb: 'Searched the web', arg: String(it.query || '').slice(0, 160) });
    }
  }

  // API: 바뀐 항목만(since=rev). 처음 요청(since=0)은 최근 limit개만 준다 — 긴 세션도 가볍게.
  async function read(target, since, limit = 250) {
    const r = await resolve(target);
    if (!r.file) return { available: false };
    const st = update(r.file, r.kind);
    const items = since > 0 ? st.items.filter((x) => x.rev > since) : st.items.slice(-limit);
    return { available: true, kind: st.kind, session: st.session, title: st.title, model: st.model || '', modelName: st.kind === 'codex' ? codexModelName(st.model) : modelName(st.model), effort: st.effort || '', limits: st.limits || null, cwd: r.cwd, rev: st.rev, reset: since > st.rev, items };
  }
  async function image(target, ref) {
    const r = await resolve(target);
    if (!r.file) return null;
    const m = /^(\d+)\.(\d+)\.([\w-]+)$/.exec(String(ref || '')); if (!m) return null;
    const [off, len] = [Number(m[1]), Number(m[2])];
    if (len > 64 * 1024 * 1024) return null;
    const fd = fs.openSync(r.file, 'r');
    let j; try { const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, off); j = JSON.parse(buf.toString('utf8')); } catch { return null; } finally { fs.closeSync(fd); }
    let node = j; for (const k of m[3].split('-')) { node = node && node[/^\d+$/.test(k) ? Number(k) : k]; }
    const src = node && node.source;
    if (!src || src.type !== 'base64' || !/^image\//.test(src.media_type || '')) return null;
    return { type: src.media_type, data: Buffer.from(src.data, 'base64') };
  }
  return { read, image, resolve };
}

module.exports = { createAgentLog, toolLabel, cleanUser, modelName, codexModelName, codexLimits };
