# Catchup — What's Been Built

## Status: Clean. All changes committed and pushed to master. WOTD fetch is fully wired; live classification will work when Xert serves a workoutId in training_info.

---

## What exists

### Infrastructure
- **`proxy.js`** — Node.js local proxy (ESM). Run with `node proxy.js`. Listens on port 3000, forwards all requests to `https://www.xertonline.com`. Required for local dev only.
- **`netlify/functions/xert-proxy.js`** — Serverless proxy for production. Replaces `proxy.js` on Netlify. Uses built-in `fetch` (Node 18+).
- **`netlify.toml`** — Sets publish dir to `.`, points to functions directory, pins Node 18.
- **`package.json`** — `"type": "module"` (ESM), single dependency: `zwift-data`. Includes `build-routes` and `build-segments` scripts, both pointing at the same bundler.
- **`bundle-routes.mjs`** — bundler script that reads `routes` and `segments` from `zwift-data` and writes `routes-data.js` plus `segments-data.js`. Already been run — 320 routes and 102 climb/sprint segments written.
- **`xert-api-reference.md`** — local notes for auth, endpoint usage, and Daily Summary field mapping from Xert activity summaries.
- **`zwift-data-reference.md`** — local notes for package usage, route fields, segment fields, slug conventions, and the route/segment bundling flow.

### Core Logic
- **`scorer.js`** — pure functions, no DOM/API dependencies. Exports:
  - `classifyWOTD(wotd, ftp?)` → `'mixed_mode' | 'sustained_climb' | 'repeated_punchy' | 'sprint_power' | 'aerobic_endurance' | null`
    - Returns `null` (not `'recovery'`) when no WOTD is present — app falls back to bucket-deficit logic
    - Detects `mixed_mode` via three redundant conditions:
      1. `#MIXEDMODE` or `mixed mode` in description, OR `"MIXEDMODE"` in tags array
      2. `intervalPower > 1.5×FTP AND intervalDuration ≤ 30s AND lowRatio > 0.6`
      3. `xpss > 0 AND lowRatio > 0.7 AND duration > 60min`
    - FTP is passed in from `parseTrainingData` output via `analyzeTrainingDay`
  - `analyzeTrainingDay(tl, targetXSS, wotd, ftp?)` — no fallback heuristics; only classifies from the actual WOTD object
  - `detectBucket(tl, targetXSS)` → `'low' | 'high' | 'peak' | 'recovery'`
  - `scoreRoute(route, bucket)` → 0–100
  - `rankRoutes(routes, bucket)` → top 15
  - `optimizeRoutes(routes, options)` → top 15 using WOTD terrain match + bucket deficit + time fit
  - `wotdTerrainScore(route, wotdStructure, routeSegments)` — `mixed_mode` favors routes with sprint segments + flat distance
  - `generateRideCue(route, bucket, wotdStructure, routeSegments)` — WOTD-led cues; `mixed_mode` cue names sprint segments and instructs Z2 base + max sprint efforts

- **`xert.js`** — Xert API wrapper. Auto-detects environment (localhost → proxy, prod → Netlify function). Exports:
  - `authenticate`, `fetchTrainingInfo`, `fetchWorkout(workoutId)`, `fetchActivitiesInRange`, `fetchActivityDetail`, `parseTrainingData`, `clearToken`, `hasToken`
  - `fetchWorkout(workoutId)` — calls `GET /oauth/workout/{id}`, returns full workout with `workout[]` interval array plus `xlss`/`xhss`/`xpss`/`xss`/`duration`/`max_power`

- **`routes.js`** — re-exports from `routes-data.js`, exports `WORLD_NAMES`, the fixed guest-world schedule, `todaysWorlds()`, `filterToAvailableWorlds()`, and `worldName(slug)`.

- **`segments.js`** — segment lookup helpers over `segments-data.js`. Exports `climbWeight`, `getSegmentsForWorld`, `getSegmentsForRoute`.

- **`mock-data.js`** — canned test scenarios: `Live Xert`, `Mock: Recovery`, `Mock: Low Deficit`, `Mock: Mixed Deficits` (uses `#MIXEDMODE` tag), `Mock: Peak Focus`.

### UI
- **`index.html`** + **`style.css`** + **`app.js`** — single-page app.
  - Auth screen → signs in via xert.js, transitions to app on success
  - **Testing/dev data-source selector:** auth screen + settings expose `Live Xert` plus four canned mock scenarios
  - Status section: freshness badge, FTP, weight, W/kg, bucket bars (low/high/peak colored)
  - **Recommendation banner:** WOTD-first when a workout is classified; falls back to bucket-deficit copy when WOTD is absent
  - **Mixed-mode support:** `mixed_mode` days get: "Today calls for mixed efforts" banner, sprint+flat route ranking, per-card trust signals referencing combined low+high+peak support
  - **Freshness override:** Tired/Very Tired/Detraining → forced recovery with override note
  - **Time section:** slider (20–180 min), W/kg auto timing, manual speed override
  - **Ride cue strip:** `🎯` cue on each route card
  - **Segment chips / PR targeting:** climb and sprint chips with Strava links
  - **Imperial/metric toggle**, **Today's worlds filter**, **Recent Progress panel**

