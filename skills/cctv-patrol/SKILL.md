---
name: cctv-patrol
description: Use case 13 · CCTV illegal-activity detection for a national park — a Leaflet + OpenStreetMap map (cameras, official trails, no-entry zones, patrol teams, detections), a detection list, and one-tap patrol assignment that becomes a Task. Detections come in over /api/cctv/detect from a detector or the agent. Use when the user says "CCTV", "불법행위 탐지", "비법정 탐방로", "취사·흡연", "쓰레기 투기", "순찰 배정", "지도", "국립공원", or when ana-update reports cctv-patrol missing.
---

# cctv-patrol — detect, place on the map, send the nearest patrol

Recognising the act in video is **outside** ANA. A detector (YOLO etc.) or the agent posts a detection; ANA puts it on the map, recommends the nearest free patrol, and tracks it to closure.

## Flow

`new` → **assign** (nearest available patrol by haversine distance, or a chosen one) → `assigned` (patrol goes `busy`, a Task `[순찰] <type> · <camera> → <team>` due today is added to the workspace) → **resolve** or **false** (false positive) → the Task is marked done and the patrol returns to `available` if it has no other open job. **reopen** puts a detection back to `new`.

## Pieces

| Piece | Upstream |
|---|---|
| Server module | `cctv.js` (copy). `createCctv(deps).route()` handles every `/api/cctv*` path. Store is `cctv.json` next to each workspace's `state.json`; the first read seeds Bukhansan cameras, trails, zones and three patrols (`seedCctv`). Replace the seed with the real park's data. |
| API | `GET /api/cctv` → `{park, cameras, trails, zones, patrols, detections, types}`; `new` detections carry `nearest[]` (id, name, km).<br>`POST /api/cctv/detect {camera, type: offtrail\|fire\|litter, confidence?: 0..1, note?, lat?, lng?}` (position defaults to the camera).<br>`POST /api/cctv/act {id, action: assign\|resolve\|false\|reopen, patrol?}`.<br>`POST /api/cctv/patrol {id, lat?, lng?, status?: available\|busy\|off}` for GPS / duty updates.<br>`POST /api/cctv/simulate {}` makes one random detection (demo). Changes broadcast `{kind:'cctv'}`. |
| UI | Workspace › `CCTV 감시` tab (`#cctvView`, badge `#cctvBadge` = new detections). `loadLeaflet()` lazy-loads Leaflet 1.9.4 from unpkg with SRI; tiles from `tile.openstreetmap.org` with attribution. `renderCctv` (KPIs + list with patrol select), `drawCctvMap` (trails green, zones red dashed, 📷 cameras, pulsing new detections, dashed line patrol → assigned detection), `selectCv` (list ↔ map). Without the CDN the list still works. |

## Agent usage

```bash
# register a detection from camera 백운대 정상부
curl -s -X POST localhost:8809/api/cctv/detect -H 'content-type: application/json' \
     -d '{"camera":"cam-baekun","type":"fire","confidence":0.87,"note":"연기 감지"}'
# send the nearest free patrol
curl -s -X POST localhost:8809/api/cctv/act -H 'content-type: application/json' -d '{"id":"<detection id>","action":"assign"}'
```
