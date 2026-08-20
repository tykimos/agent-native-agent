'use strict';
// channel-core.js — tmux 채널 코어 (단일 진실). tmux-mirror-channel과 tmux-dashboard-agent가 공유한다.
// 이 파일은 tmux-mirror-channel/references가 정본이며 sync-core.sh로 대시보드 사본에 복사된다.
// 두 사본의 해시 일치는 테스트(core-sync)가 검증한다 — 한쪽만 고치면 CI가 실패한다.
//
// 제공:
//  · 순수 파서 함수 (displayWidth/stripBottomUI/parseTranscript/extractDraft/detectBusy/inputBoxReady/dialogOpen)
//  · createChannel(opts): 원장·앵커·tmux 헬퍼·폴 루프·주입·가드를 담은 인스턴스
//  · createChannelServer(opts): 채널 라우트(chat/keys/stream/feed/screen/health) + extraApi 훅 + 정적 서빙
//
// 검증 이력(P0 수정 — 6인 검증 하네스 2026-08-19):
//  CR2 갭 마커 src 누락 → 앵커 오염: commit()이 화면 부재 role에 src를 강제
//  CR3 v2.1.x 오버레이 다이얼로그(▔ U+2594) → 원장 복제: 구분선 클래스 확장 + dialogOpen 시 폴 보류
//  CR4 콜드스타트 주입 유실: inputBoxReady 게이트(agentAlive는 보조 신호로 강등)
//  CR5 고스트 draft로 채널 벽돌화: KEYS에 ctrl-u + 409 recoverable 힌트
//  TM-T3 /api/keys copy-mode 무성 소실: keys도 ensureNotInCopyMode
//  T14 injectText: 후행 개행 트림 + Enter 직전 copy-mode 재확인 + 죽은 delete-buffer 정리

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');

// ---------- 순수 파서 (에이전트 프로필: Claude Code TUI v2.1.x) ----------

// 하단 UI 구분선 문자. CR3: v2.1.x 오버레이 다이얼로그가 쓰는 ▔(U+2594) 등 블록 구분선 포함.
const SEP_RE = /^\s*[─━═▔▁▂▃▄▅▆▇█]{4,}/;
const SEP_LINE = (l) => SEP_RE.test(l);
// 열0 전용(선행 공백 없음): parseTranscript 본문 절삭용. 들여쓴 표 테두리·수평선은 continuation으로 보존(R10).
const SEP_COL0 = /^[─━═▔▁▂▃▄▅▆▇█]{4,}/;

// 터미널 표시 폭 (동아시아 전각·이모지=2, ZWJ/VS16/결합문자=0)
function displayWidth(s) {
  let w = 0, afterZwj = false;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 0x200d) { afterZwj = true; continue; }
    if ((c >= 0xfe00 && c <= 0xfe0f) ||
      (c >= 0x0300 && c <= 0x036f) || (c >= 0x1ab0 && c <= 0x1aff) ||
      (c >= 0x1dc0 && c <= 0x1dff) || (c >= 0x20d0 && c <= 0x20ff)) { afterZwj = false; continue; }
    if (afterZwj) { afterZwj = false; continue; }
    w += (c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff))) ? 2 : 1;
  }
  return w;
}

// 화면 하단 입력 박스 + 상태줄 영역을 영역 단위로 절삭(어휘 substring 삭제 금지 — R3 회귀).
// 마지막 두 구분선 사이에 ❯/> 프롬프트가 있어야 입력 박스로 인정(본문 수평선·표 테두리 보존 — R10).
function stripBottomUI(text) {
  const lines = text.split('\n');
  const seps = [];
  for (let i = 0; i < lines.length; i++) if (SEP_LINE(lines[i])) seps.push(i);
  if (seps.length < 2) return text;
  const top = seps[seps.length - 2], bot = seps[seps.length - 1];
  let hasPrompt = false;
  for (let i = top + 1; i < bot; i++) if (/^\s*[❯>]/.test(lines[i].replace(/\u00A0/g, ' '))) { hasPrompt = true; break; }
  if (!hasPrompt) return text;
  return lines.slice(0, top).join('\n');
}

// 접힌 도구 요약(마커 없는 한 줄): v2.1.x가 ⏺/⎿ 없이 "Read 1 file, ran 1 shell command"로 렌더(coding-M1)
const FOLDED_TOOL_RE = /^(Read|Ran|Listed|Searched|Updated|Wrote|Edited|Created|Removed|Fetched|Called) \d+ /;
// 알려진 도구 이름 화이트리스트: ⏺ 뒤 첫 토큰이 이것일 때만 tool 판정(coding-M2 — 본문 정규식 오탐 제거)
const TOOL_NAMES = /^(Read|Edit|Write|Bash|Grep|Glob|Task|WebFetch|WebSearch|Update Todos|NotebookEdit|MultiEdit|TodoWrite|Ls|Search)\b/;

