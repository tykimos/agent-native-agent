'use strict';
// road.js — 도로 유지관리 우선순위: 날씨 · 교통량 · 과거 파손 이력으로 정밀검사 / 포장공사가 필요한 도로를 고른다.
// 워크스페이스마다 roads.json이 따로 있다(state.json 옆). 처음 읽을 때 서울 예제 도로 9개를 채운다.
//   - 날씨: Open-Meteo 과거 기상(키 불필요)에서 지난 1년 일별 최저·최고기온·강수량 → 동결융해일·호우일. 하루 한 번 갱신.
//   - 도로 선형: OSRM(FOSSGIS routing.openstreetmap.de)으로 경유지를 실제 도로에 맞춘다(한 번). 못 하면 경유지 직선.
//   - 교통량·파손 이력: 예제 값. 실제 자료(교통량 조사, 포트홀 신고)는 /api/road/traffic · /api/road/damage로 넣는다.
// 점수는 저장하지 않고 GET 때마다 계산한다(assess) — 가중치를 바꾸면 바로 반영된다.
//
//   GET  /api/road                        → {city, roads[+assessment], damages, weather, model}
//   POST /api/road/damage   {road, type: pothole|crack|rutting|subsidence, severity: 1..3, date?, lat?, lng?, note?}
//   POST /api/road/traffic  {road, aadt?, heavyPct?}
//   POST /api/road/act      {road, action: inspect|repave|done|cancel}   inspect·repave → 할일 생성, done → 검사일/포장일 갱신
//   POST /api/road/weather  {}                                           날씨 즉시 다시 받기
//   POST /api/road/simulate {}                                           데모용 모의 파손 신고 1건

const DAMAGE_TYPES = { pothole: '포트홀', crack: '균열', rutting: '소성변형', subsidence: '침하' };
const VERDICTS = { repave: '포장공사 필요', inspect: '정밀검사 필요', ok: '양호' };
// 가중치 합 1 — 파손 이력이 가장 직접적인 신호, 교통량·기상은 열화를 앞당기는 요인, 노후도는 기본 수명
const WEIGHTS = { damage: 0.4, traffic: 0.25, weather: 0.2, age: 0.15 };
const THRESH = { repave: 65, inspect: 45 };
// 날씨를 못 받았을 때 쓰는 서울 평년 수준 값
const CLIMATE_DEFAULT = { ftc: 70, heavyRain: 12, rainTotal: 1400, coldDays: 5, source: 'default' };
const DAY = 86400000;

