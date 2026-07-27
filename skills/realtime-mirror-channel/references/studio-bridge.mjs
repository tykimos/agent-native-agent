/* =============================================================
 * studio-bridge.mjs — ANA 앱 인바운드 릴레이 + 아웃바운드 미러 (의존성 0, Node 22 fetch/WebSocket)
 *   앱 /api/inbox-wait 롱폴 → 새 요청(칩+메시지/승인결정)을 fakechat WS로 주입
 *   → Claude 세션이 <channel source="fakechat"> 로 수신 → 앱 /api/agent 로 리치 응답.
 *   세션이 fakechat reply 도구로 답하면 broadcast 를 받아 /api/agent 로 미러링.
 *
 *   ※ 텔레그램·외부 자격증명 없음. fakechat 은 로컬 WS 로만 동작한다.
 *   ※ APP_TOKEN 은 secrets.env 에서 읽으며 코드에 값이 들어가지 않는다.
 * ============================================================= */
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function loadEnv(p) { const o = {}; if (existsSync(p)) for (const l of readFileSync(p, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) o[m[1]] = m[2]; } return o; }

/* ── 설정 (환경변수 또는 secrets.env 로 주입 — 아래 기본값만 프로젝트에 맞게 고친다) ───────── */
const SECRETS = process.env.SECRETS_ENV || join(homedir(), '.config/ana/secrets.env'); // 토큰 보관 파일
const E = { ...loadEnv(SECRETS), ...process.env };
const APP = E.APP_URL || 'http://127.0.0.1:8791';          // ANA 앱 서버 (예: :8791)
const TOKEN = (E.APP_TOKEN || '').trim();                   // 앱 API 토큰 (없으면 무인증)
const FAKECHAT = E.FAKECHAT_WS || 'ws://127.0.0.1:8798/ws'; // 이 세션 전용 fakechat WS 포트 (세션마다 격리)
const TAG = E.TAG || '스튜디오';                             // 채널 메시지 앞에 붙는 출처 태그
const APP_ROOT = E.APP_ROOT || '';                          // 캡처 이미지 절대경로 접두사(앱 정적 루트). 비우면 상대경로 그대로
const ID_PREFIX = E.ID_PREFIX || 'studio';                  // 주입 메시지 id 접두사
/* ──────────────────────────────────────────────────────────────────────────────────── */

const qs = TOKEN ? ('?token=' + encodeURIComponent(TOKEN)) : '';

let ws = null, wsReady = false, seq = 0;
function connect() {
  ws = new WebSocket(FAKECHAT);
  ws.addEventListener('open', () => { wsReady = true; console.log('[bridge] fakechat 연결', FAKECHAT); });
  ws.addEventListener('close', () => { wsReady = false; console.log('[bridge] fakechat 끊김 — 3s 후 재연결'); setTimeout(connect, 3000); });
  ws.addEventListener('error', () => { try { ws.close(); } catch { } });
  // 세션이 reply 도구로 답하면 fakechat 서버가 {type:'msg',from:'assistant'}를 broadcast → 앱 패널로 미러
  ws.addEventListener('message', async (ev) => {
    let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch { return; }
    if (m && m.type === 'msg' && m.from === 'assistant' && (m.text || '').trim()) {
      try {
        await fetch(`${APP}/api/agent${qs}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: m.text }) });
        console.log('[bridge] ← 세션 답 미러→앱:', m.text.slice(0, 50));
      } catch (e) { console.log('[bridge] 미러 실패', e?.message); }
    }
  });
}
connect();

// 앱 요청을 사람이 보낸 것처럼 fakechat 채널에 주입
// ※ chips 스키마(week/page/component/text/detail)는 예시다. 앱 도메인에 맞춰 필드만 바꾸고 구조는 유지한다.
function toText(it) {
  if (it.kind === 'decision') {
    const chip = (it.chips || []).map(c => `[${c.week}·p${c.page}·${c.component}${c.text ? '·' + c.text : ''}]`).join(' ');
    return `[${TAG}·승인] 제안#${it.proposalId} → ${it.decision}${it.reason ? ' (사유: ' + it.reason + ')' : ''} ${chip}\n승인이면 그 수정을 실제 적용(소스/렌더)하고 커밋·재렌더한 뒤 앱 /api/agent 로 결과 보고. 반려면 사유 반영해 재제안.`;
  }
  const chip = (it.chips || []).map(c => {
    const d = c.detail || {};
    let s = `[${c.week}·p${c.page}·${c.component}${c.text ? '·' + c.text : ''}]`;
    const bits = [];
    if (d.label) bits.push('라벨=' + d.label);
    if (d.selector) bits.push('위치=' + d.selector);
    if (d.prev) bits.push('앞="' + String(d.prev).slice(0, 60) + '"');
    if (d.next) bits.push('뒤="' + String(d.next).slice(0, 60) + '"');
    if (c.image) bits.push('캡처이미지(Read해서 볼 것)=' + APP_ROOT + c.image);
    if (d.context) bits.push('문맥="' + String(d.context).slice(0, 220) + '"');
    if (bits.length) s += '\n   ↳ ' + bits.join(' · ');
    return s;
  }).join('\n');
  return `[${TAG}] ${chip}\n${it.text || ''}\n\n(대상은 위 칩으로 정확히 지목됨. 그냥 평소처럼 답하면 미러 훅이 앱 화면에 표시하고, fakechat reply 도구로 답하면 브리지가 미러링합니다. 수정 요청이면 소스/렌더를 실제로 반영한 뒤 결과를 답하고, 승인 절차가 필요하면 앱 POST /api/agent 로 before/after·diff 제안(proposal)을 보낼 수 있음. APP=${APP})`;
}

async function loop() {
  for (;;) {
    try {
      const it = await fetch(`${APP}/api/inbox-wait${qs}`, { signal: AbortSignal.timeout(30000) }).then(r => r.json());
      if (it && (it.text || it.chips || it.kind)) {
        const text = toText(it);
        // ★ fakechat 서버는 {id, text} 형식만 받아 세션에 전달(id 없으면 서버가 조용히 드롭). 반드시 truthy id 포함.
        if (wsReady) { ws.send(JSON.stringify({ id: ID_PREFIX + '-' + (++seq), text })); console.log('[bridge] → 세션 주입:', (it.text || it.kind || '').slice(0, 40)); }
        else console.log('[bridge] fakechat 미연결 — 드롭(재시도는 세션이)');
      }
    } catch { await new Promise(r => setTimeout(r, 1500)); }
  }
}
loop();
