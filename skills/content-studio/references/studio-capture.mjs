/* studio-capture.mjs — 문서 HTML의 특정 영역(문서좌표 clip)을 헤드리스로 캡처해 att/에 저장.
 * 사용: node studio-capture.mjs <x> <y> <w> <h> <outAbsPath>
 * 좌표는 문서 좌표(iframe 내부 getBoundingClientRect, 스크롤 0 기준).
 * 의존성 0(Node 22 WebSocket/fetch로 CDP 구동), 단발성 Chrome 사용 후 종료. */
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [, , xs, ys, ws_, hs, out] = process.argv;
const x = Math.max(0, Math.round(+xs)), y = Math.max(0, Math.round(+ys));
const w = Math.max(8, Math.round(+ws_)), h = Math.max(8, Math.round(+hs));
const PORT = process.env.STUDIO_PORT || 8791;
/* ▼▼ 프로젝트별 설정(원본 키트는 문서 라우트·뷰포트·Chrome 경로가 하드코딩이었다) ▼▼ */
const DOC_ROUTE = process.env.STUDIO_DOC_ROUTE || '/document.html';  // 서버의 DOC_ROUTE와 동일해야 함
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEW_W = +(process.env.STUDIO_CAP_W || 620);   // 문서 페이지 고정폭보다 넉넉하게(예: 559px 페이지 → 620)
const VIEW_H = +(process.env.STUDIO_CAP_H || 900);
/* ▲▲ 프로젝트별 설정 끝 ▲▲ */
const URL = `http://127.0.0.1:${PORT}${DOC_ROUTE}`;
const DBG = 9400 + Math.floor((Date.now() % 500));   // 포트 충돌 회피(대략)

const prof = mkdtempSync(join(tmpdir(), 'studio-cap-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  `--user-data-dir=${prof}`, `--remote-debugging-port=${DBG}`, '--remote-allow-origins=*', 'about:blank'],
  { stdio: 'ignore' });

const cleanup = () => { try { chrome.kill('SIGKILL'); } catch { } try { rmSync(prof, { recursive: true, force: true }); } catch { } };
process.on('exit', cleanup);

async function waitDebug() { for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${DBG}/json/version`); if (r.ok) return; } catch { } await new Promise(r => setTimeout(r, 250)); } throw new Error('debug port timeout'); }

(async () => {
  await waitDebug();
  const t = await fetch(`http://127.0.0.1:${DBG}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' }).then(r => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
  await send('Page.enable');
  // 문서 페이지 폭보다 넉넉한 뷰포트(VIEW_W/VIEW_H 상수)
  await send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 2, mobile: false });
  await send('Page.navigate', { url: URL });
  await new Promise(r => setTimeout(r, 2600));   // 폰트·레이아웃 정착
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x, y, width: w, height: h, scale: 1 } });
  writeFileSync(out, Buffer.from(data, 'base64'));
  try { ws.close(); } catch { }
  console.log(out);
  cleanup(); process.exit(0);
})().catch(e => { console.error('capture-fail:', e.message); cleanup(); process.exit(1); });