// 서울 예제 — 경유지는 역·교차로 근처 근삿값. intensity는 예제 파손 이력을 만들 때만 쓴다.
const SEED_ROADS = [
  { id: 'r-gangnam', name: '강남대로 (신사–양재)', waypoints: [[37.5163, 127.0203], [37.4979, 127.0276], [37.4846, 127.0342]], aadt: 98000, heavyPct: 7, pavedAt: '2016-05-20', lastInspection: '2024-04-10', intensity: 1.6 },
  { id: 'r-teheran', name: '테헤란로 (강남–삼성)', waypoints: [[37.4979, 127.0276], [37.5006, 127.0364], [37.5045, 127.0490], [37.5088, 127.0631]], aadt: 82000, heavyPct: 5, pavedAt: '2019-06-01', lastInspection: '2025-03-15', intensity: 0.9 },
  { id: 'r-sejong', name: '세종대로 (서울역–광화문)', waypoints: [[37.5547, 126.9706], [37.5657, 126.9769], [37.5714, 126.9768]], aadt: 71000, heavyPct: 6, pavedAt: '2022-09-15', lastInspection: '2025-09-01', intensity: 0.3 },
  { id: 'r-jongno', name: '종로 (광화문–동대문)', waypoints: [[37.5704, 126.9780], [37.5702, 126.9830], [37.5714, 126.9918], [37.5712, 127.0095]], aadt: 58000, heavyPct: 12, pavedAt: '2013-10-01', lastInspection: '2023-05-20', intensity: 1.4 },
  { id: 'r-euljiro', name: '을지로 (시청–동대문역사문화공원)', waypoints: [[37.5660, 126.9784], [37.5663, 126.9910], [37.5655, 127.0079]], aadt: 42000, heavyPct: 8, pavedAt: '2012-04-10', lastInspection: '2024-10-02', intensity: 0.8 },
  { id: 'r-dosan', name: '도산대로 (신사–청담)', waypoints: [[37.5163, 127.0203], [37.5143, 127.0317], [37.5225, 127.0535]], aadt: 56000, heavyPct: 4, pavedAt: '2018-08-20', lastInspection: '2025-06-11', intensity: 0.5 },
  { id: 'r-nambu', name: '남부순환로 (사당–도곡)', waypoints: [[37.4766, 126.9816], [37.4800, 127.0130], [37.4846, 127.0342], [37.4870, 127.0470], [37.4909, 127.0554]], aadt: 93000, heavyPct: 15, pavedAt: '2015-07-01', lastInspection: '2024-02-28', intensity: 1.3 },
  { id: 'r-yeongdong', name: '영동대로 (삼성–청담)', waypoints: [[37.5088, 127.0631], [37.5145, 127.0600], [37.5192, 127.0539]], aadt: 87000, heavyPct: 9, pavedAt: '2023-11-01', lastInspection: '2025-11-20', intensity: 0.25 },
  { id: 'r-hangang', name: '한강대로 (서울역–신용산)', waypoints: [[37.5547, 126.9706], [37.5446, 126.9720], [37.5347, 126.9730], [37.5292, 126.9680]], aadt: 64000, heavyPct: 10, pavedAt: '2017-03-15', lastInspection: '2024-08-19', intensity: 1.0 },
];

// 시드 고정 난수 — 예제 파손 이력이 매번 같게
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
function distKm(a, b) {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const pathKm = (p) => p.slice(1).reduce((s, x, i) => s + distKm(p[i], x), 0);
// 선형 위의 비율 t(0..1) 지점 좌표
function pointAt(p, t) {
  const total = pathKm(p); let want = total * Math.min(1, Math.max(0, t));
  for (let i = 1; i < p.length; i++) {
    const seg = distKm(p[i - 1], p[i]);
    if (want <= seg || i === p.length - 1) { const f = seg ? Math.min(1, want / seg) : 0; return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * f, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * f]; }
    want -= seg;
  }
  return p[0];
}

function seedRoads(now = Date.now()) {
  const roads = [], damages = [];
  const types = Object.keys(DAMAGE_TYPES);
  SEED_ROADS.forEach((r, i) => {
    const { intensity, ...road } = r;
    road.path = r.waypoints; road.snapped = false;
    roads.push(road);
    const rnd = mulberry32(1000 + i);
    const km = pathKm(r.waypoints);
    const n = Math.round(intensity * km * 5 * (0.8 + rnd() * 0.4));   // 지난 3년 파손 건수
    for (let k = 0; k < n; k++) {
      const age = Math.floor(rnd() ** intensity * 1095);              // 파손이 잦은 길일수록 최근에 몰린다
      const date = ymd(now - age * DAY);
      if (date <= road.pavedAt) continue;
      const sev = rnd() < 0.15 * intensity ? 3 : rnd() < 0.5 ? 2 : 1;
      // 1~3월(해빙기)에는 포트홀이 더 많다
      const month = new Date(now - age * DAY).getMonth();
      const type = month <= 2 && rnd() < 0.6 ? 'pothole' : types[Math.floor(rnd() * types.length)];
      damages.push({ id: `dm-${i}-${k}`, road: road.id, type, severity: sev, date, t: Math.round(rnd() * 1000) / 1000, by: 'seed' });
    }
  });
  return {
    version: 1, city: { name: '서울 (예제)', center: [37.530, 127.010], zoom: 12 },
    note: '교통량·파손 이력은 예제 데이터입니다. 날씨는 Open-Meteo 실제 관측(재분석) 값입니다.',
    roads, damages, weather: { cells: {}, fetchedAt: '' },
  };
}

