'use strict';
// cctv.js — 사례 13 · CCTV 불법행위 탐지 (국립공원)
// 비법정 탐방로 출입, 취사·흡연, 쓰레기 투기를 CCTV가 감지하면 지도에 띄우고 가까운 순찰대를 배정한다.
// 탐지 자체(영상 인식)는 밖에 있다 — 탐지기나 에이전트가 POST /api/cctv/detect로 결과를 넣는다.
// 워크스페이스마다 cctv.json이 따로 있다(state.json 옆). 처음 읽을 때 북한산 예제 카메라·구역·순찰대를 채운다.
//
//   GET  /api/cctv                      → {cameras, trails, zones, patrols, detections, types, version}
//   POST /api/cctv/detect   {camera, type: offtrail|fire|litter, confidence?, note?, lat?, lng?, snapshot?}   snapshot: 탐지 순간 이미지 URL
//   POST /api/cctv/camera   {id, stream: {url, type?: hls|video|image|mjpeg|iframe} | null}             카메라 영상 주소 등록·해제
//   POST /api/cctv/act      {id, action: assign|resolve|false|reopen, patrol?}   assign은 patrol 없으면 가장 가까운 순찰대
//   POST /api/cctv/patrol   {id, lat?, lng?, status?: available|busy|off}        순찰대 위치·상태(GPS 연동용)
//   POST /api/cctv/simulate {}                                                    데모용 모의 탐지 1건

const TYPES = {
  offtrail: { label: '비법정 탐방로 출입' },
  fire: { label: '취사·흡연' },
  litter: { label: '쓰레기 투기' },
};
const PATROL_STATUS = ['available', 'busy', 'off'];
const STREAM_TYPES = ['hls', 'video', 'image', 'mjpeg', 'iframe'];
// 영상·스냅샷 주소는 http(s) 절대 주소나 이 서버의 경로(/api/upload 결과 등)만 받는다 — javascript: 같은 주소 차단
const okUrl = (u) => typeof u === 'string' && u.length <= 2000 && (/^https?:\/\/[^\s]+$/i.test(u) || /^\/[^\s/][^\s]*$/.test(u));
// 확장자로 종류 추정 — 모르면 웹 플레이어 페이지(iframe)로 본다
function guessStream(url) {
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (path.endsWith('.m3u8')) return 'hls';
  if (/\.(mp4|webm|ogv|mov)$/.test(path)) return 'video';
  if (/\.(jpe?g|png|gif|webp)$/.test(path)) return 'image';
  if (/mjpe?g|\.cgi$/.test(path)) return 'mjpeg';
  return 'iframe';
}
const MAX_DETECTIONS = 500;

// 북한산국립공원 예제 — 좌표는 주요 탐방지원센터·봉우리 근처의 근삿값
function seedCctv() {
  return {
    version: 1,
    park: { name: '북한산국립공원', center: [37.6480, 126.9800], zoom: 13 },
    cameras: [
      { id: 'cam-bhs', name: '북한산성 탐방지원센터', lat: 37.6601, lng: 126.9505 },
      { id: 'cam-baekun', name: '백운대 정상부', lat: 37.6587, lng: 126.9779 },
      { id: 'cam-insu', name: '인수봉 하단', lat: 37.6617, lng: 126.9842 },
      { id: 'cam-uidong', name: '우이동 탐방지원센터', lat: 37.6618, lng: 127.0111 },
      { id: 'cam-daedong', name: '대동문', lat: 37.6440, lng: 126.9872 },
      { id: 'cam-jeongneung', name: '정릉 탐방지원센터', lat: 37.6156, lng: 127.0012 },
      { id: 'cam-gugi', name: '구기 탐방지원센터', lat: 37.6090, lng: 126.9580 },
      { id: 'cam-sumeun', name: '숨은벽 능선 입구', lat: 37.6703, lng: 126.9672 },
    ],
    // 법정 탐방로(정규 코스)
    trails: [
      { id: 't-baekun', name: '북한산성 – 백운대', path: [[37.6601, 126.9505], [37.6525, 126.9560], [37.6530, 126.9680], [37.6560, 126.9760], [37.6587, 126.9779]] },
      { id: 't-uidong', name: '우이동 – 백운대', path: [[37.6618, 127.0111], [37.6600, 127.0010], [37.6585, 126.9930], [37.6570, 126.9830], [37.6587, 126.9779]] },
      { id: 't-daedong', name: '정릉 – 대동문', path: [[37.6156, 127.0012], [37.6260, 126.9960], [37.6360, 126.9910], [37.6440, 126.9872]] },
      { id: 't-gugi', name: '구기 – 대남문', path: [[37.6090, 126.9580], [37.6190, 126.9640], [37.6290, 126.9700], [37.6330, 126.9730]] },
    ],
    // 출입 금지 구역(비법정 탐방로·특별보호구역)
    zones: [
      { id: 'z-sumeun', name: '숨은벽 비법정 탐방로', kind: 'offtrail', path: [[37.6725, 126.9640], [37.6725, 126.9725], [37.6655, 126.9745], [37.6650, 126.9660]] },
      { id: 'z-insu', name: '인수봉 암벽 특별보호구역', kind: 'offtrail', path: [[37.6640, 126.9810], [37.6640, 126.9880], [37.6600, 126.9885], [37.6598, 126.9815]] },
      { id: 'z-uisang', name: '의상능선 샛길', kind: 'offtrail', path: [[37.6450, 126.9580], [37.6460, 126.9660], [37.6400, 126.9670], [37.6390, 126.9590]] },
    ],
    patrols: [
      { id: 'p-1', name: '순찰 1조', lat: 37.6601, lng: 126.9505, status: 'available' },
      { id: 'p-2', name: '순찰 2조', lat: 37.6618, lng: 127.0111, status: 'available' },
      { id: 'p-3', name: '순찰 3조', lat: 37.6156, lng: 127.0012, status: 'available' },
    ],
    detections: [],
  };
}

