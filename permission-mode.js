'use strict';
// permission-mode.js — 코딩 에이전트의 권한 모드를 읽고 바꾼다(채팅의 모델 시트 › Permissions).
//
// Claude Code: 아래 상태줄('⏵⏵ auto mode on' 등)이 현재 모드다. Shift+Tab(BTab)을 누를 때마다 다음 모드로 넘어가므로,
//   원하는 모드가 상태줄에 보일 때까지 한 번씩 누르고 매번 화면으로 확인한다. bypass는 --dangerously-skip-permissions로
//   시작한 세션에서만 순환에 들어 있다. 설정 파일은 바뀌지 않는다(그 세션에만 적용).
// Codex: /permissions 메뉴(Ask for approval · Approve for me · Full Access)에서 고르고 'Permissions updated to …'를 확인한다.
//   Full Access는 확인 화면('Enable full access?')이 한 번 더 뜬다. Codex는 이 선택의 일부(approvals_reviewer)를
//   ~/.codex/config.toml에도 저장한다. 현재 모드는 rollout의 turn_context(approval_policy·sandbox·reviewer)로 읽는다.

const { menuRows, assertIdle } = require('./codex-settings.js');

const CLAUDE_MODES = [
  { id: 'manual', label: 'Manual', desc: 'Asks before every edit and command', re: /\bmanual mode on\b/ },
  { id: 'acceptEdits', label: 'Accept edits', desc: 'Edits files without asking; asks before commands', re: /\baccept edits on\b/ },
  { id: 'plan', label: 'Plan', desc: 'Read-only — plans first, changes nothing', re: /\bplan mode on\b/ },
  { id: 'auto', label: 'Auto', desc: 'Asks only when an action looks risky', re: /\bauto mode on\b/ },
  { id: 'bypass', label: 'Bypass permissions', desc: 'Never asks — runs every command', re: /\bbypass permissions on\b/, risky: true },
];
const CODEX_MODES = [
  { id: 'ask', label: 'Ask for approval', desc: 'Works in this folder; asks before the internet or other files' },
  { id: 'auto', label: 'Approve for me', desc: 'Asks only for actions that look unsafe' },
  { id: 'full', label: 'Full Access', desc: 'Any file, network, no approvals', risky: true },
];

function claudeModeOf(screen) {
  // 상태줄은 '⏵⏵ …' 또는 '⏸ …'로 시작한다. 본문에 같은 글자가 있어도 맨 아래 상태줄만 본다
  const line = String(screen || '').split('\n').filter((l) => /^\s*(⏵⏵|⏸)\s/.test(l)).pop() || '';
  const m = CLAUDE_MODES.find((x) => x.re.test(line));
  return m ? m.id : '';
}
// rollout turn_context → Codex 모드
function codexModeOf(tc) {
  if (!tc) return '';
  const sb = tc.sandbox_policy && tc.sandbox_policy.type;
  if (tc.approval_policy === 'never' && sb === 'danger-full-access') return 'full';
  if (tc.approvals_reviewer === 'auto_review') return 'auto';
  return 'ask';
}

async function changeClaude(ctx, mode, startCommand) {
  const target = CLAUDE_MODES.find((m) => m.id === mode);
  if (!target) throw new Error('Unknown permission mode');
  if (mode === 'bypass' && startCommand && !/--dangerously-skip-permissions/.test(startCommand)) throw new Error('Bypass is only available when the session was started with --dangerously-skip-permissions');
  let screen = await ctx.ch.captureScreen();
  const start = claudeModeOf(screen);
  if (!start) throw new Error('Could not read the current permission mode — is a dialog open?');
  if (start === mode) return { ok: true, mode, changed: false };
  // 한 번 누를 때마다 화면이 바뀔 때까지 기다린다. 한 바퀴(최대 6번) 돌아도 없으면 이 세션에선 못 고르는 모드
  let prev = start;
  for (let i = 0; i < 6; i++) {
    await ctx.ch.tmux(['send-keys', '-t', ctx.target, 'BTab']);
    let cur = prev;
    for (let k = 0; k < 10 && cur === prev; k++) { await ctx.ch.delay(120); screen = await ctx.ch.captureScreen(); cur = claudeModeOf(screen) || prev; }
    if (cur === mode) return { ok: true, mode, changed: true };
    if (cur === start && i > 0) break;
    prev = cur;
  }
  throw new Error(`${target.label} is not available in this session`);
}

async function changeCodex(ctx, mode) {
  const target = CODEX_MODES.find((m) => m.id === mode);
  if (!target) throw new Error('Unknown permission mode');
  const key = (...keys) => ctx.ch.tmux(['send-keys', '-t', ctx.target, ...keys]);
  const wait = async (pred, what) => {
    for (let i = 0; i < 20; i++) { const s = await ctx.ch.captureScreen(); if (pred(s)) return s; await ctx.ch.delay(150); }
    throw new Error(`Codex did not ${what} — check the terminal`);
  };
  const choose = async (screen, pred) => {
    const rows = menuRows(screen), from = rows.findIndex((r) => r.selected), to = rows.findIndex((r) => pred(r.label));
    if (from < 0 || to < 0) throw new Error('That option is not in the Codex menu');
    if (to !== from) await key(...Array(Math.abs(to - from)).fill(to > from ? 'Down' : 'Up'));
    await key('Enter');
  };
  const before = await ctx.ch.captureScreen();
  assertIdle(before, 'permissions');
  await key('-l', '/permissions'); await ctx.ch.delay(200); await key('Enter');
  let screen = await wait((s) => /Update Model Permissions/.test(s), 'open its permissions menu');
  await choose(screen, (label) => label.startsWith(target.label));
  if (mode === 'full') {
    screen = await wait((s) => /Enable full access\?/.test(s) || /Permissions updated to/.test(s), 'confirm full access');
    if (/Enable full access\?/.test(screen)) await choose(screen, (label) => /^Yes, continue/.test(label));
  }
  const done = `Permissions updated to ${target.label}`;
  await wait((s) => s.split(done).length > before.split(done).length, 'confirm the change');
  return { ok: true, mode, changed: true };
}

module.exports = { CLAUDE_MODES, CODEX_MODES, claudeModeOf, codexModeOf, changeClaude, changeCodex };
