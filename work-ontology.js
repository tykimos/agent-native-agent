'use strict';
// work-ontology.js — 워크 온톨로지: 이 ANA의 코드가 저장하는 워크 항목의 클래스와 그 연결 관계(그리고 계산 규칙).
//
// 온톨로지는 두 층이다(워크 · 지식).
//   워크 층   여기. 이 앱이 실제로 저장하고 만드는 워크 항목의 종류와 연결 종류. 코드가 바뀌면(기능을 더하거나 빼면) 이 파일도 같은 커밋에서 바뀐다.
//             실행 중에는 읽기 전용 — 관리자 편집 폼으로는 바뀌지 않는다.
//   지식 층   .ana/ontology.json. 워크에서 알아낸 것의 종류(고객·담당자·…). 관리자가 System › Ontology에서 다듬는다.
//
// 도메인 ANA(예: DAS)는 자기 데이터 모델을 여기에 선언한다 — 메모·할일·일정이 없으면 Note·Task·Event도 없다.
// graph.js(NodeRel 스냅숏)의 규칙과 설명은 이 선언에서 읽는다. test.cjs C20이 "실제로 만드는 노드·관계 = 선언"을 확인한다.
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
