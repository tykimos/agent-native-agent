/* studio.js — 콘텐츠 스튜디오 프론트
   · 왼쪽 본문(오버레이 없음) + 오른쪽 사이드 채팅(ANA)
   · 뷰: 쪽맞춤/폭맞춤/100%/확대·축소  · 선택영역 유지 + Shift 다중선택
   · 칩은 채팅창에만  · 안쪽(iframe) 스크롤 제거  · 의존성 0 */
(() => {
  /* ▼▼ 프로젝트별 설정 — 여기 5개만 바꾸면 임의 문서에 이식된다 ▼▼
   *   (원본 키트는 특정 교재의 라우트·주차 라벨·컴포넌트 분류가 본문에 하드코딩돼 있었다.) */
  const DOC_URL = '/document.html';      // 뷰어 iframe이 부르는 문서 라우트(studio-server.mjs의 DOC_ROUTE와 동일)
  const DOC_NAME = 'Document v1';        // 사이드바 위치 표시 접두어
  const ANCHOR_RE = /\b(W\d+|Q\d+|Part\s?\d+|Day\s?\d+|§\s?\d+|\d+\.\d+)\b/;  // 칩 라벨로 뽑을 '근처 앵커' 패턴
  // 페이지 번호 → 섹션(장/주차) 라벨. 문서 구조에 맞게 교체.
  const sectionOf = (page) => 's' + Math.max(1, Math.ceil(page / 50));
  // 요소 → 컴포넌트 종류 라벨(칩에 표시, 세션이 대상 종류를 파악하는 데 쓰임). 문서 도메인에 맞게 교체.
  const componentOf = (el) => {
    const near = (el.closest('section,div')?.textContent || '').slice(0, 60);
    const own = el.textContent.trim();
    if (/^#{1,6}\s|^[0-9]+\.\s/.test(own) || /^H[1-4]$/.test(el.tagName)) return '제목';
    if (el.tagName === 'TABLE' || el.tagName === 'TR') return '표';
    if (el.tagName === 'LI') return '목록 항목';
    if (/그림|figure|caption/i.test(near)) return '그림/캡션';
    return '요소';
  };
  /* ▲▲ 프로젝트별 설정 끝 ▲▲ */

  const TOKEN = new URLSearchParams(location.search).get('token') || '';
  const H = TOKEN ? { authorization: 'Bearer ' + TOKEN } : {};
  const api = (p, opt = {}) => fetch(p + (p.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(TOKEN), { ...opt, headers: { 'content-type': 'application/json', ...H, ...(opt.headers || {}) } });
  const $ = s => document.querySelector(s);
  const esc = s => (s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const isDesktop = () => matchMedia('(min-width:900px)').matches;

  const frame = $('#frame');
  let pages = [], curPage = 1, chips = [], selEls = [], lastMsg = 0, seenProp = new Set();
  let S = 1, fitMode = isDesktop() ? 'height' : 'width', manualScale = 1;

  // ---- iframe 문서 로드 ----
  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    pages = [...doc.querySelectorAll('.page')];
    injectPickCSS(doc);
    fit(false);
    setTimeout(() => fit(), 500);   // 폰트/늦은 레이아웃 정착 후 1회 재맞춤(앵커 유지)
    doc.addEventListener('mouseover', e => { const el = pickable(e.target); if (el && !el.classList.contains('sel')) el.classList.add('hl-outline'); });
    doc.addEventListener('mouseout', e => { const el = pickable(e.target); if (el) el.classList.remove('hl-outline'); });
    doc.addEventListener('click', e => { const el = pickable(e.target); if (!el) return; e.preventDefault(); pick(el, e); }, true);
    $('#viewwrap').addEventListener('scroll', trackPage, { passive: true });
    trackPage();
  });
  function injectPickCSS(doc) {
    const s = doc.createElement('style');
    // 안쪽 스크롤바 제거(이중 스크롤 방지) + 호버/선택 표시
    s.textContent = 'html,body{overflow:hidden!important}'
      + '.hl-outline{outline:3px dashed #BF3D1C!important;outline-offset:1px;cursor:pointer}'
      + '.sel{outline:3px solid #5FBFA6!important;outline-offset:1px;background:rgba(95,191,166,.14)!important;cursor:pointer}';
    doc.head.appendChild(s);
  }

  // ---- 폭맞춤/쪽맞춤/100%/확대·축소 ----
  function fit(keepAnchor = true) {
    try {
      const doc = frame.contentDocument, de = doc.documentElement, wrap = $('#viewwrap');
      // 현재 상단에 걸린 페이지를 앵커로 기억 → 재맞춤/리사이즈 때 같은 페이지 유지(튐 방지)
      let aIdx = 0, aFrac = 0;
      if (keepAnchor && pages.length && S) {
        const top = wrap.scrollTop;
        for (let i = 0; i < pages.length; i++) if (pages[i].offsetTop * S <= top + 1) aIdx = i;
        const aTop = pages[aIdx].offsetTop * S, aH = (pages[aIdx].offsetHeight * S) || 1;
        aFrac = (top - aTop) / aH;
      }
      // 페이지 고정폭(148mm≈559px)을 기준 — scrollWidth/offsetLeft은 뷰포트·overflow:hidden·가운데정렬에
      // 의존해 불안정하고 frame폭에 되먹임돼 "여러 번 눌러야 맞는" 수렴 버그를 유발한다.
      const pageW = pages.length ? Math.max(...pages.map(p => p.offsetWidth)) : (doc.body.scrollWidth || 559);
      const pageH = pages.length ? pages[0].offsetHeight : (doc.body.scrollHeight || 793);
      const natW = pageW;
      const natH = pages.length ? (pages[pages.length - 1].offsetTop + pages[pages.length - 1].offsetHeight) : doc.body.scrollHeight;
      const wrapW = wrap.clientWidth, wrapH = wrap.clientHeight;
      frame.style.width = natW + 'px'; frame.style.height = natH + 'px';
      if (fitMode === 'width') S = wrapW / natW;
      else if (fitMode === 'height') S = Math.min(wrapH / pageH, wrapW / pageW);
      else if (fitMode === '100') S = 1;
      else S = manualScale;
      frame.style.transform = 'scale(' + S + ')';
      const scaledW = natW * S;
      frame.style.left = Math.max(0, (wrapW - scaledW) / 2) + 'px';
      const stage = $('#stage');
      stage.style.height = (natH * S) + 'px';
      stage.style.width = Math.max(wrapW, scaledW) + 'px';
      wrap.style.overflowX = (scaledW > wrapW + 1) ? 'auto' : 'hidden';
      // 앵커 복원 → 스크롤 위치가 같은 페이지에 머물게
      if (keepAnchor && pages.length) {
        const aTop = pages[aIdx].offsetTop * S, aH = pages[aIdx].offsetHeight * S;
        wrap.scrollTop = Math.round(aTop + aFrac * aH);
      }
      syncToolbar();
    } catch { }
  }
  function syncToolbar() {
    document.querySelectorAll('#toolbar [data-fit]').forEach(b => b.classList.toggle('on', b.dataset.fit === fitMode));
    const lbl = $('#zoomLbl'); if (lbl) lbl.textContent = Math.round(S * 100) + '%';
  }
  document.querySelectorAll('#toolbar [data-fit]').forEach(b => b.onclick = () => { fitMode = b.dataset.fit; fit(); });
  $('#zoomIn').onclick = () => { manualScale = Math.min(3, S * 1.15); fitMode = 'manual'; fit(); };
  $('#zoomOut').onclick = () => { manualScale = Math.max(.2, S / 1.15); fitMode = 'manual'; fit(); };

  // ---- 피킹 대상 ----
  function pickable(t) {
    let el = t;
    for (let i = 0; i < 6 && el && el !== frame.contentDocument.body; i++) {
      if (el.matches && el.matches('.page,.page *')) {
        if (el.tagName && /^(SECTION|DIV|LI|P|TR|TABLE|SPAN|H[1-4])$/.test(el.tagName) && el.textContent.trim().length > 1) return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  // 요소를 바로 찾을 수 있는 위치정보 수집
  function domPath(el) {
    const page = el.closest('.page'); if (!page) return '';
    const parts = [];
    for (let cur = el; cur && cur !== page; cur = cur.parentElement) {
      let sel = cur.tagName.toLowerCase();
      let i = 1; for (let sib = cur; (sib = sib.previousElementSibling);) if (sib.tagName === cur.tagName) i++;
      sel += ':nth-of-type(' + i + ')';
      const cls = (typeof cur.className === 'string' ? cur.className : '').trim().split(/\s+/).filter(c => c && !/^(hl-outline|sel)$/.test(c)).slice(0, 2);
      if (cls.length) sel += '.' + cls.join('.');
      parts.unshift(sel);
    }
    return `.page[${pages.indexOf(page) + 1}] ` + parts.join(' > ');
  }
  function contextText(el) {
    const c = el.closest('section, li, tr, table') || el.closest('.page') || el;
    return c.textContent.trim().replace(/\s+/g, ' ').slice(0, 400);
  }
  function nearAnchor(el) {
    const near = (el.closest('section,div,li,tr')?.textContent || '');
    const m = near.match(ANCHOR_RE);   // 패턴은 상단 '프로젝트별 설정'
    return m ? m[1] : '';
  }
  function briefEl(el) { return (el && el.textContent) ? el.textContent.trim().replace(/\s+/g, ' ').slice(0, 60) : ''; }
  function buildDetail(el) {
    const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(c => c && !/^(hl-outline|sel)$/.test(c));
    return {
      selector: domPath(el), context: contextText(el), label: nearAnchor(el),
      tag: el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : ''),
      prev: briefEl(el.previousElementSibling), next: briefEl(el.nextElementSibling)   // 앞뒤 요소(정확한 지목용)
    };
  }

  // 다중선택 모드(모바일: ＋ 토글 / 데스크톱: Shift 병용)
  let multiMode = false;
  $('#multiToggle').onclick = () => { multiMode = !multiMode; $('#multiToggle').classList.toggle('on', multiMode); };

  // ---- 선택: 단일 · Shift/＋토글=다중 · Option(⌥)/칩📷=영역 캡처 ----
  function pick(el, e) {
    const multi = e.shiftKey || multiMode, capture = e.altKey;
    const idx = selEls.indexOf(el);
    if (idx >= 0 && !capture) {      // 이미 선택된 것 다시 클릭 → 해제(캡처는 예외)
      el.classList.remove('sel'); selEls.splice(idx, 1); chips.splice(idx, 1); renderChips(); return;
    }
    if (!multi && idx < 0) clearSel();  // 단일 선택이면 기존 선택 비움
    if (idx < 0) { el.classList.add('sel'); el.classList.remove('hl-outline'); }
    const page = pageOf(el), comp = componentOf(el), section = sectionOf(page);
    const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40);
    let chip = idx >= 0 ? chips[idx] : null;
    if (!chip) { chip = { page, section, component: comp, text, detail: buildDetail(el) }; selEls.push(el); chips.push(chip); }
    if (capture) captureChip(el, chip);
    renderChips();
    if (!isDesktop()) openSheet(true);   // 모바일만 팝업 오픈(배경 스크롤 유지)
  }
  // Option+클릭: 요소 영역(+여백)을 헤드리스로 캡처해 칩에 이미지 첨부
  async function captureChip(el, chip) {
    try {
      const r = el.getBoundingClientRect();   // iframe 내부 = 문서좌표(스크롤 0)
      const pad = 18;
      const body = { x: r.left - pad, y: r.top - pad, w: r.width + 2 * pad, h: r.height + 2 * pad };
      chip.capturing = true; renderChips();
      const resp = await api('/api/capture', { method: 'POST', body: JSON.stringify(body) }).then(x => x.json()).catch(() => null);
      chip.capturing = false;
      if (resp && resp.url) chip.image = resp.url;
      renderChips();
    } catch { chip.capturing = false; renderChips(); }
  }
  function clearSel() { selEls.forEach(e => e.classList.remove('sel')); selEls = []; chips = []; }

  // ---- 칩: 채팅창(입력부)에만 ----
  function renderChips() {
    const html = chips.map((c, i) => {
      const CAM = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h6l2 3h3a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="3.5"/></svg>';
      const cap = c.capturing ? `<span class="capst">${CAM}…</span>` : (c.image ? `<span class="capst" title="캡처됨">${CAM}</span>` : `<span class="capbtn" data-i="${i}" title="영역 캡처">${CAM}</span>`);
      const pill = `<span class="chip"><b>${c.section}·p${c.page}</b>·${esc(c.component)}${c.text ? '·' + esc(c.text.slice(0, 14)) : ''}${cap}<span class="i" data-i="${i}" title="상세 정보">ⓘ</span><span class="x" data-i="${i}">×</span></span>`;
      const thumb = c.image ? `<img class="chipthumb md-img" src="${c.image}" data-i="${i}" title="캡처 이미지">` : '';
      return `<span class="chipwrap">${thumb}${pill}</span>`;   // 이미지가 칩 위에, 칩 너비에 맞게
    }).join('');
    $('#chipsin').innerHTML = html;
    document.querySelectorAll('#chipsin .chip .x').forEach(x => x.onclick = e => { e.stopPropagation(); removeChip(+x.dataset.i); });
    document.querySelectorAll('#chipsin .chip .i').forEach(b => b.onclick = e => { e.stopPropagation(); showChipInfo(+b.dataset.i); });
    document.querySelectorAll('#chipsin .chip .capbtn').forEach(b => b.onclick = e => { e.stopPropagation(); const i = +b.dataset.i; if (selEls[i]) captureChip(selEls[i], chips[i]); });
    const b = $('#talkBadge'); if (chips.length) { b.style.display = ''; b.textContent = chips.length; } else b.style.display = 'none';
    const box = $('#chipInfo'); if (box && !chips.length) box.style.display = 'none';
  }
  function showChipInfo(i) {
    const c = chips[i]; if (!c) return; const d = c.detail || {}; const box = $('#chipInfo'); if (!box) return;
    box.innerHTML = `<div class="ci-h"><b>${esc(c.section)} · p${c.page} · ${esc(c.component)}</b>${d.label ? ' · ' + esc(d.label) : ''}<span class="ci-x">×</span></div>`
      + (c.text ? `<div class="ci-row"><span>선택</span>${esc(c.text)}</div>` : '')
      + (d.prev ? `<div class="ci-row"><span>앞</span>${esc(d.prev)}</div>` : '')
      + (d.next ? `<div class="ci-row"><span>뒤</span>${esc(d.next)}</div>` : '')
      + (d.context ? `<div class="ci-row"><span>내용</span>${esc(d.context)}</div>` : '')
      + (d.tag ? `<div class="ci-row"><span>요소</span><code>${esc(d.tag)}</code></div>` : '')
      + (d.selector ? `<div class="ci-row"><span>위치</span><code>${esc(d.selector)}</code></div>` : '');
    box.style.display = 'block';
    box.querySelector('.ci-x').onclick = () => box.style.display = 'none';
  }
  function removeChip(i) { const el = selEls[i]; if (el) el.classList.remove('sel'); selEls.splice(i, 1); chips.splice(i, 1); renderChips(); }

  // ---- 페이지 위치/이동(스케일 반영) ----
  function pageOf(el) { const pg = el.closest('.page'); return pg ? pages.indexOf(pg) + 1 : curPage; }
  // ※ 섹션 라벨(sectionOf)·컴포넌트 분류(componentOf)는 파일 상단 '프로젝트별 설정'에 있다.
  function trackPage() {
    const wrap = $('#viewwrap'), top = wrap.scrollTop + 60;
    let idx = 1; for (let i = 0; i < pages.length; i++) { if (pages[i].offsetTop * S <= top) idx = i + 1; }
    if (idx !== curPage) { curPage = idx; $('#loc').textContent = `${DOC_NAME} · ${sectionOf(idx)} · p${idx}/${pages.length}`; }
  }
  // 페이지 이동은 스크롤로(상단바·◀▶ 버튼 제거). 위치/버전은 사이드바 #loc 에 표시.

  // ---- 바텀시트(모바일) / 사이드(PC는 항상 열림) ----
  function openSheet(open) {
    if (isDesktop()) return;
    const wrap = $('#viewwrap'), keep = wrap.scrollTop;
    $('#sheet').classList.toggle('open', open);
    if (open) { try { $('#ta').focus({ preventScroll: true }); } catch { $('#ta').focus(); } }
    requestAnimationFrame(() => { if (wrap.scrollTop !== keep) wrap.scrollTop = keep; });
  }
  $('#talk').onclick = () => openSheet(true); $('#shClose').onclick = () => openSheet(false);
  $('#grab').onclick = () => openSheet(false);

  // ---- 전송 ----
  let sending = false;
  async function send() {
    if (sending) return;                          // 중복 전송 방지(연타·IME)
    let text = $('#ta').value.trim();
    const imgs = chips.filter(c => c.image).map(c => `![](${c.image})`);   // 캡처 이미지를 메시지에도 표시
    if (imgs.length) text = (text ? text + '\n' : '') + imgs.join('\n');
    if (!text && !chips.length) return;
    sending = true;
    try { await api('/api/chat', { method: 'POST', body: JSON.stringify({ text, chips }) }); $('#ta').value = ''; clearSel(); renderChips(); }
    finally { sending = false; }
  }
  $('#send').onclick = send;
  // 한글 IME 조합 확정 Enter(isComposing·keyCode 229)는 전송에서 제외 → 두 번 전송 방지
  $('#ta').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); } });

  // ---- 피드 폴링 + 승인 카드 ----
  let mySync = null;
  async function poll() {
    try {
      let r = await api('/api/feed?since=' + lastMsg).then(x => x.json());
      // 서버 재기동/피드 리셋 감지 → 클라 초기화 후 처음부터(스테일 since로 새 메시지 놓치는 문제 방지)
      if (mySync !== null && r.sync !== undefined && r.sync !== mySync) {
        lastMsg = 0; seenProp.clear(); $('#feed').innerHTML = '';
        r = await api('/api/feed?since=0').then(x => x.json());
      }
      if (r.sync !== undefined) mySync = r.sync;
      (r.messages || []).forEach(m => { lastMsg = Math.max(lastMsg, m.id); renderMsg(m); });
      (r.proposals || []).forEach(renderProposal);
      setStatus(r.status || '');
    } catch { }
  }
  // 초경량 마크다운(ANA md 이식)
  function md(t) {
    let s = esc(t || '');
    s = s.replace(/```[a-z]*\n?([\s\S]*?)```/g, (_, c) => '<pre class="md-pre">' + c.trim() + '</pre>');
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img class="md-img" src="$2" alt="$1" loading="lazy">');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/^#{3,6}\s*(.+)$/gm, '<div class="md-h3">$1</div>');
    s = s.replace(/^#{1,2}\s*(.+)$/gm, '<div class="md-h2">$1</div>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/`([^`\n]+)`/g, '<code class="md-code">$1</code>');
    s = s.replace(/^\s*[-•]\s+(.+)$/gm, '<div class="md-li">•&nbsp;$1</div>');
    s = s.replace(/^\s*(\d+)\.\s+(.+)$/gm, '<div class="md-li">$1.&nbsp;$2</div>');
    s = s.replace(/\n/g, '<br>');
    s = s.replace(/(<\/div>)<br>/g, '$1').replace(/<br>(<div class="md-)/g, '$1').replace(/(<\/pre>)<br>/g, '$1');
    return s;
  }
  // 사용자 말풍선: 텍스트는 이스케이프하되 이미지(![](url))는 썸네일로
  function userHtml(t) {
    let s = esc(t || '');
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img class="md-img" src="$2" alt="$1" loading="lazy">');
    return s.replace(/\n/g, '<br>');
  }
  function appendActivity(text) {
    const f = $('#feed'); let g = f.lastElementChild;
    if (!(g && g.classList && g.classList.contains('act-group'))) {
      f.insertAdjacentHTML('beforeend', '<div class="act-group"></div>'); g = f.lastElementChild;
    }
    g.insertAdjacentHTML('beforeend', '<div class="act-item">' + esc(text) + '</div>');
  }
  function renderMsg(m) {
    if ((m.role === 'agent' || m.role === 'assistant') && m.proposalId) return;   // 카드로 렌더
    const f = $('#feed');
    if (m.kind === 'activity') { appendActivity(m.text); f.scrollTop = 1e9; return; }
    const cls = m.role === 'user' ? 'user' : (m.role === 'system' ? 'system' : 'assistant');
    const chipsHtml = (m.chips && m.chips.length) ? `<div class="mchips">${m.chips.map(c => `<span class="c">${esc(c.section + '·p' + c.page + '·' + c.component)}</span>`).join('')}</div>` : '';
    const bodyHtml = cls === 'user' ? userHtml(m.text) : md(m.text);
    const d = document.createElement('div'); d.className = 'msg ' + cls;
    d.innerHTML = chipsHtml + bodyHtml;
    f.appendChild(d); f.scrollTop = 1e9;
  }
  function setStatus(t) {
    // 헤더 배지
    const el = $('#status');
    if (el) { if (t) { el.textContent = '· ' + t; el.classList.add('on'); } else { el.textContent = ''; el.classList.remove('on'); } }
    // 피드 하단 '작성 중…' 타이핑 인디케이터(잘 보이게)
    const f = $('#feed'); let ty = document.getElementById('typing');
    if (t) {
      if (!ty) { ty = document.createElement('div'); ty.id = 'typing'; }
      ty.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><span class="tx">작성 중… ' + esc(t) + '</span>';
      f.appendChild(ty);   // 항상 맨 아래로
      f.scrollTop = 1e9;
    } else if (ty) { ty.remove(); }
  }
  function renderProposal(p) {
    if (seenProp.has(p.id)) return; seenProp.add(p.id);
    const diffHtml = esc(p.diff).split('\n').map(l => l.startsWith('+') ? `<span class="a">${l}</span>` : l.startsWith('-') ? `<span class="d">${l}</span>` : l).join('\n');
    const ba = (p.before || p.after) ? `<div class="ba">${p.before ? `<img src="${p.before}">` : ''}${p.after ? `<img src="${p.after}">` : ''}</div>` : '';
    const d = document.createElement('div'); d.className = 'card'; d.dataset.pid = p.id;
    d.innerHTML = `<div class="ct">${esc(p.title)}</div><div class="cb">${esc(p.summary)}${ba}${p.diff ? `<div class="diff">${diffHtml}</div>` : ''}</div><div class="act"><button class="ok">승인</button><button class="no">반려</button></div>`;
    d.querySelector('.ok').onclick = () => decide(p.id, 'approve', d);
    d.querySelector('.no').onclick = () => { const r = prompt('반려 사유(선택)') || ''; decide(p.id, 'reject', d, r); };
    $('#feed').appendChild(d); $('#feed').scrollTop = 1e9; openSheet(true);
  }
  async function decide(id, decision, node, reason = '') {
    await api('/api/approve', { method: 'POST', body: JSON.stringify({ id, decision, reason }) });
    node.querySelector('.act').innerHTML = `<div style="padding:9px;color:#53504B;font-size:12px">${decision === 'approve' ? '승인됨 — 적용 중…' : '반려됨'}</div>`;
  }

  // ---- 문서 버전 폴링(문서가 실제 바뀔 때만 리로드) ----
  let bookVer = 0;
  async function syncVer() {
    // bookVersion만 감시 — 채팅 메시지(version++)로는 리로드 안 함(본문 껌뻑임 방지). 실제 문서 편집 후 세션이 /api/rerender 호출 시에만 리로드.
    try { const s = await api('/api/state').then(x => x.json()); const bv = s.bookVersion || 0; if (bookVer && bv !== bookVer) frame.src = DOC_URL + '?v=' + bv; bookVer = bv; } catch { }
  }
  setInterval(poll, 2500); setInterval(syncVer, 3000); poll(); syncVer();
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(fit, 150); });

  // 이미지 썸네일 클릭 → 라이트박스(전체보기)
  $('#feed').addEventListener('click', e => {
    const img = e.target.closest('img.md-img'); if (!img) return;
    const o = document.createElement('div'); o.className = 'lightbox';
    o.innerHTML = `<img src="${img.src}">`;
    o.onclick = () => o.remove();
    document.body.appendChild(o);
  });
})();
