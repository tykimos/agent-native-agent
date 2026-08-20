#!/usr/bin/env node
// test.cjs — tmux-dashboard-agent 서버 테스트 스위트.
//   node test.cjs
// Part A: 순수 로직 유닛 테스트 (파서·폭 계산·anchor·junk 필터·draft 추출 + 대시보드 diff)
// Part B: 통합 테스트 — 별도 tmux 세션(ana-selftest)에서 mock_agent.py를 상대로
//         입력 주입 → 캡처 → 원장 확정 전 과정을 검증. 라이브 세션(ana-agent)은 건드리지 않음.
// Part C: 대시보드 API 통합 — /api/state·/api/agent(제안)·/api/approve·/api/done

const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');

const ROOT = __dirname;
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'ana-test-'));
// 세션명·포트를 PID로 유니크화 — 여러 검증 에이전트가 동시에 test.cjs를 돌려도 충돌하지 않도록.
const TEST_SESSION = `ana-selftest-${process.pid}`;
const TEST_PORT = 8811 + (process.pid % 900);

process.env.ANA_TEST = '1';
// 모든 런타임 상태를 스크래치로 격리 — users/audit/uploads가 ROOT/.ana로 새지 않도록 ANA_DATA_DIR도 건다.
process.env.ANA_DATA_DIR = path.join(SCRATCH, 'unit-ana');
process.env.TRANSCRIPT_FILE = path.join(SCRATCH, 'unit-transcript.jsonl');
process.env.DATA_FILE = path.join(SCRATCH, 'unit-state.json');
process.env.PROPOSALS_FILE = path.join(SCRATCH, 'unit-proposals.json');
delete process.env.ANA_PANE_ID;
const srv = require('./server.js');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
async function ta(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n')[0]}`); }
}

// ============================================================ Part A: 유닛
console.log('\n[Part A] 유닛 테스트');

t('core-sync: channel-core.js가 정본(mirror)과 바이트 동일', () => {
  const here = require('node:crypto').createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'channel-core.js'))).digest('hex');
  const canon = path.join(ROOT, '..', '..', 'tmux-mirror-channel', 'references', 'channel-core.js');
  if (!fs.existsSync(canon)) { console.log('    (정본 미발견 — 단독 배포로 간주, 스킵)'); return; }
  const there = require('node:crypto').createHash('sha1').update(fs.readFileSync(canon)).digest('hex');
  assert.equal(here, there, '두 채널 코어 사본이 갈라짐 — sync-core.sh 실행 필요');
});

t('displayWidth: ASCII=1, 한글=2, 이모지=2', () => {
  assert.equal(srv.displayWidth('abc'), 3);
  assert.equal(srv.displayWidth('가나다'), 6);
  assert.equal(srv.displayWidth('a가b'), 4);
  assert.equal(srv.displayWidth('🎉'), 2);
});

t('parseTranscript: 사용자/에이전트/도구/도구결과 분리', () => {
  const m = srv.parseTranscript('❯ 안녕\n\n⏺ Bash(pwd)\n⎿ /tmp\n\n⏺ 답변입니다.\n\n✻ Worked for 1s\n');
  assert.deepEqual(m.map((x) => x.role), ['user', 'tool', 'toolresult', 'assistant']);
  assert.equal(m[0].text, '안녕');
  assert.equal(m[1].text, 'Bash(pwd)');
  assert.equal(m[3].text, '답변입니다.');
});

t('dashboard.html: 스크립트가 로드 시 예외 없이 끝까지 실행된다 (TDZ 회귀 방지)', () => {
  // 실제 사고: 부트스트랩(setMode)이 `let contextChips` 선언줄보다 위에서 실행돼
  // "Cannot access 'contextChips' before initialization"이 나고, 그 예외가 스크립트
  // 나머지를 통째로 중단시켜 화면의 버튼이 전부 죽었다. 정적 검사로는 못 잡아 실행해 본다.
  const vm = require('node:vm');
  const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 1, '스크립트 블록을 찾지 못함');
  // 무엇을 물어도 호출 가능한 값을 돌려주는 관대한 스텁. 전역을 Proxy로 열어(has: true)
  // 브라우저 API 부재로 인한 ReferenceError를 없애고, 스크립트 자신의 선언 순서 문제만 남긴다.
  const mk = () => new Proxy(function () {}, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return function* () {};
      if (k === Symbol.unscopables || k === 'then') return undefined;
      if (k === 'length') return 0;
      return mk();
    },
    apply: () => mk(),
    construct: () => mk(),
    set: () => true,
  });
  for (const code of blocks) {
    const base = { console: { log() {}, warn() {}, error() {} }, JSON, Math, Date, Object, Array, String,
      Number, Boolean, Promise, Map, Set, RegExp, Error, URL, Symbol, parseInt, parseFloat, isNaN,
      setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {} };
    const ctx = vm.createContext(new Proxy(base, {
      has: () => true,                                   // 미정의 전역은 ReferenceError 대신 스텁으로
      get: (t, k) => (k in t ? t[k] : (k === Symbol.unscopables ? undefined : mk())),
      set: (t, k, v) => { t[k] = v; return true; },
    }));
    try {
      vm.runInContext(code, ctx, { timeout: 5000 });
    } catch (e) {
      const msg = String((e && e.message) || e);
      // 이것만이 이 테스트의 관심사 — 선언 전에 접근해 스크립트가 통째로 죽는 사고.
      if (/before initialization|Assignment to constant/.test(msg)) throw e;
    }
  }
});

