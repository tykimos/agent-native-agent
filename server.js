#!/usr/bin/env node
// ANA server — the nervous system of an agent-native app. Zero dependencies (Node >= 20 + tmux).
// Assembles the channel core (channel-core.js: tmux inject/mirror/ledger) with a dashboard API
// (dashboard-api.js). No MCP, no channel plugin, no bridge, no hooks, no launcher script.
//
//   Launch:  tmux new -s ana      # inside it: run `claude` (or any coding-agent CLI)
//            node server.js        # → http://localhost:8809
//
// The agent posts rich responses with curl (optional — plain replies mirror automatically):
//   curl -s -X POST localhost:8809/api/agent -H 'content-type: application/json' \
//        -d '{"text":"Add English Wed 19:00","diff":{"add":[{"title":"English 19:00 (Wed)"}]}}'

const path = require('node:path');

// tmux 3.7+는 UTF-8 로케일이 없으면 포맷 출력의 탭 같은 제어문자를 '_'로 바꾼다. 채널 코어는 세션 목록을
// 탭으로 나눠 읽으므로, 로케일 없이 띄운 서버(launchd·cron·env -i 등)에서는 세션 이름이
// 'base-ana-claude_1__1790332725'처럼 깨지고, 그 이름을 고르면 연결이 끊긴다. 자식 tmux가 물려받도록 채운다.
if (!/utf-?8/i.test(process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || '')) {
  if (process.env.LC_ALL) delete process.env.LC_ALL;   // LC_ALL이 C 등으로 박혀 있으면 LC_CTYPE보다 우선하므로 치운다
  process.env.LC_CTYPE = process.platform === 'darwin' ? 'UTF-8' : 'C.UTF-8';
}
const fs = require('node:fs');
const core = require('./channel-core.js');
const { createDashboardApi } = require('./dashboard-api.js');

const ROOT = __dirname;
const env = process.env;
const PORT = Number(env.PORT || 8809);
const BIND = env.BIND || '127.0.0.1';
const SESSION = env.TMUX_SESSION || 'ana';           // `tmux new -s ana`
const SOCKET = env.TMUX_SOCKET || '';                 // default tmux socket (simple). Set TMUX_SOCKET for isolation.
const TARGET = core.resolveTarget(ROOT, env);
const DATA_DIR = env.ANA_DATA_DIR || path.join(ROOT, '.ana'); // runtime state (git-ignored)
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

const apiOpts = {
  ROOT,
  DATA_FILE: env.DATA_FILE || path.join(DATA_DIR, 'state.json'),
  PROPOSALS_FILE: env.PROPOSALS_FILE || path.join(DATA_DIR, 'proposals.json'),
  EVOLVE_FILE: env.EVOLVE_FILE || path.join(DATA_DIR, 'evolve.json'),
  REQUESTS_FILE: env.REQUESTS_FILE || path.join(DATA_DIR, 'requests.json'),
  // 사용자/감사/업로드도 DATA_DIR을 따라간다(ANA_DATA_DIR로 격리 가능). 미배선 시 ROOT/.ana에 고정돼
  // 테스트가 실전 데이터를 오염시키고 ANA_DATA_DIR이 부분적으로만 먹던 문제를 없앤다.
  USERS_FILE: env.USERS_FILE || path.join(DATA_DIR, 'users.json'),
  AUDIT_FILE: env.AUDIT_FILE || path.join(DATA_DIR, 'audit.jsonl'),
  UPLOAD_DIR: env.UPLOAD_DIR || path.join(DATA_DIR, 'uploads'),
  NOTIFY_AGENT: env.NOTIFY_AGENT !== '0',
  MAX_TEXT: Number(env.MAX_TEXT || 8000),
  TMUX_SOCKET: SOCKET,                                 // 대화 기록(agent-log.js)이 팬 경로를 물을 때 같은 tmux 소켓을 쓴다
  SEED: env.ANA_SEED !== '0' && !env.ANA_TEST,          // 첫 실행 예제(seed.js). ANA_SEED=0이면 빈 보드로 시작
  // 신원은 앞단(리버스 프록시·SSO 게이트웨이)이 헤더로 실어 줄 때만 잡힌다. 미지정이면 단일 사용자.
  IDENTITY_HEADER: env.ANA_IDENTITY_HEADER || '',
  LOGOUT_URL: env.ANA_LOGOUT_URL || '',
};
const opts = {
  ROOT, PORT, BIND, SESSION, SOCKET, TARGET,
  HISTORY_LINES: Number(env.HISTORY_LINES || 10000),
  MAX_TEXT: apiOpts.MAX_TEXT,
  POLL_MS: Number(env.POLL_MS || 300),
  FEED_FILE: env.TRANSCRIPT_FILE || path.join(DATA_DIR, 'transcript.jsonl'),
  readyGuard: env.ANA_READY_GUARD !== '0',
  autoConfigPane: env.ANA_AUTOCONFIG !== '0',         // apply alternate-screen off + fixed size on connect
  SERVABLE: new Set(['dashboard.html', 'ana-logo.png']),
  defaultDoc: 'dashboard.html',
  testMode: !!env.ANA_TEST,
};

if (env.ANA_TEST) {
  const ch = core.createChannel(opts);
  const api = createDashboardApi(core, apiOpts);
  api.bootstrap(ch.feed);
  module.exports = {
    parseTranscript: core.parseTranscript, stripBottomUI: core.stripBottomUI, displayWidth: core.displayWidth,
    extractDraft: core.extractDraft, detectBusy: core.detectBusy, inputBoxReady: core.inputBoxReady, dialogOpen: core.dialogOpen, parseDialog: core.parseDialog,
    norm: core.norm, strip: core.strip, csrfOk: core.csrfOk,
    same: ch.same, sameOrGrown: ch.sameOrGrown, anchorIndex: ch.anchorIndex, matchesRunInFeed: ch.matchesRunInFeed,
    nextSeq: ch.nextSeq, feed: ch.feed, commit: ch.commit,
    applyDiff: api.applyDiff, hasDiff: api.hasDiff, validateDiff: api.validateDiff,
    loadData: api.loadData, saveData: api.saveData, loadProposals: api.loadProposals, saveProposals: api.saveProposals,
    loadEvolve: api.loadEvolve, saveEvolve: api.saveEvolve,
  };
} else {
  const api = createDashboardApi(core, apiOpts);
  const app = core.createChannelServer({
    ...opts, extraApi: api.extraApi, snapshotExtra: api.snapshotExtra,
    identify: api.identify, onChat: api.onChat, userKey: api.userKey,
    TARGETS_FILE: env.TARGETS_FILE || path.join(DATA_DIR, 'targets.json'),  // 사람별 최근 코딩 에이전트 세션
  });
  api.bootstrap(app.ch.feed);
  app.listen(() => {
    const host = BIND === '0.0.0.0' ? 'localhost' : BIND;
    console.log(`\nANA → http://${host}:${PORT}   (tmux target: ${TARGET})`);
    console.log(`Run your agent in tmux first:  tmux new -s ${SESSION}   then inside it:  claude`);
    if (BIND === '0.0.0.0') console.error('[ana] warning: 0.0.0.0 bind — trusted network only (no auth).');
  });
}
