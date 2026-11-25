'use strict';
// work-ontology.js — 워크 온톨로지: 이 ANA의 업무 항목이 어떤 종류이고 서로 어떻게 이어지는지.
// Knowledge › Ontology가 이 선언을 그대로 보이고, graph-index.js가 이걸로 업무 항목과 연결을 그래프로 만든다.
//
// 베이스는 아무 종류도 선언하지 않는다 — Work 화면이 없는 ANA의 그래프는 비어 있어야 맞다.
// 에이전트가 PRD에서 Work 화면을 만들면(견적·리드·주문…) 그 데이터를 work-graph.json에 종류마다 배열 하나로 두고
// 여기에 종류를 선언한다. 그러면 그 항목이 지식그래프와 한 그래프에 들어가고(개체의 items, 사실의 끝점),
// 데이터 변경 제안(POST /api/agent {diff:{add:[{list:'quotes', …}]}})이 그 배열에 적용된다.
//
// 자세한 형식·버전 규칙·순서는 skills/ontology/SKILL.md.
//
// meta:        { version, modified, creator, lang } — 온톨로지를 고칠 때마다 version을 올린다(이름 바꿈·삭제 = 앞자리, 추가 = 가운데, 글만 = 끝자리)
// description: [[소제목, [[문장, ['C:Quote', 'R:quoteFor', 'P:Quote.amount', 'RULE:R1']], …]], …] — Knowledge › Ontology의 설명 글
// classes:   { id, label, desc, list, title, align[], props[] }
//            list  = work-graph.json에서 이 종류의 항목이 든 배열 이름
//            title = 항목의 이름을 정하는 함수(없으면 title → name → text 첫 줄)
//            align = 표준 상위 개념(예: 'prov:Entity') → rdfs:subClassOf
//            props = Datatype Property { id, label, type: 'xsd:string'…, values?, many?, who?, desc, sub? }
// relations: { id, label, desc, from[], to[], made, field, functional?, align[]? }
//            id는 lowerCamelCase(quoteFor) — 옛 UPPER_SNAKE(QUOTE_FOR)도 읽지만 새로 쓰지 않는다
//            functional: true = 하나만(owl:FunctionalProperty)
//            made: 'explicit' — 사람·에이전트가 연결로 만든다(work-graph.json links[], POST /api/link)
//                  'derived'  — 항목의 필드에서 계산한다. field = 'Class.prop'
//                               to가 Day면 그 필드의 날짜(YYYY-MM-DD)로 Day 노드(day:YYYY-MM-DD)를 만들어 잇고,
//                               아니면 그 필드의 id(하나 또는 배열)로 잇는다
//
// 예) 견적 ANA:
//   classes: [
//     { id: 'Lead',  label: 'Lead',  list: 'leads',  desc: 'A company that asked for a price', title: (x) => x.name },
//     { id: 'Quote', label: 'Quote', list: 'quotes', desc: 'A price we sent' },
//     { id: 'Day',   label: 'Day',   desc: 'A calendar day (computed from dates)' },
//   ],
//   relations: [
//     { id: 'quoteFor', label: 'quote for', from: ['Quote'], to: ['Lead'], made: 'derived',  field: 'Quote.lead', functional: true, desc: 'The lead this quote was sent to' },
//     { id: 'sentOn',   label: 'sent on',   from: ['Quote'], to: ['Day'],  made: 'derived',  field: 'Quote.sentAt' },
//     { id: 'refersTo', label: 'refers to', from: ['*'],     to: ['*'],    made: 'explicit', desc: 'Manual reference between two work items' },
//   ],
//   rules: [ { id: 'R1', label: 'A sent quote has an amount', on: ['Quote'], shacl: 'sh:targetClass {C:Quote} ; sh:property [ sh:path {P:Quote.amount} ; sh:minCount 1 ]' } ],
//   (규칙을 지금 데이터로 검사하려면 옆에 work-rules.js — checkRules(lists) → { R1: {checked, bad, unknown, unknownWhy, examples} })

module.exports = {
  classes: [],
  relations: [],
};
