#!/usr/bin/env node
// ana-diff.mjs — compare an existing ANA with the latest upstream ANA, feature by feature.
//
//   node ana-diff.mjs --target <ana dir> [--upstream <dir | git url>] [--json] [--record]
//
// Reads upstream features.json, then searches the target's own .js/.html files (plus the channel-core.js it
// requires) for each feature's anchors. Reports present / partial / missing, outdated copied modules, and
// whether the shared runtime differs. Read-only unless --record, which writes <target>/.ana-sync.json
// (upstream commit + features present) so the next run can list only what changed since.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const DEFAULT_UPSTREAM = 'https://github.com/tykimos/agent-native-agent';
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const flag = (k) => args.includes(k);
if (flag('--help') || !opt('--target')) {
  console.log('usage: node ana-diff.mjs --target <ana dir> [--upstream <dir|git url>] [--json] [--record]');
  process.exit(opt('--target') ? 0 : 2);
}
const target = path.resolve(opt('--target'));
if (!fs.existsSync(target)) { console.error(`target not found: ${target}`); process.exit(2); }

// ---- upstream: a local checkout, or a git URL cloned (blobless, full history) into a temp dir ----
let upstream = opt('--upstream') || DEFAULT_UPSTREAM;
let upDir = upstream;
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
if (/^(https?:|git@|ssh:)/.test(upstream)) {
  upDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ana-upstream-'));
  execFileSync('git', ['clone', '-q', '--filter=blob:none', upstream, upDir], { stdio: 'inherit' });
}
upDir = path.resolve(upDir);
const manifestPath = path.join(upDir, 'features.json');
if (!fs.existsSync(manifestPath)) { console.error(`no features.json in upstream (${upDir}) — is it an ANA checkout with the feature manifest?`); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let upCommit = ''; try { upCommit = git(upDir, 'rev-parse', 'HEAD'); } catch {}

// ---- target code: its own .js/.mjs/.cjs/.html files (not tests, deps, or runtime state) ----
const SKIP_DIR = new Set(['node_modules', '.ana', '.git', 'data', 'skills', 'docs']);
function codeFiles(dir, depth = 0, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (depth < 2 && !SKIP_DIR.has(e.name) && !e.name.startsWith('.')) codeFiles(path.join(dir, e.name), depth + 1, out); continue; }
    if (/\.(m?js|cjs|html)$/.test(e.name) && !/(^|[.-])test\.|\.test\./.test(e.name) && e.name !== 'channel-core.js') out.push(path.join(dir, e.name));
  }
  return out;
}
const files = codeFiles(target);
const corpus = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

// the runtime the target actually uses: its own copy, or the one it require()s (e.g. ../channel-core.js on a host)
let runtimePath = null;
const req = /require\(\s*['"]([^'"]*channel-core\.js)['"]\s*\)/.exec(corpus);
for (const c of [req && path.resolve(target, req[1]), path.join(target, 'channel-core.js')]) if (c && fs.existsSync(c)) { runtimePath = c; break; }
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

// ---- compare ----
const features = manifest.features.map((f) => {
  const hit = f.anchors.filter((a) => corpus.includes(a));
  const status = hit.length === f.anchors.length ? 'present' : hit.length === 0 ? 'missing' : 'partial';
  const modules = (f.copy || []).map((m) => {
    const t = path.join(target, m), u = path.join(upDir, m);
    return { file: m, state: !fs.existsSync(t) ? 'absent' : fs.existsSync(u) && sha(t) === sha(u) ? 'same' : 'differs' };
  });
  return { id: f.id, title: f.title, skill: f.skill, status, found: hit.length, total: f.anchors.length,
    missingAnchors: f.anchors.filter((a) => !hit.includes(a)), modules, npm: f.npm || [] };
});
const upRuntime = path.join(upDir, manifest.runtime.file);
const runtime = { path: runtimePath, state: !runtimePath ? 'not found' : fs.existsSync(upRuntime) && sha(runtimePath) === sha(upRuntime) ? 'same' : 'differs' };

// what changed upstream since the last recorded sync
const syncFile = path.join(target, '.ana-sync.json');
let sync = null; try { sync = JSON.parse(fs.readFileSync(syncFile, 'utf8')); } catch {}
let changes = [];
if (sync && sync.commit && upCommit && sync.commit !== upCommit) {
  try { changes = git(upDir, 'log', '--format=%h %ad %s', '--date=short', `${sync.commit}..HEAD`).split('\n').filter(Boolean); }
  catch { changes = ['(recorded commit not found upstream — compare features below)']; }
}

const report = { target, upstream, upstreamCommit: upCommit, lastSync: sync, changesSinceLastSync: changes, runtime, features, scanned: files.map((f) => path.relative(target, f)) };

if (flag('--record')) {
  fs.writeFileSync(syncFile, JSON.stringify({ upstream, commit: upCommit, at: new Date().toISOString(),
    features: features.filter((f) => f.status === 'present').map((f) => f.id) }, null, 2) + '\n');
  report.recorded = syncFile;
}

if (flag('--json')) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const icon = { present: '✓', partial: '◐', missing: '✗' };
console.log(`ANA diff  target=${target}`);
console.log(`          upstream=${upstream} @ ${upCommit.slice(0, 7) || '?'}`);
console.log(`          scanned ${files.length} files: ${report.scanned.join(', ')}`);
console.log(`runtime   channel-core.js ${runtime.state}${runtime.path ? ` (${path.relative(target, runtime.path) || runtime.path})` : ''}`);
if (sync) console.log(`last sync ${sync.commit ? sync.commit.slice(0, 7) : '?'} at ${sync.at}${changes.length ? ` — ${changes.length} upstream commit(s) since:` : ' — up to date'}`);
for (const c of changes.slice(0, 30)) console.log(`          ${c}`);
console.log('');
const w = Math.max(...features.map((f) => f.title.length));
for (const f of features) {
  const mod = f.modules.filter((m) => m.state !== 'same').map((m) => `${m.file}:${m.state}`).join(' ');
  console.log(`${icon[f.status]} ${f.title.padEnd(w)}  ${String(f.found).padStart(2)}/${f.total}  skill:${f.skill}${mod ? '  ' + mod : ''}`);
  if (f.status === 'partial') console.log(`    missing: ${f.missingAnchors.join(' · ')}`);
}
const todo = features.filter((f) => f.status !== 'present' || f.modules.some((m) => m.state === 'differs'));
console.log(`\nANA_DIFF present=${features.filter((f) => f.status === 'present').length} partial=${features.filter((f) => f.status === 'partial').length} missing=${features.filter((f) => f.status === 'missing').length} runtime=${runtime.state.replace(' ', '-')} todo=${todo.map((f) => f.id).join(',') || 'none'}`);