// 에이전트 턴 마커: 구버전은 ⏺(U+23FA), v2.2.x는 ●(U+25CF)로 렌더한다.
// 인식 못 하면 에이전트 줄이 직전 사용자 메시지 본문으로 흡수돼 파란 말풍선에 합쳐진다.
const AGENT_MARK = /^[⏺●]/;
// 캡처 텍스트 → 메시지. "❯ "/"> "=사용자, "⏺"/"●"=에이전트(도구면 tool), "⎿"=도구결과.
function parseTranscript(text, width = 200) {
  const msgs = [];
  let cur = null, prevRaw = '', lastBlank = false;
  const flush = () => {
    if (cur) { cur.text = cur.text.replace(/\s+$/, ''); if (cur.text.trim()) msgs.push(cur); cur = null; }
  };
  for (const raw0 of text.split('\n')) {
    const raw = raw0.replace(/ /g, ' '); // NBSP → 공백 (R1: ❯ 뒤 NBSP로 사용자 턴 소실 방지)
    const line = raw.replace(/\s+$/, '');
    const t = line.trim();
    if (/^[╭╰│┌└┃]/.test(t)) { flush(); continue; }              // 테두리/배너
    if (SEP_COL0.test(line)) { flush(); continue; }                // 열0 구분선(오버레이 ▔). 들여쓴 표테두리는 본문 보존(R10)
    if (/^[✻✽✢✳✶∗]\s/.test(t) && /\bfor\s+\d+/.test(t) && !/\(/.test(t)) { // 완료 마커
      flush(); if (msgs.length) msgs[msgs.length - 1].done = true; continue;
    }
    if (/^[✻✽✢✳✶∗⏵]{1,2}\s/.test(t)) continue;                    // 스피너/작업 상태줄
    // v2.1.x 상태 라인 (● high · /effort). ●는 에이전트 마커이기도 하므로 슬래시 명령으로 끝나는 짧은 줄만 버린다.
    if (/^[●○◉◍]\s[^·]{0,40}·\s*\/[a-z][a-z-]*$/.test(t)) continue;
    if (/^\[[A-Z]{2,4}\]\s|Plugin not found\. Run:/.test(t)) continue; // 플러그인 배너(일반화 — [OMC] 등)
    if (/^Resume this session with:/.test(t)) continue;            // /exit·resume 배너(coding-M4)
    if (/^Tip: /.test(line)) { flush(); continue; }               // 입력 박스 위 팁 배너(v2.x) — 본문은 2칸 들여쓰기라 열0만 해당
    if (/^[❯>]\s+\d+\./.test(t)) continue;                          // 다이얼로그 메뉴 항목
    if (/^[❯>] Try "/.test(t)) continue;                            // placeholder
    if (!t) { if (cur) cur.text += '\n'; lastBlank = true; continue; }
    if (/^[❯>] /.test(line)) { flush(); cur = { role: 'user', text: line.replace(/^[❯>] /, '') }; prevRaw = line; lastBlank = false; continue; }
    if (AGENT_MARK.test(line)) {
      flush();
      const body = line.replace(/^[⏺●]\s*/, '');
      const isTool = TOOL_NAMES.test(body) || FOLDED_TOOL_RE.test(body);
      cur = { role: isTool ? 'tool' : 'assistant', text: body };
      prevRaw = line; lastBlank = false; continue;
    }
    if (/^⎿/.test(t)) { flush(); cur = { role: 'toolresult', text: t.replace(/^⎿\s*/, '') }; prevRaw = line; lastBlank = false; continue; }
    // 마커 없는 접힌 도구 요약(본문 시작 위치) → tool로 승격(coding-M1)
    if (!cur && FOLDED_TOOL_RE.test(t)) { cur = { role: 'tool', text: t }; prevRaw = line; lastBlank = false; continue; }
    if (cur) {
      const content = line.replace(/^ {2}/, '');
      const listy = /^\s*([-*•▸#>$|]|\d+[.)]\s)/.test(content);
      if (!lastBlank && prevRaw && !listy && displayWidth(prevRaw) >= width - 8) {
        const lastTok = (prevRaw.match(/\S+$/) || [''])[0];
        const firstTok = (content.match(/^\S+/) || [''])[0];
        const glue = displayWidth(lastTok) + displayWidth(firstTok) > width - 2
          && /[\x21-\x7e]$/.test(prevRaw) && /^[\x21-\x7e]/.test(content);
        cur.text += (glue ? '' : ' ') + content;
      } else { cur.text += '\n' + content; }
      prevRaw = line; lastBlank = false; continue;
    }
  }
  flush();
  for (let i = 0; i < msgs.length - 1; i++) msgs[i].done = true;
  return msgs;
}

// 하단 입력 박스의 미제출 draft
function extractDraft(screen) {
  const lines = screen.split('\n');
  const seps = [];
  lines.forEach((l, i) => { if (SEP_LINE(l)) seps.push(i); });
  if (seps.length < 2) return '';
  const [a, b] = [seps[seps.length - 2], seps[seps.length - 1]];
  if (b - a < 1) return '';
  const region = lines.slice(a + 1, b).map((l) => l.replace(/\u00A0/g, ' ').replace(/\s+$/, ''));
  if (!/^[❯>]/.test((region[0] || '').trim())) return '';
  let draft = region[0].trim().replace(/^[❯>] ?/, '');
  for (let i = 1; i < region.length; i++) draft += (draft && region[i].trim() ? ' ' : '') + region[i].trim();
  draft = draft.trim();
  if (/^Try "/.test(draft) || /^\d+\./.test(draft)) return '';
  // 큐잉/시스템 안내(remote-C1): busy 중 큐에 쌓이면 입력창 영역에 안내가 뜬다 — 실제 draft 아님.
  if (/^Press (up|↑) to edit|queued messages?$|^esc to (clear|interrupt)/i.test(draft)) return '';
  return draft;
}

// 입력 박스 준비 여부(CR4 콜드스타트 게이트): 구분선 2개 + 사이에 ❯ 프롬프트 + 다이얼로그 메뉴 아님
function inputBoxReady(screen) {
  const lines = screen.split('\n');
  const seps = [];
  for (let i = 0; i < lines.length; i++) if (SEP_LINE(lines[i])) seps.push(i);
  if (seps.length < 2) return false;
  const top = seps[seps.length - 2], bot = seps[seps.length - 1];
  for (let i = top + 1; i < bot; i++) {
    const t = lines[i].replace(/\u00A0/g, ' ').trim();
    if (/^[❯>]\s+\d+\./.test(t)) return false;   // 다이얼로그 메뉴
    if (/^[❯>]/.test(t)) return true;
  }
  return false;
}

// 오버레이 다이얼로그가 열려 있는가(CR3·coding-M8): ▔ 구분선 / Esc to cancel / ❯ 1. 메뉴 / 신뢰 프롬프트
function dialogOpen(screen) {
  for (const raw of screen.split('\n')) {
    const t = raw.trim();
    if (/Esc to cancel|to confirm ·|trust this folder|Select (a |model|the )/i.test(t)) return true;
    if (/^([▔▁▂▃▄▅▆▇█])\1{11,}$/.test(t)) return true;   // 수평 오버레이 구분선(단일 블록 문자 12+ 반복). welcome 로고 제외
    if (/^[❯>]\s+\d+\.\s/.test(t.replace(/\u00A0/g, ' '))) return true;
  }
  return false;
}

// busy 판정: 하단 상태줄/스피너에서만(본문 어휘로 고착 방지 — R5)
function detectBusy(screen) {
  for (const raw of screen.split('\n')) {
    const t = raw.trim();
    if (/^[❯>]/.test(t)) continue;
    if (/esc to interrupt|ctrl\+c to stop/i.test(t)) return true;
    if (/^[✻✽✢✳✶∗]\s.*\(\d+m?\s?\d*s\b/.test(t)) return true;
  }
  return false;
}

const strip = (s) => s.replace(/\s+/g, '');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// ---------- 원자적 JSON 쓰기 (CR6: 손상 시 조용한 전량 소실 방지) ----------
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(obj, null, 2));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
// 파일이 존재하는데 파싱 실패면 백업 후 throw(catch-all 기본값 반환 금지 — CR6). 부재면 fallback.
function readJsonStrict(file, fallback) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return fallback(); }
  try { return JSON.parse(raw); }
  catch (e) {
    const bak = `${file}.corrupt-${Date.now()}`;
    try { fs.copyFileSync(file, bak); } catch {}
    throw new Error(`손상된 상태 파일 ${file} — 백업: ${bak} (${e.message})`);
  }
}

// ---------- 채널 인스턴스 ----------
function createChannel(opts) {
  const {
    ROOT, SESSION, SOCKET, HISTORY_LINES = 10000, POLL_MS = 300, FEED_FILE,
  } = opts;
  // 런타임 변경 가능한 타깃 — 서버를 먼저 띄운 뒤 설정 페이지(/api/config)에서 세션/팬을 지정하면
  // 재시작 없이 즉시 이 값이 바뀌고 다음 폴부터 그 세션을 미러링한다.
  let TARGET = opts.TARGET;
  const getTarget = () => TARGET;
  const setTarget = (t) => { TARGET = t; };

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const hash = (s) => crypto.createHash('sha1').update(s).digest('hex');

  function tmux(args, input) {
    const full = SOCKET ? ['-L', SOCKET, ...args] : args;
    return new Promise((resolve, reject) => {
      const p = execFile('tmux', full, { maxBuffer: 16 * 1024 * 1024, timeout: 5000 },
        (e, out, err) => (e ? reject(new Error((err || e.message).trim())) : resolve(out)));
      if (input !== undefined) { p.stdin.write(input); p.stdin.end(); }
    });
  }
  async function paneInMode() {
    try { return (await tmux(['display-message', '-p', '-t', TARGET, '#{pane_in_mode}'])).trim() === '1'; }
    catch { return false; }
  }
  async function ensureNotInCopyMode() {
    try { if (await paneInMode()) await tmux(['send-keys', '-t', TARGET, '-X', 'cancel']); } catch {}
  }
  async function hasSession() {
    try { await tmux(['has-session', '-t', TARGET]); return true; } catch { return false; }
  }
  // 셸이면 에이전트 종료(주입 시 셸 명령 실행 위험) → 거부. 보조 신호(CR4에서 inputBoxReady가 주 게이트).
  async function agentAlive() {
    try {
      const cmd = (await tmux(['display-message', '-p', '-t', TARGET, '#{pane_current_command}'])).trim();
      return !/^-?(zsh|bash|sh|fish|dash|ksh|tcsh|csh|login)$/.test(cmd);
    } catch { return false; }
  }
  const captureHistory = () => tmux(['capture-pane', '-p', '-t', TARGET, '-S', `-${HISTORY_LINES}`]);
  const captureScreen = () => tmux(['capture-pane', '-p', '-t', TARGET]);

  // ---- 대화 원장 ----
  // 원장 파일의 디렉터리를 보장(TRANSCRIPT_FILE을 ./.ana/ 등 하위 경로로 지정 시 append ENOENT 방지)
  try { fs.mkdirSync(path.dirname(FEED_FILE), { recursive: true }); } catch {}
  const feed = [];
  try {
    let dropped = 0;
    for (const l of fs.readFileSync(FEED_FILE, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      let m = null; try { m = JSON.parse(l); } catch { dropped++; continue; }
      if (m && typeof m === 'object' && Number.isInteger(m.seq) && typeof m.text === 'string') feed.push(m);
      else dropped++;
    }
    if (dropped) console.error(`[ana] 원장 복원 경고: 손상/무효 ${dropped}줄 건너뜀 (${FEED_FILE})`);
    console.log(`원장 복원: ${feed.length}개 메시지 (${FEED_FILE})`);
  } catch {}

  function nextSeq() {
    let max = 0;
    for (const m of feed) if (Number.isInteger(m.seq) && m.seq > max) max = m.seq;
    return Math.max(max, feed.length) + 1;
  }
  // 화면에 렌더되는 role: 이외(marker/proposal/system 등 서버 생성)는 src 필수(CR2 불변식).
  const SCREEN_ROLES = new Set(['user', 'assistant', 'tool', 'toolresult']);
  function commit(m) {
    if (!SCREEN_ROLES.has(m.role) && !m.src) m.src = 'api'; // CR2: 화면 부재 항목은 강제로 api 출처
    const entry = { seq: nextSeq(), role: m.role, text: m.text, at: new Date().toISOString() };
    if (m.src) entry.src = m.src;
    if (m.pid) entry.pid = m.pid;
    fs.appendFileSync(FEED_FILE, JSON.stringify(entry) + '\n');
    feed.push(entry);
    return entry;
  }

  const _skeyCache = new WeakMap();
  function skey(mm) { let v = _skeyCache.get(mm); if (v === undefined) { v = strip(mm.text); _skeyCache.set(mm, v); } return v; }
  const same = (a, b) => a.role === b.role && skey(a) === skey(b);
  const sameOrGrown = (c, p) => c.role === p.role && (skey(c) === skey(p) || skey(p).startsWith(skey(c)));
  const screenFeed = () => feed.filter((m) => !m.src); // 앵커·중복 판정은 화면 유래만

  function matchesRunInFeed(seq) {
    const sf = screenFeed();
    for (let p = sf.length - seq.length; p >= 0; p--) {
      let ok = true;
      for (let i = 0; i < seq.length; i++) if (!same(sf[p + i], seq[i])) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }
  function anchorIndex(parsed) {
    const sf = screenFeed();
    if (!sf.length) return 0;
    for (let runLen = Math.min(5, sf.length); runLen >= 1; runLen--) {
      const run = sf.slice(-runLen);
      for (let p = parsed.length - runLen; p >= 0; p--) {
        let ok = true;
        for (let i = 0; i < runLen; i++) {
          const cmp = i === runLen - 1 ? sameOrGrown : same;
          if (!cmp(run[i], parsed[p + i])) { ok = false; break; }
        }
        if (ok) return p + runLen;
      }
    }
    return -1;
  }

  // ---- 주입 ----
  // clearFirst(force): 주입 전 입력창을 Ctrl-u로 비운다. capture-pane -p가 SGR을 버려 흐린 히스토리
  // 자동제안(고스트)을 실제 draft와 구분 못 하는 오탐(remote-C1)을, 사용자가 "무시하고 넣기"로 우회할 때 쓴다.
  async function injectText(text, submit = true, clearFirst = false) {
    await ensureNotInCopyMode();
    if (clearFirst) { try { await tmux(['send-keys', '-t', TARGET, 'C-u']); } catch {} } // 입력창 라인 클리어
    const body = text.replace(/\s+$/, ''); // T14: 후행 개행 트림(조기 제출·중복 Enter 방지)
    const buf = `ana-chat-${crypto.randomUUID()}`;
    await tmux(['load-buffer', '-b', buf, '-'], body);
    await tmux(['paste-buffer', '-p', '-d', '-b', buf, '-t', TARGET]); // -d가 버퍼 삭제(delete-buffer 불필요)
    if (submit) {
      await delay(150);
      await ensureNotInCopyMode(); // T14: Enter 직전 재확인(그사이 copy-mode 진입 방지)
      await tmux(['send-keys', '-t', TARGET, 'Enter']);
    }
  }

  return {
    tmux, delay, hash, paneInMode, ensureNotInCopyMode, hasSession, agentAlive,
    captureHistory, captureScreen, feed, nextSeq, commit, same, sameOrGrown,
    screenFeed, matchesRunInFeed, anchorIndex, injectText, getTarget, setTarget,
  };
}

// ---------- TUI 제어 특수키 (null-proto: 프로토타입 오염 차단) ----------
// CR5: ctrl-u/ctrl-k(라인 클리어) 추가 — 고스트 draft 벽돌 상태를 웹에서 복구
const KEYS = Object.assign(Object.create(null), {
  enter: 'Enter', esc: 'Escape', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  tab: 'Tab', btab: 'BTab', 'ctrl-c': 'C-c', 'ctrl-o': 'C-o', 'ctrl-r': 'C-r', 'ctrl-u': 'C-u', 'ctrl-k': 'C-k',
  1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
});

// ---------- HTTP 유틸 ----------
function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req, cap = 2e6) {
  return new Promise((resolve, reject) => {
    let d = '', bytes = 0, done = false;
    req.on('data', (c) => {
      if (done) return;
      bytes += Buffer.byteLength(c);
      if (bytes > cap) { done = true; reject(Object.assign(new Error('too large'), { tooLarge: true })); return; }
      d += c;
    });
    req.on('end', () => { if (!done) resolve(d); });
    req.on('error', (e) => { if (!done) reject(e); });
  });
}
// 상태 변경 POST 방어(CSRF): json content-type 강제 + Origin 동일 출처. 로컬 curl(Origin 없음)은 통과.
function csrfOk(req) {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (!ct.startsWith('application/json')) return false;
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return false; } catch { return false; } }
  const sfs = req.headers['sec-fetch-site'];
  if (sfs && sfs !== 'same-origin' && sfs !== 'none') return false;
  return true;
}
// JSON 본문 파싱 + 검증(QA-C7·M1: null/원시값/배열 거부). 실패 시 응답을 쓰고 null 반환.
async function jsonBody(req, res, cap = 2e6) {
  let raw;
  try { raw = await readBody(req, cap); }
  catch (e) { sendJson(res, e && e.tooLarge ? 413 : 400, { error: e && e.tooLarge ? 'too large' : 'read error' }); return null; }
  let body;
  try { body = raw ? JSON.parse(raw) : {}; }
  catch { sendJson(res, 400, { error: 'invalid json' }); return null; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) { sendJson(res, 400, { error: 'body must be a JSON object' }); return null; }
  return body;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

// ---------- 채널 서버 빌더 ----------
// opts: { PORT, BIND, SESSION, SOCKET, TARGET, HISTORY_LINES, MAX_TEXT, POLL_MS, FEED_FILE, ROOT,
//         SERVABLE(Set), defaultDoc, readyGuard, extraApi(req,res,url,ctx)->bool|Promise<bool>,
//         snapshotExtra()->obj, testMode }
function createChannelServer(opts) {
  const {
    PORT, BIND, SESSION, MAX_TEXT = 8000, POLL_MS = 300, ROOT,
    SERVABLE, defaultDoc, readyGuard = true, extraApi, snapshotExtra,
    autoConfigPane = true,
    READY_TIMEOUT = Number(process.env.ANA_READY_TIMEOUT || 5000),
  } = opts;
  const ch = createChannel(opts);
  // 타깃 팬에 연결되면 필수 tmux 옵션을 자동 적용(한 번, 멱등) — 별도 실행 스크립트가 필요 없다.
  // alternate-screen off = alt 화면이면 스크롤백이 안 쌓여 긴 응답이 유실되는 것을 막는다.
  // window-size manual = 클라이언트 attach 시 팬 폭이 줄어 리와핑으로 원장이 중복되는 것을 막는다.
  let paneConfigured = false;
  async function configurePane() {
    if (paneConfigured || !autoConfigPane) return;
    const t = ch.getTarget();
    try {
      await ch.tmux(['set-window-option', '-t', t, 'alternate-screen', 'off']);
      await ch.tmux(['set-window-option', '-t', t, 'window-size', 'manual']).catch(() => {});
      paneConfigured = true;
    } catch {}
  }
  const { feed, commit, injectText, hasSession, agentAlive, captureHistory, captureScreen,
    tmux, ensureNotInCopyMode, anchorIndex, matchesRunInFeed, same, screenFeed, getTarget, setTarget } = ch;

  // ---- SSE ----
  const clients = new Set();
  function broadcast(obj) {
    const data = `data: ${JSON.stringify(obj)}\n\n`;
    for (const res of clients) {
      if (res.writableEnded || res.destroyed) { clients.delete(res); continue; }
      try { res.write(data); } catch { clients.delete(res); }
    }
  }

  // ---- 폴 상태 ----
  let pending = [], lastFreshSig = '', stableCount = 0;
  let lastSession = null, lastBusy = null, lastScreen = '', lastScreenHash = '', lastSpin = '';
  let idleStreak = 0, shrinkStreak = 0, lastDraft = '', lastReady = false, everReady = false;
  let warnedAnchorLoss = false, anchorLossPolls = 0, lastResync = false, lastDialog = false, warnedNoReady = false;
  const ANCHOR_LOSS_LIMIT = 6;

  async function pollOnce() {
    const alive = await hasSession();
    if (alive) configurePane(); else paneConfigured = false; // 재연결 시 다시 적용
    let history = '', screen = '', busy = false, paneWidth = 200;
    if (alive) {
      [history, screen, paneWidth] = await Promise.all([
        captureHistory(), captureScreen(),
        tmux(['display-message', '-p', '-t', getTarget(), '#{pane_width}']).then((s) => Number(s.trim()) || 200),
      ]);
      const busyRaw = detectBusy(screen);
      if (busyRaw) idleStreak = 0; else idleStreak++;
      busy = busyRaw || (lastBusy === true && idleStreak < 3);
    }

    let spin = '';
    if (busy) {
      const m = screen.match(/^\s*[✻✽✢✳✶·∗]\s+(\S.*\(\d+[^\n]*)$/m);
      spin = m ? m[1].replace(/\s+$/, '') : lastSpin;
    }
    if (alive !== lastSession || busy !== lastBusy || spin !== lastSpin) {
      lastSession = alive; lastBusy = busy; lastSpin = spin;
      broadcast({ kind: 'status', session: alive, busy, spin });
    }
    const sh = ch.hash(screen);
    if (sh !== lastScreenHash) { lastScreenHash = sh; lastScreen = screen; broadcast({ kind: 'screen', screen }); }
    const draft = alive ? extractDraft(screen) : '';
    if (draft !== lastDraft) { lastDraft = draft; broadcast({ kind: 'draft', draft }); }
    const ready = alive ? inputBoxReady(screen) : false;
    lastReady = ready;
    if (ready) everReady = true; // TUI 에이전트 확정 → 준비 게이트 활성

    if (!alive) {
      if (pending.length) { pending = []; broadcast({ kind: 'pending', pending }); }
      idleStreak = 0; stableCount = 0; lastFreshSig = '';
      return;
    }

    // CR3: 오버레이 다이얼로그가 열려 있으면 파싱·확정을 보류(캡처가 원장을 오염시키지 못하게)
    const dialog = dialogOpen(screen);
    if (dialog !== lastDialog) { lastDialog = dialog; broadcast({ kind: 'status', session: alive, busy, spin: lastSpin, dialog }); }
    if (dialog) { stableCount = 0; lastFreshSig = ''; return; }

    const parsed = parseTranscript(stripBottomUI(history), paneWidth);
    const anchor = anchorIndex(parsed);
    if (anchor === -1 && screenFeed().length && parsed.length && !matchesRunInFeed(parsed.slice(-1))) {
      anchorLossPolls++;
      if (anchorLossPolls < ANCHOR_LOSS_LIMIT) {
        if (!warnedAnchorLoss) { console.error('[ana] 앵커 소실 — 재동기화 대기(오버레이/세션 교체/스크롤백 이탈 가능).'); warnedAnchorLoss = true; }
        if (!lastResync) { lastResync = true; broadcast({ kind: 'status', session: alive, busy, spin: lastSpin, resync: true }); }
        return;
      }
      // 임계 초과: 갭 마커(src:'api' 강제됨) 후 재개. 전량 재확정 대신, 부분 일치가 없을 때만 신규 취급.
      if (feed.length && feed[feed.length - 1].role !== 'marker') {
        const mk = commit({ role: 'marker', text: '⋯ 이전 기록과 연결이 끊겼습니다 (세션 교체 또는 스크롤백 이탈)' });
        broadcast({ kind: 'commit', messages: [mk] });
      }
    }
    warnedAnchorLoss = false; anchorLossPolls = 0;
    if (lastResync) { lastResync = false; broadcast({ kind: 'status', session: alive, busy, spin: lastSpin, resync: false }); }

    let fresh = parsed.slice(anchor === -1 ? 0 : anchor);
    if (fresh.length >= 2 && matchesRunInFeed(fresh)) fresh = [];
    const committed = [];
    const freshSig = JSON.stringify(fresh);
    if (freshSig === lastFreshSig) stableCount++; else stableCount = 0;
    lastFreshSig = freshSig;
    if (!busy && stableCount >= 2 && fresh.length) {
      const toCommit = [...fresh];
      let held = [];
      const last = toCommit[toCommit.length - 1];
      if (last.role === 'user' || !last.done) held = [toCommit.pop()];
      const sf = screenFeed();
      let overlap = 0;
      for (let k = Math.min(toCommit.length, sf.length); k >= 1; k--) {
        let ok = true;
        for (let i = 0; i < k; i++) if (!same(sf[sf.length - k + i], toCommit[i])) { ok = false; break; }
        if (ok) { overlap = k; break; }
      }
      toCommit.splice(0, overlap);
      for (const m of toCommit) committed.push(commit(m));
      if (toCommit.length) { fresh = held; stableCount = 0; lastFreshSig = JSON.stringify(fresh); }
    }
    let display = fresh;
    if (!committed.length && fresh.length < pending.length) { shrinkStreak++; if (shrinkStreak < 2) display = pending; } else shrinkStreak = 0;
    if (lastDraft && display.length && display[display.length - 1].role === 'user'
      && norm(display[display.length - 1].text) === norm(lastDraft)) display = display.slice(0, -1);
    const pendingChanged = JSON.stringify(display) !== JSON.stringify(pending);
    pending = display;
    if (committed.length) broadcast({ kind: 'commit', messages: committed });
    if (pendingChanged || committed.length) broadcast({ kind: 'pending', pending });
  }

  let polling = false;
  if (!opts.testMode) {
    setInterval(async () => { if (polling) return; polling = true; try { await pollOnce(); } catch (e) { console.error('[ana] poll 오류:', e.message); } polling = false; }, POLL_MS);
    setInterval(() => broadcast({ kind: 'ping' }), 15000);
  }

  // ---- 주입 직렬화 큐 ----
  let chatQueue = Promise.resolve();
  const enqueue = (fn) => (chatQueue = chatQueue.catch(() => {}).then(fn));

  // 입력 박스 준비 대기(CR4): 요청 시점 캡처로 유한 대기. readyGuard=false면 스킵.
  // 다이얼로그는 항상 차단(Enter가 메뉴 확정 — CR3/T5). 타임아웃 시: TUI 에이전트(everReady)면 차단(콜드스타트),
  // 입력 박스를 한 번도 못 본 비-TUI/라인버퍼 에이전트면 통과(영구 차단 방지 — terminal-T4 안전장치).
  async function waitInputReady() {
    if (!readyGuard) return true;
    const t0 = Date.now();
    for (;;) {
      let screen; try { screen = await captureScreen(); } catch { return true; }
      if (dialogOpen(screen)) { if (Date.now() - t0 > READY_TIMEOUT) return false; }
      else if (inputBoxReady(screen)) return true;
      else if (Date.now() - t0 > READY_TIMEOUT) {
        if (everReady) return false;
        if (!warnedNoReady) { console.error('[ana] 입력 박스 미감지 — 비-TUI 에이전트로 간주하고 준비 게이트 비활성.'); warnedNoReady = true; }
        return true;
      }
      await ch.delay(150);
    }
  }

  // ---- 정적 서빙 ----
  // 페이지 빌드 식별자 — 브라우저가 자기 로드 시점 값과 비교해 '옛 페이지'인지 스스로 안다.
  // (수정이 반영 안 된 것처럼 보이는 혼동을 없애기 위한 것 — 캐시 무효화가 아니라 표시 목적)
  function buildId() {
    try {
      const st = fs.statSync(path.join(ROOT, defaultDoc));
      return crypto.createHash('sha1').update(`${st.mtimeMs}:${st.size}`).digest('hex').slice(0, 8);
    } catch { return 'unknown'; }
  }

  function serveStatic(res, urlPath) {
    const rel = urlPath === '/' ? defaultDoc : urlPath.replace(/^\/+/, '');
    if (!SERVABLE.has(rel)) return sendJson(res, 404, { error: 'not found' });
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return sendJson(res, 404, { error: 'not found' });
    // no-cache: 캐시는 하되 매 요청 재검증. 없으면 Safari가 휴리스틱으로 옛 HTML을 재사용해
    // 수정이 반영 안 된 것처럼 보인다(모바일에서 실제로 겪음).
    res.writeHead(200, {
      'content-type': MIME[path.extname(abs)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    fs.createReadStream(abs).pipe(res);
  }

  // 대시보드/스튜디오 라우트가 쓸 컨텍스트
  const ctx = {
    ch, commit, broadcast, feed, injectText, hasSession, agentAlive, csrfOk, jsonBody, sendJson,
    MAX_TEXT, enqueue, waitInputReady, get lastDraft() { return lastDraft; }, get lastReady() { return lastReady; },
    KEYS, writeJsonAtomic, readJsonStrict, screenFeed,
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;
    try {
      if (p === '/api/health') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        const alive = await hasSession();
        let command = null, size = null;
        if (alive) {
          command = (await tmux(['display-message', '-p', '-t', getTarget(), '#{pane_current_command}'])).trim();
          size = (await tmux(['display-message', '-p', '-t', getTarget(), '#{pane_width}x#{pane_height}'])).trim();
        }
        const base = { server: true, session: alive, name: SESSION, target: getTarget(), command, size, ready: lastReady, dialog: lastDialog, messages: feed.length, busy: lastBusy, build: buildId() };
        return sendJson(res, 200, snapshotExtra ? { ...base, ...snapshotExtra() } : base);
      }

      // 런타임 tmux 타깃 설정 — 서버를 먼저 띄우고 설정 페이지에서 세션을 지정해 재시작 없이 연결.
      if (p === '/api/config' && req.method === 'GET') {
        let sessions = [];
        try {
          const out = await tmux(['list-sessions', '-F', '#{session_name}\t#{session_windows}\t#{?session_attached,attached,}']);
          sessions = out.trim().split('\n').filter(Boolean).map((l) => { const [name, windows, attached] = l.split('\t'); return { name, windows: Number(windows) || 1, attached: !!attached }; });
        } catch {}
        // 각 세션의 활성 팬 명령(에이전트/셸 구분용)도 함께
        for (const s of sessions) {
          try { s.command = (await tmux(['display-message', '-p', '-t', s.name, '#{pane_current_command}'])).trim(); } catch {}
        }
        return sendJson(res, 200, { target: getTarget(), session: SESSION, sessions });
      }
      if (p === '/api/config' && req.method === 'POST') {
        if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' });
        const body = await jsonBody(req, res); if (!body) return;
        const t = body.target;
        // 세션 이름 또는 팬 id(%N)만 허용
        if (typeof t !== 'string' || !/^(%\d+|[A-Za-z0-9_.:-]{1,64})$/.test(t)) return sendJson(res, 400, { error: 'invalid target (세션 이름 또는 %pane-id)' });
        setTarget(t);
        // 즉시 존재 여부 확인해 응답에 담는다(사용자가 바로 연결 성공/실패를 안다)
        let ok = false;
        try { await tmux(['has-session', '-t', t]); ok = true; } catch {}
        return sendJson(res, 200, { ok: true, target: t, connected: ok });
      }

      // 채널 라우트: chat
      if (p === '/api/chat' && req.method === 'POST') {
        if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' });
        const body = await jsonBody(req, res); if (!body) return;
        const { text } = body;
        const submit = body.submit === undefined ? true : body.submit === true;
        const force = body.force === true; // draft 가드 우회 + 입력창 비우고 주입(remote-C1 오탐 회피)
        if (typeof text !== 'string' || !text.trim()) return sendJson(res, 400, { error: 'text must be a non-empty string' });
        if (Buffer.byteLength(text) > MAX_TEXT) return sendJson(res, 413, { error: `text too long (>${MAX_TEXT} bytes)` });
        if (typeof body.submit !== 'undefined' && typeof body.submit !== 'boolean') return sendJson(res, 400, { error: 'submit must be boolean' });
        if (!(await hasSession())) return sendJson(res, 409, { error: `tmux 타깃 '${getTarget()}' 없음 — 설정에서 세션을 지정하거나 tmux를 기동하세요` });
        if (!(await agentAlive())) return sendJson(res, 409, { error: `에이전트가 실행 중이 아닙니다(셸 상태) — tmux 세션 '${getTarget()}'에서 코딩 에이전트(claude 등)를 다시 실행하세요` });
        if (lastDraft && !force) return sendJson(res, 409, { error: '터미널 입력창에 작성 중인 내용이 있습니다 — 비운 뒤 다시 시도하세요', recoverable: 'ctrl-u' });
        if (!(await waitInputReady())) return sendJson(res, 409, { error: '에이전트 입력창이 준비되지 않았습니다(기동 중이거나 다이얼로그 대기 중) — 터미널을 확인하세요' });
        await enqueue(() => injectText(text, submit, force)); // force면 주입 전 Ctrl-u로 입력창 비움
        return sendJson(res, 200, { ok: true });
      }

      // 채널 라우트: keys (TM-T3: copy-mode 해제 포함)
      if (p === '/api/keys' && req.method === 'POST') {
        if (!csrfOk(req)) return sendJson(res, 403, { error: 'forbidden (origin/content-type)' });
        const body = await jsonBody(req, res); if (!body) return;
        const key = body.key;
        if (typeof key !== 'string' || !Object.hasOwn(KEYS, key)) return sendJson(res, 400, { error: `unsupported key: ${key}` });
        if (!(await hasSession())) return sendJson(res, 409, { error: `tmux 세션 '${SESSION}' 없음` });
        await enqueue(async () => { await ensureNotInCopyMode(); await tmux(['send-keys', '-t', getTarget(), KEYS[key]]); });
        return sendJson(res, 200, { ok: true });
      }

      // 대시보드/스튜디오 확장 라우트
      if (extraApi) { const handled = await extraApi(req, res, url, ctx); if (handled) return; }

      // 채널 라우트: stream
      if (p === '/api/stream') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        const since = Number(url.searchParams.get('since'));
        const msgs = Number.isFinite(since) && since > 0 ? feed.filter((m) => m.seq > since) : feed;
        const snap = { kind: 'snapshot', session: lastSession ?? false, busy: lastBusy ?? false, spin: lastSpin, screen: lastScreen, messages: msgs, total: feed.length, pending, draft: lastDraft, ready: lastReady, dialog: lastDialog };
        res.write(`data: ${JSON.stringify(snapshotExtra ? { ...snap, ...snapshotExtra() } : snap)}\n\n`);
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }

      // 채널 라우트: feed
      if (p === '/api/feed') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        const sinceRaw = url.searchParams.get('since');
        const since = sinceRaw == null ? 0 : Number(sinceRaw);
        if (!Number.isFinite(since)) return sendJson(res, 400, { error: 'since must be a number' });
        const base = { items: feed.filter((m) => m.seq > since), pending, total: feed.length };
        return sendJson(res, 200, snapshotExtra ? { ...base, ...snapshotExtra() } : base);
      }

      // 채널 라우트: screen (진단)
      if (p === '/api/screen') {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        if (!(await hasSession())) return sendJson(res, 200, { session: false, history: '', screen: '' });
        const [history, screen] = await Promise.all([captureHistory(), captureScreen()]);
        return sendJson(res, 200, { session: true, history, screen });
      }

      if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(res, p);
      return sendJson(res, 405, { error: 'method not allowed' });
    } catch (e) {
      console.error('[ana] 요청 처리 오류:', e && e.message);
      sendJson(res, 500, { error: 'internal' });
    }
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') { console.error(`[ana] 포트 ${PORT} 이미 사용 중 — 다른 인스턴스가 실행 중일 수 있습니다.`); process.exit(1); }
    throw e;
  });

  return { server, ch, ctx, broadcast, pollOnce, listen: (cb) => server.listen(PORT, BIND, cb) };
}

// 기본 pane 타깃 해석(공유): ANA_PANE_ID > .ana_pane_id 파일(검증) > 세션명
// 기본 세션명은 README의 퀵스타트(`tmux new -s ana`)와 일치해야 한다. 다른 세션·팬을 쓰려면
// TMUX_SESSION/ANA_PANE_ID 또는 설정 페이지(/api/config)에서 지정한다.
function resolveTarget(ROOT, env) {
  if (env.ANA_PANE_ID) return env.ANA_PANE_ID;
  if (!env.TMUX_SESSION) {
    try {
      const id = fs.readFileSync(path.join(ROOT, '.ana_pane_id'), 'utf8').trim();
      if (/^%\d+$/.test(id)) return id;
    } catch {}
  }
  return env.TMUX_SESSION || 'ana';
}

module.exports = {
  // 순수 함수
  displayWidth, stripBottomUI, parseTranscript, extractDraft, detectBusy, inputBoxReady, dialogOpen, strip, norm,
  writeJsonAtomic, readJsonStrict,
  // 팩토리
  createChannel, createChannelServer, resolveTarget,
  // 유틸
  KEYS, csrfOk, sendJson, readBody, jsonBody, MIME, SEP_RE,
};
