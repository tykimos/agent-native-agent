'use strict';
// work-ontology.js — 워크 온톨로지: 이 ANA의 업무 항목이 어떤 종류이고 서로 어떻게 이어지는지.
// Knowledge › Ontology의 'Work' 층이 이 선언을 그대로 보이고, graph-index.js가 이걸로 업무 항목과 연결을 그래프로 만든다.
//
// 에이전트가 Work 화면을 새로 만들면(견적·리드·주문…) 그 데이터를 work-graph.json에 종류마다 배열 하나로 두고
// 여기에 종류를 선언한다. 그러면 그 항목이 지식그래프와 한 그래프에 들어간다(개체의 items, 사실의 끝점).
//
// classes:   { id, label, desc, list, title }
//            list  = work-graph.json에서 이 종류의 항목이 든 배열 이름(없으면 계산되는 노드 — Day)
//            title = 항목의 이름을 정하는 함수(없으면 title → name → text 첫 줄)
// relations: { id, label, desc, from[], to[], made, field }
//            made: 'explicit' — 사람·에이전트가 연결로 만든다(work-graph.json links[], POST /api/link)
//                  'derived'  — 항목의 필드에서 계산한다. field = 'Class.prop'
//                               to가 Day면 그 필드의 날짜(YYYY-MM-DD)로, 아니면 그 필드의 id(하나 또는 배열)로 잇는다
//                               예) { id: 'QUOTE_FOR', from: ['Quote'], to: ['Lead'], made: 'derived', field: 'Quote.lead' }

const firstLine = (s) => String(s || '').trim().split('\n')[0].slice(0, 60);

module.exports = {
  classes: [
    { id: 'Note', label: 'Note', list: 'notes', desc: 'A note', title: (x) => String(x.title || '').trim() || firstLine(x.text) || 'Untitled' },
    { id: 'Task', label: 'Task', list: 'items', desc: 'A task to do', title: (x) => String(x.title || x.text || '') },
    { id: 'Event', label: 'Event', list: 'events', desc: 'A calendar event', title: (x) => String(x.title || '') },
    { id: 'Day', label: 'Day', desc: 'A calendar day (computed from dates)' },
  ],
  relations: [
    { id: 'SPAWNED', label: 'spawned', from: ['Note'], to: ['Task', 'Event'], made: 'explicit', desc: 'The note is where this task or event came from' },
    { id: 'SCHEDULED_AS', label: 'scheduled as', from: ['Task'], to: ['Event'], made: 'explicit', desc: 'The task is worked on during this calendar event (time block)' },
    { id: 'REFERS_TO', label: 'refers to', from: ['*'], to: ['*'], made: 'explicit', desc: 'Manual reference between two work items' },
    { id: 'DUE_ON', label: 'due on', from: ['Task'], to: ['Day'], made: 'derived', field: 'Task.due', desc: 'The task is due on this day (from Task.due)' },
    { id: 'ON', label: 'on', from: ['Event'], to: ['Day'], made: 'derived', field: 'Event.date', desc: 'The event happens on this day (from Event.date)' },
  ],
};