### WOTD fetch flow (live mode)
1. `refresh()` calls `fetchTrainingInfo` → stores `raw.wotd` as `state.rawWotd`
2. If `state.rawWotd.workoutId` exists, calls `fetchWorkout(workoutId)`
3. Merges workout detail into `state.rawWotd`:
   - All XSS fields: `xss`, `xlss`, `xhss`, `xpss`, `duration`
   - Sprint interval extraction: finds highest-power interval with `duration ≤ 30s`, sets `intervalPower` + `intervalDuration`
   - Patches `state.trainingData.wotd.name` / `.description` if training_info returned them as null
4. `analyzeTrainingDay(completed, targets, state.rawWotd, ftp)` classifies the enriched wotd

### Known Xert API behavior
- `training_info` returns `wotd: { type: 'None' }` with no workoutId when no workout is currently assigned
- When a workout IS assigned, `wotd` includes `workoutId`, `name`, `description` (may contain `#MIXEDMODE`), `type`
- The `type` field is `'None'` even when `workoutId` is present — do not gate on `type`; gate on `workoutId` presence
- Xert's XFAI system recalculates recommendations continuously; `targetXSS` and `wotd` can change between refreshes
- `GET /oauth/workouts` — user's workout library, same XSS field names (`xlss`/`xhss`/`xpss`/`xss`/`duration`)
- `GET /oauth/workout/{id}` — single workout with `workout[]` intervals; each interval has `power` (watts), `duration` (seconds), `mode` ("erg" or "slope"), `name`

### Test/validation files
- **`cors-test.html`** — CORS probe
- **`scorer-test.html`** — runs fixture routes through scorer.js
- **`xert-test.html`** — live Xert API test harness. Buttons: auth, format=zwo, GET /oauth/workouts, single workout probe, re-auth
- **`test-plan.md`** — full manual test plan
- **`rapid-qa-checklist.md`** — condensed pass/fail QA checklist

---

## Recently completed

1. **mixed_mode classification** — `classifyWOTD` detects mixed workouts via description text, tags array, and interval structure
2. **Workout fetch** — `fetchWorkout(workoutId)` added to xert.js; wired into `refresh()` with sprint interval extraction
3. **WOTD display patch** — when training_info returns a sparse wotd, name/description are backfilled from the fetched workout detail
4. **Removed bad heuristic** — `classifyTargetMix` (which inferred mixed_mode from targetXSS ratios) was removed; no more false mixed_mode on non-workout days
5. **Tags detection** — `"MIXEDMODE"` in Xert's tags array now detected alongside description text
6. **Bucket color system** — low/high/peak use consistent colors in bars, badges, and banner emphasis
7. **Mixed-mode trust signals** — route cards show combined low+high+peak support on mixed days
8. **WOTD-first ranking** — when a workout exists, WOTD terrain match is the primary ranking signal
9. **Segment-aware cues** — ride cues name specific climbs/sprints from route-linked segment data
10. **Optimizer-based ranking** — uses remaining deficits + time-fit + WOTD terrain score
11. **In-app mock scenarios** — main app can run canned recovery/low/mixed/peak scenarios
12. **Imperial/metric toggle**, **Today's worlds filter**, **Recent Progress panel**, **Freshness override**
13. **User-selectable guest worlds** — replaced hardcoded schedule with a user-driven picker; Watopia always on, rider picks two guest worlds; persists to localStorage
14. **Specialist scoring fix** — rewrote `bucketDeficitScore()` to weight active bucket at 65% vs 35% deficit balance; fixed all-rounder-beats-specialist bias
15. **Live tuning panel** — `scorer-test.html` now has 7 live sliders covering key scoring constants; rankings re-render on every slider move; `scorer.js` exports `DEFAULTS` and accepts optional overrides
16. **Full route dataset in scorer-test** — rankings and optimizer tables use all ~300 real routes; fixtures kept only for pass/fail heuristic checks
17. **W/kg difficulty labels** — Comfortable / Moderate / Challenging badge per route card, personalized to rider's gradient ratio vs W/kg; hidden in manual pace mode; thresholds `<2.5` / `2.5–5.0` / `>5.0`
18. **Lap/repeat suggestions** — when estimated route time fills ≤60% of budget and 2+ laps fit, shows "↩ Consider N laps (~Xm)" in route stats
19. **Share button** — copies PNG screenshot of card (html2canvas 2×) + plain text via `ClipboardItem`; paste destination picks best format; falls back to plain text
20. **Favorite routes** — star button on every card; gold star + amber left border; persisted to `localStorage` under `xert_favorites`; in-place DOM toggle, no re-render

---

## How to run locally

Two terminals needed simultaneously:

**Terminal 1:**
```bash
node proxy.js
# Xert proxy running at http://localhost:3000
```

**Terminal 2:**
```bash
npx serve .
# Visit the URL it prints (usually http://localhost:3001)
```

## Production
Deployed on Netlify, connected to `https://github.com/cr45hmurphy/zwift-route-recommender` (`master` branch). Auto-deploys on push.

---

## Known scoring observations
- Alpe du Zwift and Road to Sky correctly surface in HIGH bucket top 5 (elevation bonus).
- They are correctly excluded from PEAK top 5 (elevation cap: >500m scores 0).
- PEAK #1 is Volcano Climb (5 km, 170 m, 34 m/km) — correct.
- RECOVERY favors Tempus Fugit / Flat Out Fast style easy spins.
- Scoring thresholds still need tuning against real-world ride data.
- Ride cues are only as specific as the segment metadata available for a route.

## Git
Repo: `https://github.com/cr45hmurphy/zwift-route-recommender`
Branch: `master`
