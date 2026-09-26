'use strict';
// seed.js — 처음 뜬 기본 워크스페이스에 넣는 예제 두 개. 메모 → 할일 → 일정 관계(NodeRel)를 바로 볼 수 있게 한다.
// 날짜는 오늘 기준 상대값이라 언제 설치해도 달력에 가까운 일정으로 보인다. ANA_SEED=0이면 넣지 않는다.
//
//  예제 1  Workshop planning(메모) ─SPAWNED→ Book the venue · Send invitations · Prepare slides(할일)
//          Workshop day(일정) ←SPAWNED─ 메모,  Prepare slides ─SCHEDULED_AS→ Slide-writing block(일정)
//          Send invitations ─REFERS_TO→ Workshop day
//  예제 2  Client feedback — Acme(메모) ─SPAWNED→ Fix the login bug(완료) · Send the revised quote(기한 없음)
//          Acme follow-up call(일정) ←SPAWNED─ 메모,  follow-up call ─REFERS_TO→ Send the revised quote
//          → Stats의 Connections에 '기한 없는 할일'·'시간 안 잡힌 할일'이 실제로 잡혀 보인다.

function day(offset) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function seedState() {
  const now = new Date().toISOString();
  const link = (from, to, type) => ({ from, to, type, at: now, by: 'ana' });
  return {
    version: 1,
    notes: [
      { id: 'n-ex-workshop', title: 'Workshop planning', by: 'ana', updatedAt: now,
        text: 'Spring workshop for the team — 20 people, one day.\n\n- Book the venue\n- Send invitations\n- Prepare slides\n\nSelect a line and press → Task or → Event to turn it into work.' },
      { id: 'n-ex-acme', title: 'Client feedback — Acme', by: 'ana', updatedAt: now,
        text: 'Call notes from Acme.\n\n- Login fails on Safari → fix the login bug\n- They want a revised quote with the extra seats\n- Follow up by phone after both are done' },
    ],
    items: [
      { id: 'a-ex-venue', title: 'Book the venue', due: day(3), done: false, by: 'ana' },
      { id: 'a-ex-invite', title: 'Send invitations', due: day(5), done: false, by: 'ana' },
      { id: 'a-ex-slides', title: 'Prepare slides', due: day(10), done: false, by: 'ana' },
      { id: 'a-ex-login', title: 'Fix the login bug', due: day(1), done: true, by: 'ana' },
      { id: 'a-ex-quote', title: 'Send the revised quote', done: false, by: 'ana' },
    ],
    events: [
      { id: 'e-ex-workshop', title: 'Workshop day', date: day(14), time: '09:00', done: false, by: 'ana' },
      { id: 'e-ex-slides', title: 'Slide-writing block', date: day(8), time: '10:00', done: false, by: 'ana' },
      { id: 'e-ex-acme', title: 'Acme follow-up call', date: day(4), time: '15:00', done: false, by: 'ana' },
    ],
    links: [
      link('n-ex-workshop', 'a-ex-venue', 'SPAWNED'),
      link('n-ex-workshop', 'a-ex-invite', 'SPAWNED'),
      link('n-ex-workshop', 'a-ex-slides', 'SPAWNED'),
      link('n-ex-workshop', 'e-ex-workshop', 'SPAWNED'),
      link('a-ex-slides', 'e-ex-slides', 'SCHEDULED_AS'),
      link('a-ex-invite', 'e-ex-workshop', 'REFERS_TO'),
      link('n-ex-acme', 'a-ex-login', 'SPAWNED'),
      link('n-ex-acme', 'a-ex-quote', 'SPAWNED'),
      link('n-ex-acme', 'e-ex-acme', 'SPAWNED'),
      link('e-ex-acme', 'a-ex-quote', 'REFERS_TO'),
    ],
  };
}

module.exports = { seedState };
