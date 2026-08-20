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
  NOTIFY_AGENT: env.NOTIFY_AGENT !== '0',
  MAX_TEXT: Number(env.MAX_TEXT || 8000),
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
  SERVABLE: new Set(['dashboard.html', 'share.html', 'ana-logo.png']),
  defaultDoc: 'dashboard.html',
  testMode: !!env.ANA_TEST,
};

if (env.ANA_TEST) {
  const ch = core.createChannel(opts);
  const api = createDashboardApi(core, apiOpts);
  api.bootstrap(ch.feed);
  module.exports = {
    parseTranscript: core.parseTranscript, stripBottomUI: core.stripBottomUI, displayWidth: core.displayWidth,
    extractDraft: core.extractDraft, detectBusy: core.detectBusy, inputBoxReady: core.inputBoxReady, dialogOpen: core.dialogOpen,
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
    identify: api.identify, onChat: api.onChat,
  });
  api.bootstrap(app.ch.feed);
  app.listen(() => {
    const host = BIND === '0.0.0.0' ? 'localhost' : BIND;
    console.log(`\nANA → http://${host}:${PORT}   (tmux target: ${TARGET})`);
    console.log(`Run your agent in tmux first:  tmux new -s ${SESSION}   then inside it:  claude`);
    if (BIND === '0.0.0.0') console.error('[ana] warning: 0.0.0.0 bind — trusted network only (no auth).');
  });
}