// 두 좌표 사이 거리(km, 하버사인)
function distKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const isLat = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
const isLng = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 쉬는 순찰대 중 가까운 순
function nearestPatrols(s, det) {
  return s.patrols.filter((p) => p.status === 'available')
    .map((p) => ({ id: p.id, name: p.name, km: Math.round(distKm(p, det) * 100) / 100 }))
    .sort((a, b) => a.km - b.km);
}

function createCctv(deps) {
  const { fs, fileOf, readJsonStrict, writeJsonAtomic, sendJson, newId, loadData, saveData, audit, actor } = deps;

  function load(ws) {
    const file = fileOf(ws);
    if (!fs.existsSync(file)) { const s = seedCctv(); writeJsonAtomic(file, s); return s; }
    const s = readJsonStrict(file, seedCctv);
    if (!s || typeof s !== 'object' || !Array.isArray(s.cameras)) throw new Error(`cctv.json shape invalid (${file})`);
    for (const k of ['trails', 'zones', 'patrols', 'detections']) if (!Array.isArray(s[k])) s[k] = [];
    if (typeof s.version !== 'number') s.version = 1;
    return s;
  }
  const save = (ws, s) => { s.version = (s.version || 1) + 1; writeJsonAtomic(fileOf(ws), s); };
  const view = (s) => ({ ...s, types: TYPES, detections: s.detections.map((d) => d.status === 'new' ? { ...d, nearest: nearestPatrols(s, d).slice(0, 3) } : d) });

  // 배정·종료 때 순찰 할일을 함께 움직인다 — 배정하면 워크스페이스 할일에 올라가 다른 기능(달력·관계)과 이어진다
  function addTask(ws, title) {
    const st = loadData(ws);
    const it = { id: newId('a'), title: title.slice(0, 200), done: false, due: localDate(), by: 'ana' };
    st.items.push(it); st.version = (st.version || 1) + 1; saveData(st, ws);
    return it.id;
  }
  function closeTask(ws, id) {
    if (!id) return false;
    const st = loadData(ws), it = st.items.find((x) => x.id === id);
    if (!it || it.done) return false;
    it.done = true; st.version = (st.version || 1) + 1; saveData(st, ws);
    return true;
  }
  // 이 순찰대에 다른 미결 배정이 없으면 다시 대기로
  function freePatrol(s, pid) {
    const p = s.patrols.find((x) => x.id === pid);
    if (p && p.status === 'busy' && !s.detections.some((d) => d.status === 'assigned' && d.patrol === pid)) p.status = 'available';
  }

  function addDetection(s, req, body) {
    const cam = s.cameras.find((c) => c.id === body.camera);
    if (!cam) return { error: 'camera must be one of: ' + s.cameras.map((c) => c.id).join(', ') };
    if (!TYPES[body.type]) return { error: 'type must be offtrail|fire|litter' };
    const hasPos = body.lat !== undefined || body.lng !== undefined;
    if (hasPos && !(isLat(body.lat) && isLng(body.lng))) return { error: 'lat/lng must be numbers' };
    let confidence = null;
    if (body.confidence !== undefined && body.confidence !== null) {
      confidence = Number(body.confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return { error: 'confidence must be 0..1' };
    }
    if (body.snapshot !== undefined && body.snapshot !== null && body.snapshot !== '' && !okUrl(body.snapshot)) return { error: 'snapshot must be an http(s) URL or a /path on this server' };
    const d = {
      id: newId('d'), type: body.type, camera: cam.id,
      lat: hasPos ? body.lat : cam.lat, lng: hasPos ? body.lng : cam.lng,
      confidence, note: String(body.note || '').slice(0, 300),
      status: 'new', at: new Date().toISOString(), by: actor(req),
    };
    if (body.snapshot) d.snapshot = body.snapshot;
    s.detections.push(d);
    if (s.detections.length > MAX_DETECTIONS) s.detections.splice(0, s.detections.length - MAX_DETECTIONS);
    return { d };
  }

  async function route(req, res, p, ctx, ws) {
    if (!p.startsWith('/api/cctv')) return false;
    const { broadcast, csrfOk, jsonBody } = ctx;
    const fail = (code, error) => (sendJson(res, code, { error }), true);
    let s; try { s = load(ws); } catch (e) { return sendJson(res, 500, { error: 'cctv file corrupt', detail: e.message }), true; }

    if (p === '/api/cctv' && req.method === 'GET') return sendJson(res, 200, view(s)), true;
    if (req.method !== 'POST') return false;
    if (!csrfOk(req)) return fail(403, 'forbidden (origin/content-type)');
    const body = await jsonBody(req, res); if (!body) return true;
    let dataChanged = false, out = {};

    if (p === '/api/cctv/detect' || p === '/api/cctv/simulate') {
      if (p === '/api/cctv/simulate') {
        // 카메라 주변 150m 안에 무작위 탐지 1건
        const cam = s.cameras[Math.floor(Math.random() * s.cameras.length)];
        const keys = Object.keys(TYPES), j = () => (Math.random() - 0.5) * 0.0027;
        Object.assign(body, { camera: cam.id, type: keys[Math.floor(Math.random() * keys.length)],
          lat: cam.lat + j(), lng: cam.lng + j(), confidence: Math.round((0.6 + Math.random() * 0.38) * 100) / 100, note: '모의 탐지' });
      }
      const r = addDetection(s, req, body);
      if (r.error) return fail(400, r.error);
      audit(actor(req), 'cctv.detect', `${r.d.type}@${r.d.camera}`);
      out = { id: r.d.id, nearest: nearestPatrols(s, r.d).slice(0, 3) };
    } else if (p === '/api/cctv/act') {
      const d = s.detections.find((x) => x.id === body.id);
      if (!d) return fail(404, 'not found');
      const cam = s.cameras.find((c) => c.id === d.camera) || { name: d.camera };
      if (body.action === 'assign') {
        if (d.status !== 'new') return fail(409, `already ${d.status}`);
        const pid = body.patrol || (nearestPatrols(s, d)[0] || {}).id;
        const pat = s.patrols.find((x) => x.id === pid);
        if (!pat) return fail(body.patrol ? 404 : 409, body.patrol ? 'patrol not found' : 'no available patrol');
        if (pat.status === 'off') return fail(409, 'patrol is off duty');
        d.status = 'assigned'; d.patrol = pat.id; d.assignedAt = new Date().toISOString(); pat.status = 'busy';
        d.taskId = addTask(ws, `[순찰] ${TYPES[d.type].label} · ${cam.name} → ${pat.name}`);
        dataChanged = true;
        out = { patrol: pat.id, km: Math.round(distKm(pat, d) * 100) / 100, taskId: d.taskId };
      } else if (body.action === 'resolve' || body.action === 'false') {
        if (d.status === 'resolved' || d.status === 'false') return fail(409, `already ${d.status}`);
        d.status = body.action === 'resolve' ? 'resolved' : 'false'; d.closedAt = new Date().toISOString();
        if (d.patrol) freePatrol(s, d.patrol);
        dataChanged = closeTask(ws, d.taskId);
      } else if (body.action === 'reopen') {
        if (d.status === 'new') return fail(409, 'already new');
        const pid = d.patrol;
        d.status = 'new'; delete d.patrol; delete d.closedAt; delete d.assignedAt;
        if (pid) freePatrol(s, pid);
      } else return fail(400, 'action must be assign|resolve|false|reopen');
      audit(actor(req), 'cctv.' + body.action, `${d.type}@${d.camera}`);
    } else if (p === '/api/cctv/camera') {
      const cam = s.cameras.find((c) => c.id === body.id);
      if (!cam) return fail(404, 'camera not found');
      if (body.stream === null || body.stream === '') delete cam.stream;
      else {
        const st = body.stream || {};
        if (!okUrl(st.url)) return fail(400, 'stream.url must be an http(s) URL or a /path on this server');
        const type = st.type || guessStream(st.url);
        if (!STREAM_TYPES.includes(type)) return fail(400, 'stream.type must be hls|video|image|mjpeg|iframe');
        cam.stream = { url: st.url, type };
      }
      audit(actor(req), 'cctv.camera', cam.id);
      out = { stream: cam.stream || null };
    } else if (p === '/api/cctv/patrol') {
      const pat = s.patrols.find((x) => x.id === body.id);
      if (!pat) return fail(404, 'not found');
      const hasPos = body.lat !== undefined || body.lng !== undefined;
      if (hasPos && !(isLat(body.lat) && isLng(body.lng))) return fail(400, 'lat/lng must be numbers');
      if (body.status !== undefined && !PATROL_STATUS.includes(body.status)) return fail(400, 'status must be available|busy|off');
      if (hasPos) { pat.lat = body.lat; pat.lng = body.lng; }
      if (body.status !== undefined) pat.status = body.status;
    } else return false;

    save(ws, s);
    broadcast({ kind: 'cctv', version: s.version });
    if (dataChanged) broadcast({ kind: 'data', version: loadData(ws).version });
    return sendJson(res, 200, { ok: true, version: s.version, ...out }), true;
  }

  return { route, load };
}

module.exports = { createCctv, seedCctv, distKm, guessStream, TYPES };
