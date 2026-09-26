const { test } = require('node:test');
const assert = require('node:assert/strict');
const { change } = require('./codex-settings');
const model = { id: 'gpt-5.5', name: 'GPT-5.5' };
function fixture(screens) {
  const calls = [];
  return { calls, ctx: { target: 'test', ch: { captureScreen: async () => screens.length > 1 ? screens.shift() : screens[0], delay: async () => {}, tmux: async args => calls.push(args) } } };
}
test('navigates the actual model and reasoning menus and confirms the change', async () => {
  const f = fixture(['› Ask Codex to do anything', 'Select Model and Effort\n› 1. gpt-6-astra (current)\n  2. gpt-5.5 Legacy', 'Select Reasoning Level for gpt-5.5\n› 1. Low\n  2. Medium (default)', '• Model changed to gpt-5.5 medium\n› Ask Codex to do anything']);
  const out = await change(f.ctx, model, 'medium');
  assert.equal(out.model.id, model.id);
  assert.equal(out.effort.level, 'medium');
  assert.deepEqual(f.calls[0], ['send-keys', '-t', 'test', '-l', '/model']);
  assert.equal(f.calls.filter(c => c.includes('Down')).length, 2);
});
test('does not overwrite drafts or send commands while working', async () => {
  for (const screen of ['› My unsent text', '› Implement my feature', 'Working (esc to interrupt)\n› Ask Codex to do anything']) {
    const f = fixture([screen]); await assert.rejects(change(f.ctx, model, 'medium')); assert.equal(f.calls.length, 0);
  }
});
test('does not claim success without a confirmation', async () => {
  const f = fixture(['› Ask Codex to do anything', 'Select Model and Effort\n› 1. gpt-5.5', 'Select Reasoning Level for gpt-5.5\n› 1. Medium', 'Error: model unavailable']);
  await assert.rejects(change(f.ctx, model, 'medium'), /did not confirm/);
});