t('parseTranscript: ● 마커(v2.2.x)도 에이전트 턴 — 사용자 말풍선에 흡수 금지', () => {
  const m = srv.parseTranscript('❯ 안녕\n\n● 답변입니다.\n\n● Bash(pwd)\n⎿ /tmp\n\n✻ Worked for 1s\n');
  assert.deepEqual(m.map((x) => [x.role, x.text]), [
    ['user', '안녕'], ['assistant', '답변입니다.'], ['tool', 'Bash(pwd)'], ['toolresult', '/tmp'],
  ]);
  // ● 상태 라인은 계속 노이즈로 버린다
  const s = srv.parseTranscript('❯ q\n\n● high · /effort\n\n● 응답\n\n✻ Worked for 1s\n');
  assert.deepEqual(s.map((x) => [x.role, x.text]), [['user', 'q'], ['assistant', '응답']]);
  // 슬래시 경로가 섞인 본문은 상태 라인이 아니다
  const p = srv.parseTranscript('❯ q\n\n● 수정 완료 · /home/u/a.js 를 고쳤습니다\n\n✻ Worked for 1s\n');
  assert.deepEqual(p.map((x) => x.role), ['user', 'assistant']);
});

t('parseTranscript: 하단 팁 배너 제거, 들여쓴 본문의 Tip: 은 보존', () => {
  const m = srv.parseTranscript('❯ q\n\n● 응답\n\nTip: Use /btw to ask a quick side question\n\n✻ Worked for 1s\n');
  assert.deepEqual(m.map((x) => [x.role, x.text]), [['user', 'q'], ['assistant', '응답']]);
  const body = srv.parseTranscript('❯ q\n\n● 정리:\n  Tip: 이건 본문입니다\n\n✻ Worked for 1s\n');
  assert.equal(body[1].text, '정리:\nTip: 이건 본문입니다');
});

t('parseTranscript: 노이즈 제거 (테두리·구분선·스피너·다이얼로그 메뉴·placeholder)', () => {
  const cap = [
    '╭── banner ──╮', '│ Claude Code │', '╰────────────╯',
    '❯ 질문',
    '✳ Creating… (30s · ↓ 534 tokens)',
    '⏺ 응답',
    '────────────────',
    '❯ 1. Set it up',
    '❯ Try "fix lint errors"',
    '⏵⏵ auto mode on (shift+tab to cycle)',
    'Enter to confirm · Esc to cancel',
  ].join('\n');
  const m = srv.parseTranscript(cap);
  assert.deepEqual(m.map((x) => [x.role, x.text]), [['user', '질문'], ['assistant', '응답']]);
});

t('parseTranscript: 완료 마커 → done, 마커 없는 마지막 → not done', () => {
  const done = srv.parseTranscript('❯ q\n\n⏺ 완료된 응답\n\n✻ Cooked for 3s\n');
  assert.equal(done[1].done, true);
  const notDone = srv.parseTranscript('❯ q\n\n⏺ 아직 생성 중인 응답');
  assert.equal(notDone[0].done, true);   // user는 뒤 블록 존재로 done
  assert.ok(!notDone[1].done);           // 마지막 assistant는 마커 없음 → not done
});

t('강제 줄바꿈 복원: 단어 경계 랩 → 공백 join', () => {
  const line1 = '⏺ ' + 'x'.repeat(70) + ' yy';  // 표시폭 75, W=80
  const m = srv.parseTranscript(`❯ q\n\n${line1}\n  tail.\n\n✻ Worked for 1s\n`, 80);
  assert.equal(m[1].text, 'x'.repeat(70) + ' yy tail.');
});

t('강제 줄바꿈 복원: 폭에 꽉 찬 ASCII 토큰 → 무공백 join', () => {
  const base = '⏺ Saved /tmp/';
  const line1 = base + 'a'.repeat(80 - base.length);  // 정확히 80
  const m = srv.parseTranscript(`❯ q\n\n${line1}\n  bbb.txt\n\n✻ Worked for 1s\n`, 80);
  assert.equal(m[1].text, 'Saved /tmp/' + 'a'.repeat(80 - base.length) + 'bbb.txt');
});

t('강제 줄바꿈 복원: 한글 랩 → 공백 join', () => {
  const line1 = '⏺ ' + '가'.repeat(36) + ' 끝';  // 표시폭 77
  const m = srv.parseTranscript(`❯ q\n\n${line1}\n  이어짐\n\n✻ Worked for 1s\n`, 80);
  assert.equal(m[1].text, '가'.repeat(36) + ' 끝 이어짐');
});

t('의도된 줄바꿈 보존: 문단(빈 줄)·목록 마커·짧은 줄', () => {
  const m = srv.parseTranscript('❯ q\n\n⏺ First para.\n\n  Second para.\n\n✻ Worked for 1s\n', 80);
  assert.equal(m[1].text, 'First para.\n\nSecond para.');
  const longLine = '⏺ ' + 'z'.repeat(74);  // 폭에 거의 참
  const list = srv.parseTranscript(`❯ q\n\n${longLine}\n  - item\n\n✻ Worked for 1s\n`, 80);
  assert.equal(list[1].text, 'z'.repeat(74) + '\n- item');  // 목록 마커는 join 금지
});

