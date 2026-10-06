const { test } = require('node:test');
const assert = require('node:assert/strict');
const { claudeModeOf, codexModeOf, changeClaude, changeCodex } = require('./permission-mode');

const status = (t) => `⏺ reply that mentions plan mode on and bypass permissions on\n──────\n❯ \n──────\n  ${t} · ← for agents`;
function fixture(screens, { onKey } = {}) {
  const calls = []; let i = 0;
  const ctx = { target: 'test', ch: {
    captureScreen: async () => screens[Math.min(i, screens.length - 1)],
    delay: async () => {},
    tmux: async (args) => { calls.push(args); if (onKey) onKey(args); else i++; },
  } };
  return { calls, ctx, step: () => i++ };
}

test('reads the Claude mode from the status line only, not from the reply text', () => {
  assert.equal(claudeModeOf(status('⏵⏵ auto mode on (shift+tab to cycle)')), 'auto');
  assert.equal(claudeModeOf(status('⏸ manual mode on · ? for shortcuts')), 'manual');
  assert.equal(claudeModeOf(status('⏵⏵ accept edits on (shift+tab to cycle)')), 'acceptEdits');
  assert.equal(claudeModeOf(['plan mode on', ...Array(10).fill('text')].join('\n')), '');
  assert.equal(claudeModeOf('⏺ we discussed plan mode on earlier\n  ⏵⏵ auto mode on (shift+tab to cycle)'), 'auto');
});

test('reads the Codex mode from turn_context', () => {
  assert.equal(codexModeOf({ approval_policy: 'never', sandbox_policy: { type: 'danger-full-access' } }), 'full');
  assert.equal(codexModeOf({ approval_policy: 'on-request', approvals_reviewer: 'auto_review', sandbox_policy: { type: 'workspace-write' } }), 'auto');
  assert.equal(codexModeOf({ approval_policy: 'on-request', approvals_reviewer: 'user', sandbox_policy: { type: 'workspace-write' } }), 'ask');
  assert.equal(codexModeOf(null), '');
});

test('Claude: presses Shift+Tab until the status line shows the wanted mode', async () => {
  const cycle = ['⏵⏵ bypass permissions on', '⏵⏵ auto mode on', '⏸ manual mode on', '⏵⏵ accept edits on', '⏸ plan mode on'].map(status);
  const f = fixture(cycle);
  const out = await changeClaude(f.ctx, 'acceptEdits', 'claude --dangerously-skip-permissions');
  assert.equal(out.mode, 'acceptEdits');
  assert.equal(f.calls.filter((c) => c.includes('BTab')).length, 3);
});

test('Claude: a mode that is not in the cycle fails after one lap, and bypass needs the start flag', async () => {
  const cycle = ['⏵⏵ auto mode on', '⏸ manual mode on', '⏵⏵ accept edits on', '⏸ plan mode on'].map(status);
  let k = 0; const f = fixture([], { onKey: () => { k++; } });
  f.ctx.ch.captureScreen = async () => cycle[k % cycle.length];
  await assert.rejects(changeClaude(f.ctx, 'bypass', ''), /not available/);
  await assert.rejects(changeClaude(f.ctx, 'bypass', 'claude'), /dangerously-skip-permissions/);
});

test('Codex: opens /permissions, confirms Full Access, waits for the confirmation line', async () => {
  const idle = '› Ask Codex to do anything';
  const menu = '  Update Model Permissions\n› 1. Ask for approval (current)  Codex can read\n  2. Approve for me  Only ask\n  3. Full Access  Codex can edit';
  const confirm = '  Enable full access?\n› 1. Yes, continue anyway  Apply full access\n  2. Cancel  Go back';
  const f = fixture([idle, idle, menu, menu, confirm, '• Permissions updated to Full Access\n' + idle]);
  const out = await changeCodex(f.ctx, 'full');
  assert.equal(out.mode, 'full');
  assert.deepEqual(f.calls[0], ['send-keys', '-t', 'test', '-l', '/permissions']);
  assert.equal(f.calls.flat().filter((k) => k === 'Down').length, 2);   // Full Access는 세 번째 줄
});

test('Codex: refuses while it is working or has a draft', async () => {
  for (const screen of ['Working (esc to interrupt)\n› Ask Codex to do anything', '› my unsent text']) {
    const f = fixture([screen]); await assert.rejects(changeCodex(f.ctx, 'ask')); assert.equal(f.calls.length, 0);
  }
});
