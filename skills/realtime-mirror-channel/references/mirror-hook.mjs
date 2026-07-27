#!/usr/bin/env node
/* ANA 미러 훅 — Claude 세션의 활동을 ANA 앱 피드로 미러.
 *  UserPromptSubmit: 사용자 입력(로컬/RC/모바일 등) → user 말풍선
 *                    (fakechat=앱 인바운드는 /api/chat이 이미 표시 → 스킵)
 *  PostToolUse: 도구 활동 한 줄(system·activity) + 직전까지의 새 어시스턴트 텍스트
 *  Stop: 마지막 어시스턴트 텍스트 flush + status 클리어
 *  안전장치: 소유권 가드(지정 cwd만) · 턴당 sent 카운트 dedup · 내부(하트비트/크론) 스킵.
 *  ※ 텔레그램·외부 자격증명 없음. APP_TOKEN 은 secrets.env 에서 읽으며 코드에 값이 없다.
 *  항상 exit 0. */
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';

function loadEnv(p) { const e = {}; try { for (const l of readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) e[m[1]] = m[2]; } } catch { } return e; }

/* ── 설정 (환경변수 또는 secrets.env 로 주입 — 아래 기본값만 프로젝트에 맞게 고친다) ───────── */
const SECRETS = process.env.SECRETS_ENV || join(homedir(), '.config/ana/secrets.env');
const ENV = { ...loadEnv(SECRETS), ...process.env };
const APP = ENV.APP_URL || 'http://127.0.0.1:8791';        // ANA 앱 서버
const TOKEN = (ENV.APP_TOKEN || '').trim();                 // 앱 API 토큰 (없으면 무인증)
const APP_ROOT = ENV.APP_ROOT || join(homedir(), 'ana-app');// 앱 정적 루트 (att/ 를 여기 아래에 둔다)
const ATT = ENV.ATT_DIR || join(APP_ROOT, 'att');           // 첨부 이미지 복사 대상 (앱이 /att/ 로 서빙)
const STATE = ENV.MIRROR_STATE || '/tmp/ana_mirror.json';   // 턴당 dedup 상태 파일
const OWN_DIR = new RegExp(ENV.OWN_DIR_RE || 'ana-app(/|$)');// ★ 소유권 가드: 이 cwd 패턴의 세션만 미러
/* ──────────────────────────────────────────────────────────────────────────────────── */

const qs = TOKEN ? ('?token=' + encodeURIComponent(TOKEN)) : '';
const done = () => process.exit(0);

// 프롬프트에서 첨부 이미지(image_path·로컬 @"..png")를 att/로 복사 → 마크다운 이미지 반환
function extractImages(prompt) {
  const paths = new Set();
  for (const m of prompt.matchAll(/image_path="([^"]+)"/g)) paths.add(m[1]);
  for (const m of prompt.matchAll(/@"([^"]+\.(?:png|jpe?g|gif|webp))"/gi)) paths.add(m[1]);
  const md = [];
  let n = 0;
  for (const src of paths) {
    try {
      if (!existsSync(src)) continue;
      mkdirSync(ATT, { recursive: true });
      const ext = (extname(src) || '.png').toLowerCase();
      const name = `${Date.now()}-${n++}${ext}`;
      copyFileSync(src, join(ATT, name));
      md.push(`![](/att/${name})`);
    } catch { }
  }
  return md.join('\n');
}

async function post(path, obj) { try { await fetch(APP + path + qs, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj), signal: AbortSignal.timeout(4000) }); } catch { } }