t('same: 리와핑(줄바꿈·공백 차이) + 접합 차이를 동일 메시지로 판정 (공백 전부 무시)', () => {
  // 폭에 따라 "tell me"/"tell\nme"/"tellme"로 갈려도 앵커가 살아남아야 한다(공백 제거 비교).
  assert.equal(srv.same({ role: 'a', text: 'tell me now' }, { role: 'a', text: 'tell\nme now' }), true);
  assert.equal(srv.same({ role: 'a', text: 'tell me now' }, { role: 'a', text: 'tellme now' }), true);
  assert.equal(srv.same({ role: 'a', text: 'x' }, { role: 'b', text: 'x' }), false); // role 다르면 불일치
  assert.equal(srv.same({ role: 'a', text: 'abc' }, { role: 'a', text: 'abd' }), false);
});

t('anchorIndex: 정상 append / 리와핑 면역 / 우측 우선', () => {
  srv.feed.length = 0;
  srv.feed.push({ seq: 1, role: 'user', text: 'q1' }, { seq: 2, role: 'assistant', text: 'a1 b1' });
  // 새 메시지 하나 추가된 파싱 결과
  let parsed = [{ role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1 b1' }, { role: 'user', text: 'q2' }];
  assert.equal(srv.anchorIndex(parsed), 2);
  // 리와핑: 같은 내용이 다른 줄바꿈으로
  parsed = [{ role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1\nb1' }, { role: 'user', text: 'q2' }];
  assert.equal(srv.anchorIndex(parsed), 2);
  // 스크롤백에 사본 두 벌 → 우측(마지막) 사본 뒤가 신규
  parsed = [
    { role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1 b1' },
    { role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1 b1' },
    { role: 'user', text: 'q2' },
  ];
  assert.equal(srv.anchorIndex(parsed), 4);
});

t('anchorIndex: 확정 후 자란 마지막 메시지(prefix) 허용', () => {
  srv.feed.length = 0;
  srv.feed.push({ seq: 1, role: 'assistant', text: '부분 응답' });
  const parsed = [{ role: 'assistant', text: '부분 응답 이 더 자람' }, { role: 'user', text: 'next' }];
  assert.equal(srv.anchorIndex(parsed), 1);
});

t('matchesRunInFeed: 리렌더 잔재 판별', () => {
  srv.feed.length = 0;
  srv.feed.push(
    { seq: 1, role: 'user', text: 'q1' }, { seq: 2, role: 'assistant', text: 'a1' },
    { seq: 3, role: 'user', text: 'q2' }, { seq: 4, role: 'assistant', text: 'a2' },
  );
  assert.equal(srv.matchesRunInFeed([{ role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1' }]), true);
  assert.equal(srv.matchesRunInFeed([{ role: 'assistant', text: 'a1' }, { role: 'user', text: 'q2' }]), true);
  assert.equal(srv.matchesRunInFeed([{ role: 'user', text: 'q2' }, { role: 'assistant', text: '완전 새 응답' }]), false);
});

// ---------- 회귀 테스트 (검증 하네스가 발견한 Critical 픽스) ----------

t('R1 NBSP: ❯ 뒤 U+00A0도 사용자 메시지로 인식 (CR-4a)', () => {
  const m = srv.parseTranscript('❯ 안녕하세요\n\n⏺ 답변\n\n✻ Worked for 1s\n');
  assert.deepEqual(m.map((x) => [x.role, x.text]), [['user', '안녕하세요'], ['assistant', '답변']]);
});

t('R2 마크다운 불릿 보존: *·· 불릿이 스피너로 오인돼 삭제되지 않음 (CR-4b)', () => {
  const star = srv.parseTranscript('❯ q\n\n⏺ 목록:\n  * 첫째\n  * 둘째\n\n✻ Worked for 1s\n');
  assert.equal(star[1].text, '목록:\n* 첫째\n* 둘째');
  const mid = srv.parseTranscript('❯ q\n\n⏺ 목록:\n  · 하나\n  · 둘\n\n✻ Worked for 1s\n');
  assert.equal(mid[1].text, '목록:\n· 하나\n· 둘');
});

t('R3 상태줄 어휘 오삭제 방지: 본문의 plan mode/esc to interrupt 보존 (CR-4c)', () => {
  const m = srv.parseTranscript('❯ plan mode 로 바꿔줘\n\n⏺ 먼저 esc to interrupt 를 눌러 중단합니다.\n\n✻ Worked for 1s\n');
  assert.deepEqual(m.map((x) => [x.role, x.text]),
    [['user', 'plan mode 로 바꿔줘'], ['assistant', '먼저 esc to interrupt 를 눌러 중단합니다.']]);
});

t('R4 stripBottomUI: 입력 박스·상태 영역 제거, 본문 보존 (CR-4c/M2)', () => {
  const cap = ['⏺ 응답 본문', '', '───────', '❯ 타이핑 중', '───────', '  [OMC] Plugin not found. Run: /x', '  ⏵⏵ auto mode on'].join('\n');
  const m = srv.parseTranscript(srv.stripBottomUI(cap));
  assert.deepEqual(m.map((x) => [x.role, x.text]), [['assistant', '응답 본문']]);
});

t('R5 detectBusy: 본문의 "esc to interrupt"에 고착되지 않음 (CR-5)', () => {
  assert.equal(srv.detectBusy('❯ why does it show esc to interrupt?\n\n⏺ 설명...'), false);
  assert.equal(srv.detectBusy('⏺ 응답\n✳ Working… (5s · esc to interrupt)'), true);
  assert.equal(srv.detectBusy('· retry (5s later)'), false); // 중점 프로즈는 스피너 아님
});

t('R6 이중 폭 파싱: 같은 캡처를 폭 200/63으로 파싱해도 앵커 동일 (CR-3)', () => {
  const long = 'This is a sentence that wraps at the boundary tell';
  const cap200 = `❯ q\n\n⏺ ${long} me now.\n\n✻ Worked for 1s\n`;
  // 폭 63에서 "tell"까지 62칸이라 "tell\nme"로 렌더된 상황을 흉내
  const cap63 = `❯ q\n\n⏺ ${long}\n  me now.\n\n✻ Worked for 1s\n`;
  const a = srv.parseTranscript(cap200, 200)[1];
  const b = srv.parseTranscript(cap63, 63)[1];
  assert.equal(srv.same(a, b), true, `폭 달라도 동일해야: ${JSON.stringify([a.text, b.text])}`);
  // 그리고 무공백 접착으로 손상되지 않아야(단어 경계 → 공백 유지)
  assert.ok(b.text.includes('tell me') || b.text.includes('tell\nme'), `손상: ${b.text}`);
});

t('R7 nextSeq: 손상/누락 seq에도 NaN 오염 없음 (CR-6)', () => {
  srv.feed.length = 0;
  srv.feed.push({ seq: 1, role: 'a', text: 'x' }, { role: 'a', text: 'no-seq' }, { seq: 5, role: 'a', text: 'y' });
  assert.equal(srv.nextSeq(), 6); // max(유효 seq=5, len=3) + 1
  srv.feed.length = 0;
  assert.equal(srv.nextSeq(), 1);
});

t('R8 displayWidth: ZWJ 결합 이모지·조합문자 폭 정확 (terminal m4)', () => {
  assert.equal(srv.displayWidth('👨‍👩‍👧'), 2);   // ZWJ 가족 = 2칸
  assert.equal(srv.displayWidth('é'), 1);   // e + 조합 악센트 = 1칸
  assert.equal(srv.displayWidth('👍'), 2);
});

t('R9 csrfOk: content-type/Origin 검사 (CR-1)', () => {
  const mk = (headers) => srv.csrfOk({ headers });
  assert.equal(mk({ 'content-type': 'application/json', host: 'localhost:8809' }), true);
  assert.equal(mk({ 'content-type': 'text/plain', host: 'localhost:8809' }), false); // text/plain 우회 차단
  assert.equal(mk({ 'content-type': 'application/json', host: 'localhost:8809', origin: 'http://evil.example' }), false);
  assert.equal(mk({ 'content-type': 'application/json', host: 'localhost:8809', 'sec-fetch-site': 'cross-site' }), false);
});

t('R10 stripBottomUI: 입력 박스(❯) 있을 때만 절삭, 본문 수평선은 보존 (2차 NR1)', () => {
  // 입력 박스: 두 구분선 사이에 ❯ → 절삭
  const box = ['⏺ 응답', '───────', '❯ 입력', '───────', '  상태줄'].join('\n');
  assert.equal(srv.stripBottomUI(box), '⏺ 응답');
  // 본문 수평선 2개(입력 박스 아님): 절삭 금지 → 본문 뒷부분 보존
  const body = ['⏺ 표:', '  ────────', '  A | B', '  ────────', '  C | D'].join('\n');
  assert.equal(srv.stripBottomUI(body), body);
  const m = srv.parseTranscript(body);
  assert.ok(m[0].text.includes('C | D'), `본문 뒷부분 소실: ${m[0].text}`);
});

t('extractDraft: 입력 박스 추출 / placeholder·메뉴 제외', () => {
  const mk = (inputLine) => ['⏺ 응답', '──────────', inputLine, '──────────', '  status line'].join('\n');
  assert.equal(srv.extractDraft(mk('❯ 타이핑 중인 텍스트')), '타이핑 중인 텍스트');
  assert.equal(srv.extractDraft(mk('❯')), '');
  assert.equal(srv.extractDraft(mk('❯ Try "fix lint errors"')), '');
  assert.equal(srv.extractDraft(mk('❯ 1. Set it up')), '');
});

// ---------- 대시보드 diff 로직 ----------

t('D1 applyDiff: add/update/remove + version++ (caller id 무시 — QA-M5)', () => {
  srv.saveData({ version: 1, items: [] });
  let r = srv.applyDiff({ add: [{ id: 'x1', title: 'A' }] });
  assert.equal(r.version, 2);
  const id = srv.loadData().items[0].id;
  assert.notEqual(id, 'x1');                        // caller id 무시 — 서버 생성
  assert.equal(srv.loadData().items[0].title, 'A');
  r = srv.applyDiff({ update: [{ id, title: 'B' }] });
  assert.equal(srv.loadData().items[0].title, 'B');
  r = srv.applyDiff({ remove: [id] });
  assert.equal(srv.loadData().items.length, 0);
  assert.equal(r.version, 4);
});

t('D2 hasDiff: 빈/비배열 diff 판정 (QA-C2)', () => {
  assert.equal(srv.hasDiff(null), false);
  assert.equal(srv.hasDiff({}), false);
  assert.equal(srv.hasDiff({ add: [] }), false);
  assert.equal(srv.hasDiff({ add: 'abc' }), false);        // 비배열 → false(과거엔 truthy로 통과)
  assert.equal(srv.hasDiff({ add: [{ title: 'x' }] }), true);
  assert.equal(srv.hasDiff({ remove: ['a'] }), true);
});

t('D4 validateDiff: 깨진 diff 거부 (CR7/QA-C2)', () => {
  assert.ok(srv.validateDiff({ add: 'abc' }));             // 비배열 → 에러 문자열
  assert.ok(srv.validateDiff({ add: ['문자열'] }));         // 원소 비객체 → 에러
  assert.ok(srv.validateDiff({ update: [{ title: 'x' }] })); // id 없음 → 에러
  assert.ok(srv.validateDiff({ add: Array(501).fill({}) })); // 개수 초과 → 에러
  assert.equal(srv.validateDiff({ add: [{ title: 'ok' }], remove: ['id1'] }), null); // 정상 → null
});

t('D5 applyDiff 방어: done 불리언 강제 + 미허용 키 차단 (QA-m3)', () => {
  srv.saveData({ version: 1, items: [] });
  srv.applyDiff({ add: [{ title: 'X', done: 'yes-string', evil: 'x' }] });
  const it = srv.loadData().items[0];
  assert.strictEqual(it.done, true);                       // 'yes-string' → !! → true
  assert.equal(it.evil, undefined);                        // 화이트리스트 밖 키 차단
});

t('D6 applyDiff: 변경 0건이면 version 미증가 (QA-m2)', () => {
  srv.saveData({ version: 5, items: [] });
  const r = srv.applyDiff({ update: [{ id: 'ghost' }] });
  assert.equal(r.changed, 0);
  assert.equal(r.version, 5);                              // 미증가
  assert.equal(srv.loadData().version, 5);
});

t('D7 갭 마커는 src:api로 커밋되어 앵커를 오염시키지 않는다 (CR2)', () => {
  srv.feed.length = 0;
  srv.feed.push({ seq: 1, role: 'user', text: 'q1' }, { seq: 2, role: 'assistant', text: 'a1' });
  const mk = srv.commit({ role: 'marker', text: '⋯ 연결 끊김' }); // src 미지정 → 강제 부여돼야
  assert.equal(mk.src, 'api', '화면 부재 role은 src 강제(CR2)');
  // 마커가 원장 꼬리에 있어도 앵커는 화면 항목(q1,a1)으로 잡힌다
  const parsed = [{ role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1' }, { role: 'user', text: 'q2' }];
  assert.equal(srv.anchorIndex(parsed), 2);
});

t('D8 파서: v2.1.x 오버레이 ▔ 구분선 인식, 접힌 도구 요약 tool 승격 (CR3/coding-M1)', () => {
  // ▔ 오버레이가 입력 박스처럼 stripBottomUI로 절삭돼야(본문 오염 방지)
  const cap = ['⏺ 응답 본문', '', '▔▔▔▔▔▔▔▔', '❯ Select model', '▔▔▔▔▔▔▔▔', '  1. Default'].join('\n');
  const m = srv.parseTranscript(srv.stripBottomUI(cap));
  assert.deepEqual(m.map((x) => x.text), ['응답 본문']);
  // 마커 없는 접힌 도구 요약 → tool
  const m2 = srv.parseTranscript('❯ q\n\n⏺ Ran 1 shell command\n\n✻ Worked for 1s\n');
  assert.equal(m2[1].role, 'tool');
});

t('D9 inputBoxReady / dialogOpen 판정 (CR4)', () => {
  const box = ['⏺ 응답', '──────', '❯ ', '──────', '  status'].join('\n');
  assert.equal(srv.inputBoxReady(box), true);
  assert.equal(srv.inputBoxReady('welcome screen no box'), false);  // 콜드스타트
  const menu = ['⏺ 응답', '──────', '❯ 1. Yes', '──────'].join('\n');
  assert.equal(srv.inputBoxReady(menu), false);                     // 다이얼로그 메뉴는 미준비
  assert.equal(srv.dialogOpen(menu), true);
  assert.equal(srv.dialogOpen('▔▔▔▔▔ Select model'), true);
  assert.equal(srv.dialogOpen(box), false);
});

t('D3 앵커 정렬은 화면 유래 항목만 사용 (src:api 리치 항목이 앵커를 깨지 않음)', () => {
  srv.feed.length = 0;
  srv.feed.push(
    { seq: 1, role: 'user', text: 'q1' }, { seq: 2, role: 'assistant', text: 'a1' },
    { seq: 3, role: 'proposal', text: '변경 제안', src: 'api', pid: 1 },
    { seq: 4, role: 'system', text: '변경 적용 완료 (v2)', src: 'api' },
  );
  // 화면 파싱 결과에는 리치 항목이 없다 — 그래도 앵커는 화면 꼬리(q1, a1)로 잡혀야 한다
  const parsed = [{ role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1' }, { role: 'user', text: 'q2' }];
  assert.equal(srv.anchorIndex(parsed), 2);
  assert.equal(srv.matchesRunInFeed([{ role: 'user', text: 'q1' }, { role: 'assistant', text: 'a1' }]), true);
});

// ============================================================ Part B: 통합
async function integration() {
  console.log('\n[Part B] 통합 테스트 (tmux ana-selftest + mock_agent.py + :8811)');
  const FEED_FILE = path.join(SCRATCH, 'int-transcript.jsonl');
  // TMUX_SOCKET='' → 테스트가 mock 세션을 만든 기본 소켓을 서버도 사용(프로덕션 기본은 전용 ana-chat 소켓).
  const childEnv = {
    ...process.env, PORT: String(TEST_PORT), TMUX_SESSION: TEST_SESSION, TMUX_SOCKET: '',
    TRANSCRIPT_FILE: FEED_FILE, POLL_MS: '150',
    DATA_FILE: path.join(SCRATCH, 'int-state.json'), PROPOSALS_FILE: path.join(SCRATCH, 'int-proposals.json'),
    EVOLVE_FILE: path.join(SCRATCH, 'int-evolve.json'),
    // 사용자·감사·업로드도 스크래치로 격리 — 통합 실행이 실전 .ana/audit.jsonl 등을 오염시키지 않도록.
    USERS_FILE: path.join(SCRATCH, 'int-users.json'),
    AUDIT_FILE: path.join(SCRATCH, 'int-audit.jsonl'),
    UPLOAD_DIR: path.join(SCRATCH, 'int-uploads'),
    NOTIFY_AGENT: '0', ANA_READY_GUARD: '0', // 승인 알림 주입이 mock 에이전트 에코를 유발해 total 계산을 흔들지 않도록
  };
  delete childEnv.ANA_TEST;
  // ANA_PANE_ID는 resolveTarget에서 TMUX_SESSION보다 우선한다 — 개발자 셸에 남아 있으면 테스트가
  // 격리 세션 대신 실제 에이전트 페인에 주입할 수 있으므로 자식 환경에서 제거한다.
  delete childEnv.ANA_PANE_ID;

  const sh = (args) => execFileSync('tmux', args, { stdio: 'pipe' });
  try { sh(['kill-session', '-t', TEST_SESSION]); } catch { }
  sh(['new-session', '-d', '-s', TEST_SESSION, '-x', '80', '-y', '30', 'python3', path.join(ROOT, 'mock_agent.py')]);

  let server = spawn('node', [path.join(ROOT, 'server.js')], { env: childEnv, stdio: 'ignore' });
  const api = `http://localhost:${TEST_PORT}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const feed = async () => (await fetch(`${api}/api/feed`)).json();
  const chat = (text, submit = true) => fetch(`${api}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, submit }) });
  const waitTotal = async (n, timeout = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const d = await feed().catch(() => null);
      if (d && d.total >= n) return d;
      await sleep(200);
    }
    throw new Error(`timeout: total<${n} (현재 ${(await feed().catch(() => ({ total: '?' }))).total})`);
  };

  try {
    await sleep(1200);

    await ta('I1 health: 서버·세션 생존', async () => {
      const h = await (await fetch(`${api}/api/health`)).json();
      assert.equal(h.server, true);
      assert.equal(h.session, true);
    });

    await ta('I2 왕복: user+assistant 정확히 1회 확정', async () => {
      await chat('hello');
      const d = await waitTotal(2);
      assert.equal(d.items[0].role, 'user');
      assert.equal(d.items[0].text, 'hello');
      assert.equal(d.items[1].role, 'assistant');
      assert.equal(d.items[1].text, 'Hello there!');
      await sleep(1500);
      assert.equal((await feed()).total, 2, '안정성: 중복 재적재 없음');
    });

    await ta('I3 단어 경계 하드랩 → 공백 join', async () => {
      await chat('wrap');
      const d = await waitTotal(4);
      assert.equal(d.items[3].text, 'x'.repeat(70) + ' yy tail-continues.');
    });

    await ta('I4 폭에 꽉 찬 경로 절단 → 무공백 join', async () => {
      await chat('path');
      const d = await waitTotal(6);
      const t6 = d.items[5].text;
      assert.ok(t6.includes('a'.repeat(10) + 'bbb.txt'), `무공백 join 실패: ${JSON.stringify(t6.slice(-20))}`);
      assert.ok(!t6.includes(' bbb.txt'));
    });

    await ta('I5 한글 하드랩 → 공백 join', async () => {
      await chat('korean');
      const d = await waitTotal(8);
      assert.equal(d.items[7].text, '가'.repeat(36) + ' 끝 이어짐');
    });

    await ta('I6 문단(빈 줄) 보존', async () => {
      await chat('para');
      const d = await waitTotal(10);
      assert.equal(d.items[9].text, 'First paragraph.\n\nSecond paragraph.');
    });

    await ta('I7 목록 줄바꿈 보존', async () => {
      await chat('list');
      const d = await waitTotal(12);
      assert.equal(d.items[11].text, 'Items:\n- one\n- two');
    });

    await ta('I8 멀티라인 paste 무결성 (3줄 → 한 메시지)', async () => {
      await chat('multi\n둘째 줄\n셋째 줄');
      const d = await waitTotal(14);
      assert.ok(d.items[12].text.includes('multi'), 'user 에코');
      assert.ok(d.items[12].text.includes('셋째 줄'));
      assert.equal(d.items[13].text, 'GOT:3');
    });

    await ta('I9 submit:false + /api/keys enter로 제출', async () => {
      await chat('keytest', false);
      await sleep(400);
      await fetch(`${api}/api/keys`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'enter' }) });
      const d = await waitTotal(16);
      assert.equal(d.items[15].text, 'KEYOK');
    });

    await ta('I10 서버 재시작: 원장 복원 + 재적재 없음', async () => {
      const before = (await feed()).total;
      server.kill();
      await sleep(500);
      server = spawn('node', [path.join(ROOT, 'server.js')], { env: childEnv, stdio: 'ignore' });
      await sleep(2500);
      assert.equal((await feed()).total, before, '재시작 후 중복');
      await chat('hello2');
      const d = await waitTotal(before + 2);
      assert.equal(d.items[d.items.length - 1].text, 'echo: hello2');
    });

    await ta('I11 SSE: 접속 즉시 snapshot(원장 전체) 수신', async () => {
      const res = await fetch(`${api}/api/stream`);
      const reader = res.body.getReader();
      const { value } = await reader.read();
      reader.cancel();
      const txt = new TextDecoder().decode(value);
      const m = txt.match(/data: (.*)/);
      const snap = JSON.parse(m[1]);
      assert.equal(snap.kind, 'snapshot');
      assert.ok(Array.isArray(snap.messages) && snap.messages.length >= 16);
    });

    // (copy-mode 자동 해제(M4)는 격리·수동 재현으로 검증됨. 통합 테스트는 copy-mode가 세션 상태를
    //  불안정하게 만들어 후속 케이스를 연쇄 실패시키므로 스위트에서 제외한다.)

    // ---------------------------------------- Part C: 대시보드 API
    // (I13 draft 가드보다 먼저 실행 — mock의 draftbox는 입력 박스를 화면에 남겨
    //  이후 /api/chat이 계속 409가 되므로 draft 케이스는 맨 마지막이어야 한다.)
    console.log('\n[Part C] 대시보드 API 통합 (/api/state · /api/agent · /api/approve · /api/done)');
    const state = async () => (await fetch(`${api}/api/state`)).json();
    const post = (p, body) => fetch(`${api}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let pid = 0, itemId = '';

    await ta('C1 /api/state: 초기 {version, items[]}', async () => {
      const s = await state();
      assert.ok(Number.isInteger(s.version) && s.version >= 1);
      assert.ok(Array.isArray(s.items));
    });

    await ta('C2 /api/agent diff 제안 → proposal(pending) + 원장 proposal 항목', async () => {
      const t0 = (await feed()).total;
      const r = await post('/api/agent', { text: '영어 7시 추가 제안', diff: { add: [{ title: '영어 7시' }] } });
      const j = await r.json();
      assert.ok(j.ok && j.pid, `pid 기대: ${JSON.stringify(j)}`);
      pid = j.pid;
      const d = await waitTotal(t0 + 1);
      const last = d.items[d.items.length - 1];
      assert.equal(last.role, 'proposal');
      assert.equal(last.pid, pid);
      assert.equal(last.src, 'api');
      const s = await state();
      const pr = (s.proposals || []).find((x) => x.id === pid);
      assert.equal(pr && pr.status, 'pending');
    });

    await ta('C3 /api/approve 승인 → diff 적용 + version++ + system 원장 항목', async () => {
      const v0 = (await state()).version;
      const t0 = (await feed()).total;
      const r = await post('/api/approve', { pid, decision: 'approve' });
      const j = await r.json();
      assert.ok(j.ok && j.applied);
      assert.equal(j.version, v0 + 1);
      const s = await state();
      const it = s.items.find((x) => x.title === '영어 7시');
      assert.ok(it, '승인된 항목이 items에 반영돼야 함');
      itemId = it.id;
      // QA-M6: /api/state는 pending 제안만 노출 → applied 제안은 목록에서 빠진다(좀비 카드 방지)
      assert.ok(!(s.proposals || []).some((x) => x.id === pid), 'applied 제안은 /api/state pending 목록에서 제외');
      const d = await waitTotal(t0 + 1);
      assert.equal(d.items[d.items.length - 1].role, 'system');
      // 재승인 방지
      assert.equal((await post('/api/approve', { pid, decision: 'approve' })).status, 400);
    });

    await ta('C4 /api/done 토글 → version++ + 서버 저장', async () => {
      const v0 = (await state()).version;
      const r = await post('/api/done', { id: itemId, done: true });
      const j = await r.json();
      assert.ok(j.ok && j.done === true);
      assert.equal(j.version, v0 + 1);
      assert.equal((await state()).items.find((x) => x.id === itemId).done, true);
    });

    await ta('C5 /api/agent 텍스트 → assistant(src:api) 원장 확정 + /api/feed version 노출', async () => {
      const t0 = (await feed()).total;
      await post('/api/agent', { text: '리치 텍스트 응답' });
      const d = await waitTotal(t0 + 1);
      const last = d.items[d.items.length - 1];
      assert.equal(last.role, 'assistant');
      assert.equal(last.src, 'api');
      assert.ok(Number.isInteger(d.version), '/api/feed에 version 포함(폴링 동기화)');
    });

    await ta('C6 리치 항목 뒤에도 화면 왕복이 계속 확정됨 (앵커 생존)', async () => {
      const t0 = (await feed()).total;
      await chat('hello3');
      const d = await waitTotal(t0 + 2, 10000);
      const tail = d.items.slice(-2);
      assert.equal(tail[0].text.includes('hello3'), true, `hello3 왕복 기대: ${JSON.stringify(tail.map((x) => x.text))}`);
      assert.equal(tail[1].text, 'echo: hello3');
    });

    await ta('C7 진화 탭: /api/evolve 등록 → 조회 → do/ignore 처리 + version++', async () => {
      let r = await post('/api/evolve', { proposals: [{ type: 'add', title: '음성 입력', desc: 'Web Speech 마이크' }, { type: 'improve', title: '정렬 개선' }] });
      const j = await r.json();
      assert.ok(j.ok && j.ids.length === 2, JSON.stringify(j));
      let ev = await (await fetch(`${api}/api/evolve`)).json();
      const v0 = ev.version;
      assert.equal(ev.proposals.filter((x) => x.status === 'new').length, 2);
      assert.equal(ev.proposals[0].type, 'add');
      r = await post('/api/evolve-act', { id: j.ids[0], action: 'do' });
      assert.equal((await r.json()).status, 'doing');
      r = await post('/api/evolve-act', { id: j.ids[1], action: 'ignore' });
      assert.equal((await r.json()).status, 'dismissed');
      ev = await (await fetch(`${api}/api/evolve`)).json();
      assert.equal(ev.version, v0 + 2);
      assert.equal((await post('/api/evolve-act', { id: 999, action: 'do' })).status, 404);
      assert.equal((await post('/api/evolve', { proposals: [] })).status, 400);
    });

    await ta('C8 경계: null 본문 → 400 (500 아님) 전 POST (QA-M1)', async () => {
      const bad = (p) => fetch(`${api}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null' });
      for (const p of ['/api/agent', '/api/approve', '/api/apply', '/api/done', '/api/evolve', '/api/evolve-act']) {
        assert.equal((await bad(p)).status, 400, `${p} null 본문 400 기대`);
      }
    });

    await ta('C9 경계: 깨진 diff → 400 좀비 제안 없음 (QA-C2)', async () => {
      assert.equal((await post('/api/agent', { text: 'x', diff: { add: 'abc' } })).status, 400);
      assert.equal((await post('/api/agent', { text: 'x', diff: { add: ['문자열'] } })).status, 400);
      assert.equal((await post('/api/apply', { diff: { update: [{ title: 'no-id' }] } })).status, 400);
    });

    await ta('C10 경계: decision 오타 → 400 (제안 파괴 안 됨 — QA-M2)', async () => {
      const j = await (await post('/api/agent', { text: '제안', diff: { add: [{ title: 'z' }] } })).json();
      assert.equal((await post('/api/approve', { pid: j.pid, decision: 'BOGUS' })).status, 400);
      // 여전히 pending인지
      const s = await state();
      assert.ok(s.proposals.some((x) => x.id === j.pid && x.status === 'pending'), '오타 decision은 제안을 파괴하지 않음');
      await post('/api/approve', { pid: j.pid, decision: 'reject' }); // 정리
    });

    await ta('C11 경계: /api/agent text MAX_TEXT 초과 → 413 (QA-M3)', async () => {
      const big = 'Y'.repeat(9000);
      assert.equal((await post('/api/agent', { text: big })).status, 413);
    });

    await ta('C12 diff 필드 방어: 객체 title은 버리고 done은 불리언, 긴 text는 캡(오픈 이슈 #2)', async () => {
      const bigText = 'x'.repeat(30000);
      const r = await post('/api/apply', { diff: { add: [{ title: { evil: 1 }, text: bigText, done: 'yes' }] } });
      assert.equal(r.status, 200);
      const s = await state();
      const it = s.items[s.items.length - 1];
      assert.equal(typeof it.title, 'string'); assert.equal(it.title, '', '객체 title은 빈 문자열로 환원');
      assert.equal(it.done, true, 'done 문자열 → 불리언 true');
      assert.ok(it.text.length <= 20000, `text는 20000자로 캡(실제 ${it.text.length})`);
      await post('/api/apply', { diff: { remove: [it.id] } }); // 정리
    });

    await ta('C13 알림 커서: 무효 since는 큐 전체가 아니라 빈 목록 반환(오픈 이슈 #5)', async () => {
      // 제안 생성→거절로 알림 하나 큐잉(NOTIFY_AGENT=0라 미전달로 큐에 남는다)
      const j = await (await post('/api/agent', { text: 'notify-src', diff: { add: [{ title: 'n' }] } })).json();
      await post('/api/approve', { pid: j.pid, decision: 'reject' });
      const all = await (await fetch(`${api}/api/notifications`)).json();
      assert.ok(all.notifications.length >= 1, '거절 알림이 큐에 있어야 함');
      const ids = all.notifications.map((n) => n.id);
      assert.equal(new Set(ids).size, ids.length, '알림 id는 유일해야 함(카운터 접미)');
      const bogus = await (await fetch(`${api}/api/notifications?since=does-not-exist-000`)).json();
      assert.equal(bogus.notifications.length, 0, '무효 커서 → 빈 목록(큐 재생 금지)');
    });

    await ta('I13 draft 가드: 터미널 입력창에 미제출 텍스트 있으면 /api/chat 409 (맨 마지막 — 입력 박스가 화면에 남음)', async () => {
      await chat('draftbox 미리 입력한 문장');           // mock이 입력 박스를 렌더한 채 멈춤
      await sleep(600);                                    // 폴이 extractDraft로 lastDraft 채우기 대기
      const r = await chat('이건 막혀야 함');
      assert.equal(r.status, 409, `draft 있을 때 409 기대, 실제 ${r.status}`);
      const e = await r.json().catch(() => ({}));
      assert.ok(/unsent text/.test(e.error || ''), `draft 가드 메시지 기대: ${JSON.stringify(e)}`);
      assert.equal(e.recoverable, 'ctrl-u', 'recoverable 힌트 제공(프론트 자동 재전송 근거)');
    });

    await ta('I14 force: draft 있어도 force=true면 입력창 비우고 주입(200) — remote-C1 우회', async () => {
      // I13 직후: draftbox draft가 여전히 남아 있는 상태
      const r = await fetch(`${api}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'forced-msg', force: true }) });
      assert.equal(r.status, 200, `force면 draft 무시하고 200 기대, 실제 ${r.status}`);
    });
  } finally {
    server.kill();
    try { sh(['kill-session', '-t', TEST_SESSION]); } catch { }
  }
}

integration().then(() => {
  console.log(`\n결과: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}).catch((e) => {
  console.error('통합 테스트 러너 오류:', e);
  console.log(`\n결과: ${passed} passed, ${failed} failed (+러너 오류)`);
  process.exit(1);
});