const cellKey = (lat, lng) => `${lat.toFixed(1)},${lng.toFixed(1)}`;
const roadCell = (r) => { const m = r.path[Math.floor(r.path.length / 2)]; return cellKey(m[0], m[1]); };

// 한 도로의 점수·판정·근거
function assess(road, damages, weather, now = Date.now()) {
  const since = road.pavedAt || '0000';
  const mine = damages.filter((d) => d.road === road.id && d.date > since && now - Date.parse(d.date) <= 1095 * DAY);
  const km = Math.max(0.5, pathKm(road.path));
  let pts = 0;
  for (const d of mine) { const age = (now - Date.parse(d.date)) / DAY; pts += d.severity * (age < 365 ? 1 : age < 730 ? 0.6 : 0.3); }
  const perKm = pts / km;
  const w = (weather && weather.cells && weather.cells[roadCell(road)]) || CLIMATE_DEFAULT;
  const ageY = road.pavedAt ? (now - Date.parse(road.pavedAt)) / (365.25 * DAY) : 15;
  const f = {
    damage: Math.min(1, perKm / 8),
    traffic: 0.6 * Math.min(1, (road.aadt || 0) / 120000) + 0.4 * Math.min(1, (road.heavyPct || 0) / 15),
    weather: 0.6 * Math.min(1, w.ftc / 100) + 0.4 * Math.min(1, w.heavyRain / 20),
    age: Math.min(1, ageY / 15),
  };
  const score = Math.round(100 * Object.keys(WEIGHTS).reduce((s, k) => s + WEIGHTS[k] * f[k], 0));
  const severeRecent = mine.filter((d) => d.severity === 3 && now - Date.parse(d.date) <= 90 * DAY).length;
  const lastYear = mine.filter((d) => now - Date.parse(d.date) <= 365 * DAY).length;
  const verdict = score >= THRESH.repave || (f.damage >= 0.75 && f.age >= 0.5) ? 'repave'
    : score >= THRESH.inspect || severeRecent > 0 ? 'inspect' : 'ok';
  const reasons = [];
  if (f.damage >= 0.5) reasons.push(`파손 이력 많음(3년 ${mine.length}건, 최근 1년 ${lastYear}건)`);
  if (severeRecent) reasons.push(`90일 내 심각 파손 ${severeRecent}건`);
  if (f.traffic >= 0.6) reasons.push(`교통 하중 큼(중차량 ${road.heavyPct}%)`);
  if (w.ftc >= 60) reasons.push(`동결융해 ${w.ftc}일`);
  if (w.heavyRain >= 12) reasons.push(`호우 ${w.heavyRain}일`);
  if (ageY >= 8) reasons.push(`포장 후 ${Math.floor(ageY)}년`);
  const byType = {};
  for (const d of mine) byType[d.type] = (byType[d.type] || 0) + 1;
  return {
    score, verdict, factors: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Math.round(v * 100) / 100])), reasons,
    stats: { km: Math.round(km * 100) / 100, damages3y: mine.length, lastYear, severeRecent, byType, ageYears: Math.round(ageY * 10) / 10,
      ftc: w.ftc, heavyRain: w.heavyRain, weatherSource: w.source || 'open-meteo' },
  };
}

// 지난 1년 일별 기상 → 동결융해일(최저<0 & 최고>0), 호우일(≥30mm), 연강수량, 한파일(최저≤-10)
function summarizeWeather(daily) {
  const tmax = daily.temperature_2m_max || [], tmin = daily.temperature_2m_min || [], pr = daily.precipitation_sum || [];
  let ftc = 0, heavyRain = 0, rainTotal = 0, coldDays = 0, n = 0;
  for (let i = 0; i < tmax.length; i++) {
    if (tmax[i] == null || tmin[i] == null) continue;
    n++;
    if (tmin[i] < 0 && tmax[i] > 0) ftc++;
    if (tmin[i] <= -10) coldDays++;
    if ((pr[i] || 0) >= 30) heavyRain++;
    rainTotal += pr[i] || 0;
  }
  if (n < 200) return null;   // 자료가 너무 적으면 쓰지 않는다
  return { ftc, heavyRain, rainTotal: Math.round(rainTotal), coldDays, days: n, source: 'open-meteo' };
}

