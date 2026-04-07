# Catchup — What's Been Built

## Status: Live on Netlify. End-to-end working with Daily Summary-style bucket tracking, multi-bucket/time-aware route optimization, W/kg timing with manual override, recent progress history, improved route trust signals, freshness-aware recovery fallback, today's-world filtering, segment-aware ride cues, route-card PR links when segment data exists, and in-app mock scenarios for QA.

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
  - `detectBucket(tl, targetXSS)` → `'low' | 'high' | 'peak' | 'recovery'`
  - `classifyWOTD(wotd)` → `'sustained_climb' | 'repeated_punchy' | 'sprint_power' | 'aerobic_endurance' | 'recovery'`
  - `analyzeTrainingDay(current, target, wotd)` → `{ bucket, wotdStructure }`
  - `scoreRoute(route, bucket)` → 0–100
  - `rankRoutes(routes, bucket)` → top 15 scored routes, filters out eventOnly and non-cycling
  - `optimizeRoutes(routes, options)` → top 15 routes using remaining bucket deficits + time-fit, with recovery handled separately
  - `generateRideCue(route, bucket, wotdStructure, routeSegments)` → plain-English pre-ride intent cue tied to the route and workout structure
  - Optimizer sorts routes by weighted utility across low/high/peak deficits instead of relying only on the single detected bucket for ranking
  - Optimizer adds deterministic tie handling (`OPTIMIZER_SORT_EPSILON` + stable route key) so tiny manual-speed changes do not cause obvious near-tie jitter
  - HIGH bucket fix: routes with ≥1000m elevation (`CLIMB_ELEVATION_BIG`) receive the gradient bonus regardless of gradient ratio — surfaces Alpe du Zwift and Road to Sky correctly
  - PEAK bucket fix: routes with >500m elevation (`PUNCH_ELEVATION_CAP`) score 0 — prevents sustained climbers (Alpe, Road to Sky) from hijacking the punchy bucket
  - RECOVERY fix: recovery now scores short, flat, low-elevation spins higher than long flat endurance routes
  - WOTD classifier uses the raw `training_info.wotd` payload when structure fields are present and falls back safely to aerobic-endurance intent when they are not
  - All scoring thresholds are named constants at the top of the file

- **`xert.js`** — Xert API wrapper. Auto-detects environment:
  - `localhost` → `http://localhost:3000` (local proxy)
  - Production → `/.netlify/functions/xert-proxy`
  - Exports auth/token helpers plus `fetchTrainingInfo`, activity list/detail fetch helpers, and `parseTrainingData`
  - `training_info` is now used for status/signature/weight/targets/WOTD only
  - today's completed low/high/peak totals are derived from activity summary `xlss/xhss/xpss/xss`

- **`routes.js`** — re-exports from `routes-data.js`, exports `WORLD_NAMES`, the fixed guest-world schedule, `todaysWorlds()`, `filterToAvailableWorlds()`, and `worldName(slug)`.

- **`segments.js`** — segment lookup helpers over `segments-data.js`. Exports:
  - `climbWeight(climbType)` for HC/1/2/3/4 sorting
  - `getSegmentsForWorld(worldSlug)` for world-level climb/sprint lookup
  - `getSegmentsForRoute(route)` which prefers route-linked segment slugs (`segmentsOnRoute` + `segments`) and falls back to world-level only when route data is missing

- **`mock-data.js`** — canned test scenarios for `Live Xert`, `Mock: Recovery`, `Mock: Low Deficit`, `Mock: Mixed Deficits`, and `Mock: Peak Focus`. Lets the main app exercise non-recovery paths without depending on real Xert state.