// 내부(하트비트/아침크론/시스템알림) 턴은 미러 스킵
const isInternal = t => /^\s*(\[하트비트|\[아침 인사|\[정기 업무|\[SYSTEM NOTIFICATION|<task-notification)/.test(t || '') || /date \+%s\s*>\s*.*heartbeat/.test(t || '');

function brief(name, inp) {
  inp = inp || {};
  const f = inp.file_path ? basename(inp.file_path) : '';
  switch (name) {
    case 'Write': return '작성함: ' + f;
    case 'Edit': case 'MultiEdit': return '수정함: ' + f;
    case 'Read': return '읽음: ' + f;
    case 'Bash': return '실행: ' + String(inp.description || inp.command || '').slice(0, 50);
    case 'Grep': return '검색: ' + String(inp.pattern || '').slice(0, 40);
    case 'Glob': return '탐색: ' + String(inp.pattern || '').slice(0, 40);
    case 'Task': case 'Agent': return '에이전트 실행';
    case 'WebFetch': case 'WebSearch': return '웹 조회';
    default: return name || '작업';
  }
}

function turnBlocks(tp) {
  let lines; try { lines = readFileSync(tp, 'utf8').trim().split('\n').map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return null; }
  let start = 0, startText = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = lines[i];
    if (o.type === 'user') { const c = o.message?.content; if (typeof c === 'string') { start = i; startText = c; break; } if (Array.isArray(c) && c.some(x => x.type === 'text')) { start = i; startText = c.find(x => x.type === 'text')?.text || ''; break; } }
  }
  const blocks = [];
  for (let i = start + 1; i < lines.length; i++) { const o = lines[i]; if (o.type === 'assistant' && Array.isArray(o.message?.content)) for (const c of o.message.content) if (c.type === 'text') { const t = (c.text || '').trim(); if (t) blocks.push(t); } }
  return { start, startText, blocks };
}

async function mirrorAssistant(tp) {
  if (!tp) return;
  const tb = turnBlocks(tp); if (!tb) return;
  if (isInternal((tb.startText || '').trim())) return;   // 내부 턴 미러 안 함
  if (!tb.blocks.length) return;
  let state = {}; try { state = JSON.parse(readFileSync(STATE, 'utf8')); } catch { }
  const st = (state[tp] && state[tp].turnStart === tb.start) ? state[tp] : { turnStart: tb.start, sent: 0 };
  if (st.sent >= tb.blocks.length) return;
  for (const b of tb.blocks.slice(st.sent)) await post('/api/activity', { role: 'assistant', kind: 'text', text: b });
  st.sent = tb.blocks.length; st.turnStart = tb.start; state[tp] = st;
  try { writeFileSync(STATE, JSON.stringify(state)); } catch { }
}

let input = ''; process.stdin.on('data', d => input += d);
process.stdin.on('end', async () => {
  try {
    const j = JSON.parse(input || '{}');
    if (j.cwd && !OWN_DIR.test(j.cwd)) return done();                 // 소유권 가드
    const ev = j.hook_event_name || '';

    if (ev === 'UserPromptSubmit') {
      const p = (j.prompt || '').trim();
      if (!p || isInternal(p)) return done();
      await post('/api/status', { text: '처리 중…' });                        // 입력 즉시 '작성 중…' 표시
      if (/source="plugin:fakechat|source="fakechat/.test(p)) return done();  // 앱 인바운드 텍스트는 이미 피드에
      const cm = p.match(/<channel[^>]*>([\s\S]*?)<\/channel>/);              // 채널 래퍼면 내부 텍스트만
      let text = (cm ? cm[1] : p).trim();
      const imgs = extractImages(p);                                         // 첨부 이미지 → att/ 복사 후 마크다운
      if (imgs) text = (text ? text + '\n' : '') + imgs;
      if (text) await post('/api/activity', { role: 'user', kind: 'text', text });
      return done();
    }
    if (ev === 'PostToolUse') {
      const name = j.tool_name || '';
      if (name) { await post('/api/status', { text: brief(name, j.tool_input) }); await post('/api/activity', { role: 'system', kind: 'activity', text: brief(name, j.tool_input) }); }
      await mirrorAssistant(j.transcript_path);
      return done();
    }
    if (ev === 'Stop') {
      await new Promise(r => setTimeout(r, 700));
      await mirrorAssistant(j.transcript_path);
      await post('/api/status', { text: '' });
      return done();
    }
  } catch { }
  done();
});
