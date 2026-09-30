---
name: road-maintenance
description: Road maintenance priority — score each road from weather (freeze-thaw and heavy-rain days from Open-Meteo), traffic volume (AADT, heavy-vehicle share), past damage history (potholes, cracks, rutting, subsidence) and pavement age; show on a Leaflet + OpenStreetMap map which roads need a detailed inspection (정밀검사) or repaving (포장공사), and turn a decision into a Task. Use when the user says "도로", "포장공사", "정밀검사", "포트홀", "도로 파손", "교통량", "동결융해", "도로 유지관리", or when ana-update reports road-maintenance missing.
---

# road-maintenance — which road to inspect, which to repave

## Model (road.js `assess`, computed on every GET)

Each factor is 0..1; the score is `100 × Σ weight × factor`.

| Factor | Weight | From |
|---|---|---|
| damage | 0.40 | damages since the last repave, last 3 years, `severity × recency (1 / 0.6 / 0.3 per year)` per km, ÷ 8 |
| traffic | 0.25 | `0.6 × AADT/120k + 0.4 × heavy%/15` |
| weather | 0.20 | `0.6 × freeze-thaw days/100 + 0.4 × heavy-rain (≥30 mm) days/20`, Open-Meteo last 365 days |
| age | 0.15 | years since `pavedAt` ÷ 15 |

Verdict: **repave** if score ≥ 65, or damage ≥ 0.75 with age ≥ 0.5. **inspect** if score ≥ 45, or any severity-3 damage in the last 90 days. Otherwise **ok**. Each road also returns plain-language `reasons` and raw `stats`. Tune `WEIGHTS` / `THRESH` in `road.js`.

## Pieces

| Piece | Upstream |
|---|---|
| Server module | `road.js` (copy). `createRoad(deps).route()` handles `/api/road*`. Store is `roads.json` next to each workspace's `state.json`. The first read seeds 9 Seoul roads with **example** traffic and damage history (`seedRoads`). Replace the seed with real survey data. |
| External data | Weather: `archive-api.open-meteo.com` (no key), one call per 0.1° grid cell, refreshed daily in the background. Geometry: `routing.openstreetmap.de/routed-foot` snaps waypoints to streets once (the foot profile avoids U-turn detours on divided roads); a path over 1.4× the waypoint length is rejected. `ANA_OFFLINE=1` turns both off (tests, closed networks); the climate default is used instead. |
| API | `GET /api/road` → `{city, roads[] (+assessment, sorted by score), damages[] (with lat/lng), weather, model}`.<br>`POST /api/road/damage {road, type: pothole\|crack\|rutting\|subsidence, severity: 1..3, date?, lat?, lng?, note?}`.<br>`POST /api/road/traffic {road, aadt?, heavyPct?}`.<br>`POST /api/road/act {road, action: inspect\|repave\|done\|cancel}`: inspect/repave adds a Task; done sets `lastInspection` (and `pavedAt` for repave) and completes the Task.<br>`POST /api/road/weather {}` refetches now. `POST /api/road/simulate {}` adds one random damage report (demo). Changes broadcast `{kind:'road'}`. |
| UI | Workspace › `도로 관리` (`#roadView`, badge `#roadBadge` = roads needing action with no plan). Reuses the CCTV tab's map and list frame (`.cctv-layout`, `.cv-card`) and `loadLeaflet()`. `renderRoad` (KPIs, weather line, cards with score, four factor bars, reasons, actions), `drawRoadMap` (lines colored by verdict, width by score, damage dots by severity), `selectRoad` (list ↔ map). |

## Agent usage

```bash
# a pothole report from the field
curl -s -X POST localhost:8809/api/road/damage -H 'content-type: application/json' \
     -d '{"road":"r-gangnam","type":"pothole","severity":3,"note":"2차로 지름 40cm"}'
# ranked list with reasons
curl -s localhost:8809/api/road | jq '.roads[] | {name, score: .assessment.score, verdict: .assessment.verdict, why: .assessment.reasons}'
```