### UI
- **`index.html`** + **`style.css`** + **`app.js`** — single-page app.
  - Auth screen → signs in via xert.js, transitions to app on success
  - **Testing/dev data-source selector:** auth screen + settings now expose `Live Xert` plus four canned mock scenarios
  - Status section: freshness badge, FTP, weight, W/kg, and three bucket bars showing completed vs target with remaining amount
  - Recommendation banner: which bucket still needs work today, plain-English explanation, WOTD if available
  - **Freshness override:** when Xert reports Tired / Very Tired / Detraining, recommendations are forced to recovery and a yellow override note explains why
  - **Time section:** slider (20–180 min) + W/kg-based auto timing with optional manual speed override. Ranking now recomputes when time or pace changes, not just section placement. Routes are partitioned by time budget:
    - Within-budget routes fill the primary grid + "Other options" collapsible (score-sorted)
    - Over-budget routes go into a "If you had more time" collapsible, sorted by nearest first
    - Each card shows a green/red time badge plus trust/impact badges like `~% of low left`, `XSS toward low`, and `Best for low remaining`
    - No more opacity dimming — routes are separated, not faded
  - **Manual speed bounds fix:** imperial mode now uses converted spinner bounds instead of the old hard-coded `15 mph` floor
  - **Ride cue strip:** each route card now shows a `🎯` cue derived from bucket + WOTD structure + available climb/sprint segments, telling the rider how to ride the route rather than just which route to pick
  - **Segment chips / PR targeting:** route cards show climb and sprint chips when route-linked segment data exists; chips open Strava PR links when `stravaSegmentUrl` is available
  - **Fallback behavior:** if a route lacks route-linked segments, the cue still falls back generically but the app suppresses the world-level segment-chip wall to avoid misleading "all Watopia segments" style output
  - **Imperial/metric toggle:** `km/m` | `mi/ft` buttons in settings footer, stored in localStorage. Avg speed input converts between km/h and mph. All internal math stays metric.
  - **Today's worlds filter:** checkbox defaults on, persists in localStorage, and limits recommendations to Watopia plus the current guest world
  - **Recent Progress panel:** local history keeps one snapshot per day and shows completed-vs-target progress once at least two saved days exist. UI now explicitly notes that history is browser-local.
  - **Mock scenario history behavior:** mock mode uses existing local history for reference but does not write new snapshots
  - Route grid: top 5 cards (3-col desktop / 1-col mobile), "Other options" collapsible, "If you had more time" collapsible
  - Settings footer: username/password fields for re-auth, unit toggle, refresh button

### Test/validation files (not part of production app)
- **`cors-test.html`** — tests whether Xert API is reachable directly or via proxy
- **`scorer-test.html`** — runs curated fixture routes through scorer.js and displays ranked output per bucket plus optimizer scenarios and a deterministic-tie stability check
- **`xert-test.html`** — live test of xert.js against a real Xert account, shows raw `training_info` plus today's activity summaries
- **`test-plan.md`** — full manual test plan for live mode, mock scenarios, optimizer checks, speed bounds, history behavior, and harness validation
- **`rapid-qa-checklist.md`** — condensed pass/fail QA checklist for quick smoke runs

---

## Recently completed

Recent completed work includes:

1. **RECOVERY scoring fix** — recovery recommendations now favor short, easy spins instead of reusing LOW scoring.
2. **Freshness-aware scoring** — tired statuses override the detected bucket and steer the rider to recovery routes.
3. **Today's worlds filter** — route ranking can be limited to the currently rideable worlds in Zwift.
4. **Daily Summary alignment** — the app now uses Xert activity summaries to derive completed low/high/peak/total buckets for today.
5. **W/kg timing + recent progress** — route timing defaults to rider W/kg, with manual override, and the app stores one progress snapshot per day.
6. **Trust-signal polish** — route cards and time summary now expose clearer bucket-fill and contribution cues.
7. **Segment-aware ride cues** — route cards now attach a pre-ride intent cue based on WOTD structure plus route-linked climbs/sprints when available.
8. **Segment bundling + PR chips** — `zwift-data` segments are now bundled locally, exposed through `segments.js`, and shown as Strava-linked climb/sprint chips on route cards when the route has segment data.
9. **Optimizer-based ranking** — route ranking now uses remaining low/high/peak deficits plus time-fit instead of only the single detected bucket.
10. **Ranking stability pass** — near-tied optimizer results now sort more deterministically, reducing noisy reorder flips from tiny manual-speed changes.
11. **In-app mock scenarios** — the main app can now run with canned recovery/low/mixed/peak scenarios for QA and manual validation.
12. **QA docs + speed-bound fix** — added full/rapid test docs and fixed the imperial manual-speed input floor.

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
- RECOVERY now favors Tempus Fugit / Flat Out Fast style easy spins over longer endurance routes.
- Daily bucket bars now align with Xert Daily Summary-style completed totals more closely than the old TL-based display.
- Ride cues are only as specific as the segment metadata available for a route. Many routes have route-linked segment data, but some still fall back to generic cues because `zwift-data` does not attach segments to that route.
- Scoring thresholds (PUNCH_ELEVATION_CAP, PUNCH_DISTANCE_MAX, etc.) still need further tuning against real-world ride data.
- Mock QA surfaced a likely optimizer issue in longer PEAK scenarios: low/high support can still dominate too much when time budgets get large.
- The `~100% of low left` / `~100% of peak left` trust-signal copy is confusing in practice and likely needs replacement.
- Bucket-fill badges would benefit from stronger color mapping (low = green, high = blue, peak = red) to make the active bucket contribution easier to scan.

---

## Git
Repo: `https://github.com/cr45hmurphy/zwift-route-recommender`
Branch: `master`
Most recent local work before this update: optimizer-based ranking, deterministic tie handling, in-app mock QA scenarios, updated QA docs, and the manual-speed imperial bounds fix
