'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { codexModelName } = require('./agent-log');
const EFFORT_LABELS = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
async function models() {
  const data = JSON.parse(await fs.readFile(path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'models_cache.json'), 'utf8'));
  return data.models.filter(m => m.visibility === 'list' && /^[\w.-]+$/.test(m.slug)).map(m => ({
    id: m.slug, name: codexModelName(m.slug), description: m.description || '',
    efforts: (m.supported_reasoning_levels || []).map(e => e.effort).filter(e => EFFORT_LABELS[e]), defaultEffort: m.default_reasoning_level,
  }));
}
function menuRows(screen) {
  return screen.split('\n').map(line => /^\s*(›)?\s*(\d+)\.\s+(.+?)\s*$/.exec(line)).filter(Boolean)
    .map(m => ({ selected: !!m[1], label: m[3] }));
}
async function change(ctx, model, effort) {
  const key = (...keys) => ctx.ch.tmux(['send-keys', '-t', ctx.target, ...keys]);
  const wait = async predicate => {
    for (let i = 0; i < 20; i++) { const s = await ctx.ch.captureScreen(); if (predicate(s)) return s; await ctx.ch.delay(150); }
    throw new Error('Codex did not confirm the setting — check the terminal');
  };
  const choose = async (screen, predicate) => {
    const rows = menuRows(screen), from = rows.findIndex(r => r.selected), to = rows.findIndex(r => predicate(r.label));
    if (from < 0 || to < 0) throw new Error('The requested option is not available in the Codex menu');
    if (to !== from) await key(...Array(Math.abs(to - from)).fill(to > from ? 'Down' : 'Up'));
    await key('Enter');
  };
  const before = await ctx.ch.captureScreen();
  if (/esc to interrupt|Select Model|Select Reasoning|Press enter to confirm/i.test(before)) throw new Error('Wait for Codex to finish or close its current menu');
  const input = [...before.matchAll(/^\s*›\s*(.*)$/gm)].pop();
  if (!input || (input[1].trim() && !['Ask Codex to do anything', 'Find and fix a bug in @filename', 'Explain this codebase', 'Implement {feature}', 'Improve documentation in @filename', 'Write tests for @filename', 'Summarize recent commits', 'Run /review on my current changes'].includes(input[1].trim()))) throw new Error('Clear the Codex input before changing its model');
  // Type the command: pasted slash commands may be treated as ordinary prompts.
  await ctx.ch.tmux(['send-keys', '-t', ctx.target, '-l', '/model']);
  await ctx.ch.delay(200); await key('Enter');
  let screen = await wait(s => s.includes('Select Model and Effort'));
  await choose(screen, label => label.split(/\s/)[0] === model.id);
  screen = await wait(s => s.includes(`Select Reasoning Level for ${model.id}`));
  await choose(screen, label => label === EFFORT_LABELS[effort] || label.startsWith(EFFORT_LABELS[effort] + ' '));
  const confirmation = `Model changed to ${model.id} ${effort}`;
  await wait(s => !s.includes('Select Reasoning Level') && s.split(confirmation).length > before.split(confirmation).length);
  return { ok: true, model: { changed: true, id: model.id, name: model.name }, effort: { changed: true, level: effort } };
}
module.exports = { models, change, menuRows };
