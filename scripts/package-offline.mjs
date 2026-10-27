#!/usr/bin/env node
// Build the offline (no-LLM) Windows x64 package: a portable Node + the ANA base + its node_modules,
// started by double-clicking start.bat. Runs on macOS/Linux/Windows with internet (to fetch Node once);
// the result needs no internet, no tmux and no AI agent.
//
//   node scripts/package-offline.mjs                 → dist/ANA-offline-win-x64-<version>.zip
//   NODE_DIST_VERSION=v24.22.0 node scripts/package-offline.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE_VER = process.env.NODE_DIST_VERSION || 'v24.22.0';     // Node 24 LTS (node:sqlite built in)
const PLAT = 'win-x64';
const version = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8')).version;
const NAME = `ANA-offline-${PLAT}-${version}`;
const DIST = path.join(ROOT, 'dist'), CACHE = path.join(DIST, '.cache'), OUT = path.join(DIST, NAME);

// 실행에 필요한 것만(테스트·스킬·문서 원본은 빼고)
const APP_FILES = ['server.js', 'channel-core.js', 'dashboard-api.js', 'dashboard.html', 'ana-logo.png', 'agent-log.js',
  'codex-settings.js', 'permission-mode.js', 'file-browser.js', 'graph.js', 'work-schema.js', 'seed.js', 'package.json', 'LICENSE'];
const DEPS = ['@tykimos/noderel', 'modern-screenshot'];

const log = (m) => console.log(`[package] ${m}`);
async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

// 1) Windows용 Node — 공식 배포본을 받아 SHASUMS256으로 확인
fs.mkdirSync(CACHE, { recursive: true });
const zipName = `node-${NODE_VER}-${PLAT}.zip`, zipPath = path.join(CACHE, zipName);
const sums = await (await fetch(`https://nodejs.org/dist/${NODE_VER}/SHASUMS256.txt`)).text();
const want = (sums.split('\n').find((l) => l.endsWith(`  ${zipName}`)) || '').split(/\s+/)[0];
if (!want) throw new Error(`no checksum for ${zipName}`);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
if (!fs.existsSync(zipPath) || sha(zipPath) !== want) { log(`downloading ${zipName}`); await download(`https://nodejs.org/dist/${NODE_VER}/${zipName}`, zipPath); }
if (sha(zipPath) !== want) throw new Error(`checksum mismatch for ${zipName}`);
log(`node ${NODE_VER} ${PLAT} — sha256 ok`);

// 2) 폴더 구성
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'node'), { recursive: true });
const unz = path.join(CACHE, `node-${NODE_VER}-${PLAT}`);
if (!fs.existsSync(path.join(unz, 'node.exe'))) execFileSync('unzip', ['-q', '-o', zipPath, '-d', CACHE]);
for (const f of ['node.exe', 'LICENSE']) fs.copyFileSync(path.join(unz, f), path.join(OUT, 'node', f));

const APP = path.join(OUT, 'app');
fs.mkdirSync(APP, { recursive: true });
for (const f of APP_FILES) fs.copyFileSync(path.join(ROOT, f), path.join(APP, f));
for (const d of DEPS) fs.cpSync(path.join(ROOT, 'node_modules', d), path.join(APP, 'node_modules', d), { recursive: true, dereference: true });
fs.mkdirSync(path.join(OUT, 'files'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'files', 'README.txt'), 'Files you upload in System > Files are stored here.\r\n');

// 3) 실행 파일 — 줄바꿈은 CRLF(메모장·cmd 호환)
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
fs.writeFileSync(path.join(OUT, 'start.bat'), crlf(`@echo off
chcp 65001 >nul
setlocal
title ANA (offline)
rem ---- settings: change the port here if 8809 is taken ----
if not defined PORT set PORT=8809
rem ----------------------------------------------------------
set "ROOT=%~dp0"
set ANA_OFFLINE=1
set ANA_OPEN=1
set BIND=127.0.0.1
set "ANA_DATA_DIR=%ROOT%data"
set "ANA_FILES_ROOT=%ROOT%files"
if not exist "%ANA_FILES_ROOT%" mkdir "%ANA_FILES_ROOT%"
echo Starting ANA on http://127.0.0.1:%PORT%/  (close this window or press Ctrl+C to stop)
"%ROOT%node\\node.exe" "%ROOT%app\\server.js"
echo.
echo ANA stopped.
pause
`));
fs.writeFileSync(path.join(OUT, 'VERSION.txt'), crlf(`ANA ${version} (offline, ${PLAT})\nNode ${NODE_VER}\nBuilt ${new Date().toISOString()}\n`));
// 안내서는 ASCII 이름의 .txt로(맥에서 만든 zip의 한글 파일 이름은 Windows 탐색기에서 깨질 수 있고, .txt는 더블클릭으로 메모장이 연다)
fs.writeFileSync(path.join(OUT, 'INSTALL-KO.txt'), crlf(fs.readFileSync(path.join(ROOT, 'docs/offline.ko.md'), 'utf8')));
fs.writeFileSync(path.join(OUT, 'INSTALL-EN.txt'), crlf(fs.readFileSync(path.join(ROOT, 'docs/offline.md'), 'utf8')));

// 4) zip
const zipOut = path.join(DIST, `${NAME}.zip`);
fs.rmSync(zipOut, { force: true });
execFileSync('zip', ['-q', '-r', '-X', zipOut, NAME], { cwd: DIST });
const mb = (fs.statSync(zipOut).size / 1048576).toFixed(1);
fs.writeFileSync(`${zipOut}.sha256`, `${sha(zipOut)}  ${path.basename(zipOut)}\n`);
log(`done → ${path.relative(ROOT, zipOut)} (${mb} MB)`);
