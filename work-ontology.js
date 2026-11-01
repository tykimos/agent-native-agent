'use strict';
// work-ontology.js — 워크 온톨로지: 이 ANA의 코드가 저장하는 워크 항목의 클래스와 그 연결 관계(그리고 계산 규칙).
// 업무 프로세스가 돌아가는 데 필요한 것 — 업무가 다루는 항목의 클래스와 그 흐름(연결 관계), 계산 규칙. 코드와 함께 바뀐다.
//
// 도메인 ANA(예: DAS)는 자기 데이터 모델을 여기에 선언한다 — 메모·할일·일정이 없으면 Note·Task·Event도 없다.
// graph-index.js(NodeRel 스냅숏)의 규칙과 설명은 이 선언에서 읽는다.
//
// classes:   { id, desc, title }            title = NodeRel 노드 제목이 무엇인지
// relations: { id, desc, from[], to[], made }
//            made: 'explicit' — 사람·에이전트가 연결로 만든다(work-graph.json links[], NodeRel에서 추가·삭제 가능)
//                  'derived'  — 앱이 필드에서 계산한다(field가 출처)

const WORK = ['Note', 'Task', 'Event'];

module.exports = {
  classes: [
    { id: 'Note', desc: 'A note', title: 'Note title (or its first line)' },
    { id: 'Task', desc: 'A task to do', title: 'Task title' },
    { id: 'Event', desc: 'A calendar event', title: 'Event title' },
    { id: 'Day', desc: 'A calendar day', title: 'Date YYYY-MM-DD' },
  ],
  relations: [
    { id: 'SPAWNED', from: ['Note'], to: ['Task', 'Event'], made: 'explicit', desc: 'The note is where this task or event came from' },
    { id: 'SCHEDULED_AS', from: ['Task'], to: ['Event'], made: 'explicit', desc: 'The task is worked on during this calendar event (time block)' },
    { id: 'REFERS_TO', from: WORK, to: WORK, made: 'explicit', desc: 'Manual reference between two notes, tasks or events' },
    { id: 'DUE_ON', from: ['Task'], to: ['Day'], made: 'derived', field: 'Task.due', desc: 'The task is due on this day (derived from Task.due)' },
    { id: 'ON', from: ['Event'], to: ['Day'], made: 'derived', field: 'Event.date', desc: 'The event happens on this day (derived from Event.date)' },
  ],
};