function createRoad(deps) {
  const { fs, fileOf, readJsonStrict, writeJsonAtomic, sendJson, newId, loadData, saveData, audit, actor, offline } = deps;
  let broadcastRef = () => {};
  const busy = new Set();   // 진행 중인 백그라운드 작업(ws:kind)

  function load(ws) {
    const file = fileOf(ws);
    if (!fs.existsSync(file)) { const s = seedRoads(); writeJsonAtomic(file, s); return s; }
    const s = readJsonStrict(file, seedRoads);
    if (!s || typeof s !== 'object' || !Array.isArray(s.roads)) throw new Error(`roads.json shape invalid (${file})`);
    if (!Array.isArray(s.damages)) s.damages = [];
    if (!s.weather || typeof s.weather !== 'object') s.weather = { cells: {}, fetchedAt: '' };
    if (!s.weather.cells) s.weather.cells = {};
    if (typeof s.version !== 'number') s.version = 1;
    return s;
  }
  const save = (ws, s) => { s.version = (s.version || 1) + 1; writeJsonAtomic(fileOf(ws), s); broadcastRef({ kind: 'road', version: s.version }); };

  async function getJson(url, ms = 12000) {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'user-agent': 'ANA road-maintenance demo' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  // 백그라운드 작업 — 같은 워크스페이스에서 같은 작업은 하나만
  function background(ws, kind, fn) {
    const key = `${ws}:${kind}`;
    if (offline || busy.has(key)) return;
    busy.add(key);
    fn().catch(() => {}).finally(() => busy.delete(key));
  }

  // 날씨: 도로 중간점을 0.1° 격자로 묶어 격자마다 한 번씩 받는다
  function refreshWeather(ws, force) {
    const s = load(ws);
    if (!force && s.weather.fetchedAt && Date.now() - Date.parse(s.weather.fetchedAt) < DAY) return;
    background(ws, 'weather', async () => {
      const end = ymd(Date.now() - 6 * DAY), start = ymd(Date.now() - 371 * DAY);   // 재분석 자료는 며칠 늦게 올라온다
      const cells = {};
      for (const key of new Set(load(ws).roads.map(roadCell))) {
        const [lat, lng] = key.split(',');
        try {
          const j = await getJson(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${start}&end_date=${end}`
            + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=Asia%2FSeoul');
          const sum = summarizeWeather(j.daily || {});
          if (sum) cells[key] = { ...sum, from: start, to: end };
        } catch {}
      }
      if (!Object.keys(cells).length) return;
      const cur = load(ws);
      cur.weather = { cells: { ...cur.weather.cells, ...cells }, fetchedAt: new Date().toISOString(), from: start, to: end };
      save(ws, cur);
    });
  }
  // 선형: 경유지를 OSRM으로 실제 도로에 맞춘다. 보행 프로필을 쓴다 — 차량 프로필은 중앙분리 도로의 일방통행 차로 때문에
  // 경유지마다 유턴 우회로를 만든다. 그래도 우회로(경유지 거리의 1.4배 초과)가 나오면 직선을 유지한다.
  function snapRoads(ws) {
    if (!load(ws).roads.some((r) => !r.snapped)) return;
    background(ws, 'snap', async () => {
      const done = {};
      for (const r of load(ws).roads.filter((x) => !x.snapped)) {
        try {
          const coords = r.waypoints.map(([la, ln]) => `${ln},${la}`).join(';');
          const j = await getJson(`https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coords}?overview=full&geometries=geojson`);
          const g = j.routes && j.routes[0] && j.routes[0].geometry;
          const path = g && g.coordinates.map(([ln, la]) => [Math.round(la * 1e5) / 1e5, Math.round(ln * 1e5) / 1e5]);
          done[r.id] = path && path.length > 1 && pathKm(path) <= pathKm(r.waypoints) * 1.4 ? path : null;
        } catch { done[r.id] = undefined; }   // 네트워크 실패 — 다음 기회에 다시
      }
      const cur = load(ws);
      let changed = false;
      for (const r of cur.roads) {
        if (!(r.id in done) || done[r.id] === undefined) continue;
        if (done[r.id]) r.path = done[r.id];
        r.snapped = true; changed = true;
      }
      if (changed) save(ws, cur);
    });
  }

  function view(s) {
    const now = Date.now();
    const roads = s.roads.map((r) => ({ ...r, assessment: assess(r, s.damages, s.weather, now) }))
      .sort((a, b) => b.assessment.score - a.assessment.score);
    const pathOf = Object.fromEntries(s.roads.map((r) => [r.id, r.path]));
    const damages = s.damages.filter((d) => pathOf[d.road] && now - Date.parse(d.date) <= 1095 * DAY).map((d) => {
      if (typeof d.lat === 'number') return d;
      const [lat, lng] = pointAt(pathOf[d.road], d.t || 0.5);
      return { ...d, lat, lng };
    });
    return { ...s, roads, damages, types: DAMAGE_TYPES, verdicts: VERDICTS,
      model: { weights: WEIGHTS, thresholds: THRESH, climateDefault: CLIMATE_DEFAULT } };
  }

  function addTask(ws, title) {
    const st = loadData(ws);
    const it = { id: newId('a'), title: title.slice(0, 200), done: false, by: 'ana' };
    st.items.push(it); st.version = (st.version || 1) + 1; saveData(st, ws);
    return it.id;
  }
  function setTaskDone(ws, id) {
    if (!id) return false;
    const st = loadData(ws), it = st.items.find((x) => x.id === id);
    if (!it || it.done) return false;
    it.done = true; st.version = (st.version || 1) + 1; saveData(st, ws);
    return true;
  }

  function addDamage(s, req, body) {
    const road = s.roads.find((r) => r.id === body.road);
    if (!road) return { error: 'road must be one of: ' + s.roads.map((r) => r.id).join(', ') };
    if (!DAMAGE_TYPES[body.type]) return { error: 'type must be pothole|crack|rutting|subsidence' };
    const sev = Number(body.severity);
    if (![1, 2, 3].includes(sev)) return { error: 'severity must be 1, 2 or 3' };
    const date = body.date === undefined ? ymd(Date.now()) : String(body.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { error: 'date must be YYYY-MM-DD' };
    const d = { id: newId('dm'), road: road.id, type: body.type, severity: sev, date, note: String(body.note || '').slice(0, 300), by: actor(req) };
    const hasPos = body.lat !== undefined || body.lng !== undefined;
    if (hasPos) {
      if (!(typeof body.lat === 'number' && Math.abs(body.lat) <= 90 && typeof body.lng === 'number' && Math.abs(body.lng) <= 180)) return { error: 'lat/lng must be numbers' };
      d.lat = body.lat; d.lng = body.lng;
    } else d.t = body.t !== undefined && Number(body.t) >= 0 && Number(body.t) <= 1 ? Number(body.t) : Math.round(Math.random() * 1000) / 1000;
    s.damages.push(d);
    if (s.damages.length > 5000) s.damages.splice(0, s.damages.length - 5000);
    return { d };
  }

  async function route(req, res, p, ctx, ws) {
    if (p !== '/api/road' && !p.startsWith('/api/road/')) return false;
    const { broadcast, csrfOk, jsonBody } = ctx;
    broadcastRef = broadcast;
    const fail = (code, error) => (sendJson(res, code, { error }), true);
    let s; try { s = load(ws); } catch (e) { return sendJson(res, 500, { error: 'roads file corrupt', detail: e.message }), true; }

    if (p === '/api/road' && req.method === 'GET') {
      refreshWeather(ws, false); snapRoads(ws);
      return sendJson(res, 200, view(s)), true;
    }
    if (req.method !== 'POST') return false;
    if (!csrfOk(req)) return fail(403, 'forbidden (origin/content-type)');
    const body = await jsonBody(req, res); if (!body) return true;
    let dataChanged = false, out = {};

    if (p === '/api/road/weather') {
      if (offline) return fail(503, 'offline');
      refreshWeather(ws, true);
      return sendJson(res, 202, { ok: true, started: true }), true;
    } else if (p === '/api/road/damage' || p === '/api/road/simulate') {
      if (p === '/api/road/simulate') {
        const r = s.roads[Math.floor(Math.random() * s.roads.length)], keys = Object.keys(DAMAGE_TYPES);
        Object.assign(body, { road: r.id, type: keys[Math.floor(Math.random() * keys.length)], severity: 1 + Math.floor(Math.random() * 3), note: '모의 신고' });
        delete body.date; delete body.lat; delete body.lng;
      }
      const r = addDamage(s, req, body);
      if (r.error) return fail(400, r.error);
      audit(actor(req), 'road.damage', `${r.d.type}@${r.d.road}`);
      out = { id: r.d.id, road: r.d.road };
    } else if (p === '/api/road/traffic') {
      const road = s.roads.find((r) => r.id === body.road);
      if (!road) return fail(404, 'road not found');
      if (body.aadt !== undefined) { const v = Number(body.aadt); if (!Number.isFinite(v) || v < 0 || v > 1e6) return fail(400, 'aadt must be 0..1000000'); road.aadt = Math.round(v); }
      if (body.heavyPct !== undefined) { const v = Number(body.heavyPct); if (!Number.isFinite(v) || v < 0 || v > 100) return fail(400, 'heavyPct must be 0..100'); road.heavyPct = Math.round(v * 10) / 10; }
    } else if (p === '/api/road/act') {
      const road = s.roads.find((r) => r.id === body.road);
      if (!road) return fail(404, 'road not found');
      if (body.action === 'inspect' || body.action === 'repave') {
        if (road.plan) return fail(409, `already planned (${road.plan.kind})`);
        const a = assess(road, s.damages, s.weather);
        const label = body.action === 'inspect' ? '정밀검사' : '포장공사';
        road.plan = { kind: body.action, at: new Date().toISOString(), score: a.score };
        road.plan.taskId = addTask(ws, `[${label}] ${road.name} — 점수 ${a.score}${a.reasons.length ? ' · ' + a.reasons.slice(0, 2).join(', ') : ''}`);
        dataChanged = true; out = { taskId: road.plan.taskId };
      } else if (body.action === 'done') {
        if (!road.plan) return fail(409, 'nothing planned');
        const today = ymd(Date.now());
        if (road.plan.kind === 'repave') { road.pavedAt = today; road.lastInspection = today; } else road.lastInspection = today;
        dataChanged = setTaskDone(ws, road.plan.taskId);
        road.history = [...(road.history || []), { kind: road.plan.kind, at: today }].slice(-20);
        delete road.plan;
      } else if (body.action === 'cancel') {
        if (!road.plan) return fail(409, 'nothing planned');
        delete road.plan;
      } else return fail(400, 'action must be inspect|repave|done|cancel');
      audit(actor(req), 'road.' + body.action, road.id);
    } else return false;

    save(ws, s);
    if (dataChanged) broadcast({ kind: 'data', version: loadData(ws).version });
    return sendJson(res, 200, { ok: true, version: s.version, ...out }), true;
  }

  return { route, load };
}

module.exports = { createRoad, seedRoads, assess, summarizeWeather, pointAt, pathKm, DAMAGE_TYPES, WEIGHTS };
