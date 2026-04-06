# Catchup — What's Been Built

## Status: Live on Netlify. End-to-end working with Daily Summary-style bucket tracking, W/kg timing with manual override, recent progress history, improved route trust signals, freshness-aware recovery fallback, and today's-world filtering.

---

## What exists

### Infrastructure
- **`proxy.js`** — Node.js local proxy (ESM). Run with `node proxy.js`. Listens on port 3000, forwards all requests to `https://www.xertonline.com`. Required for local dev only.
- **`netlify/functions/xert-proxy.js`** — Serverless proxy for production. Replaces `proxy.js` on Netlify. Uses built-in `fetch` (Node 18+).
- **`netlify.toml`** — Sets publish dir to `.`, points to functions directory, pins Node 18.
- **`package.json`** — `"type": "module"` (ESM), single dependency: `zwift-data`.
- **`bundle-routes.mjs`** — one-time script that reads zwift-data and writes `routes-data.js`. Already been run — 320 routes written.
- **`xert-api-reference.md`** — local notes for auth, endpoint usage, and Daily Summary field mapping from Xert activity summaries.
- **`zwift-data-reference.md`** — local notes for package usage, route fields, slug conventions, and the route-data bundling flow.

### Core Logic
- **`scorer.js`** — pure functions, no DOM/API dependencies. Exports:
  - `detectBucket(tl, targetXSS)` → `'low' | 'high' | 'peak' | 'recovery'`
  - `scoreRoute(route, bucket)` → 0–100
  - `rankRoutes(routes, bucket)` → top 15 scored routes, filters out eventOnly and non-cycling
  - HIGH bucket fix: routes with ≥1000m elevation (`CLIMB_ELEVATION_BIG`) receive the gradient bonus regardless of gradient ratio — surfaces Alpe du Zwift and Road to Sky correctly
  - PEAK bucket fix: routes with >500m elevation (`PUNCH_ELEVATION_CAP`) score 0 — prevents sustained climbers (Alpe, Road to Sky) from hijacking the punchy bucket
  - RECOVERY fix: recovery now scores short, flat, low-elevation spins higher than long flat endurance routes
  - All scoring thresholds are named constants at the top of the file

- **`xert.js`** — Xert API wrapper. Auto-detects environment:
  - `localhost` → `http://localhost:3000` (local proxy)
  - Production → `/.netlify/functions/xert-proxy`
  - Exports auth/token helpers plus `fetchTrainingInfo`, activity list/detail fetch helpers, and `parseTrainingData`
  - `training_info` is now used for status/signature/weight/targets/WOTD only
  - today's completed low/high/peak totals are derived from activity summary `xlss/xhss/xpss/xss`

- **`routes.js`** — re-exports from `routes-data.js`, exports `WORLD_NAMES`, the fixed guest-world schedule, `todaysWorlds()`, `filterToAvailableWorlds()`, and `worldName(slug)`.

### UI
- **`index.html`** + **`style.css`** + **`app.js`** — single-page app.
  - Auth screen → signs in via xert.js, transitions to app on success
  - Status section: freshness badge, FTP, weight, W/kg, and three bucket bars showing completed vs target with remaining amount
  - Recommendation banner: which bucket still needs work today, plain-English explanation, WOTD if available
  - **Freshness override:** when Xert reports Tired / Very Tired / Detraining, recommendations are forced to recovery and a yellow override note explains why
  - **Time section:** slider (20–180 min) + W/kg-based auto timing with optional manual speed override. Routes are partitioned by time budget:
    - Within-budget routes fill the primary grid + "Other options" collapsible (score-sorted)
    - Over-budget routes go into a "If you had more time" collapsible, sorted by nearest first
    - Each card shows a green/red time badge plus trust/impact badges like `~% of low left`, `XSS toward low`, and `Best for low remaining`
    - No more opacity dimming — routes are separated, not faded
  - **Imperial/metric toggle:** `km/m` | `mi/ft` buttons in settings footer, stored in localStorage. Avg speed input converts between km/h and mph. All internal math stays metric.
  - **Today's worlds filter:** checkbox defaults on, persists in localStorage, and limits recommendations to Watopia plus the current guest world
  - **Recent Progress panel:** local history keeps one snapshot per day and shows completed-vs-target progress once at least two saved days exist
  - Route grid: top 5 cards (3-col desktop / 1-col mobile), "Other options" collapsible, "If you had more time" collapsible
  - Settings footer: username/password fields for re-auth, unit toggle, refresh button

### Test/validation files (not part of production app)
- **`cors-test.html`** — tests whether Xert API is reachable directly or via proxy
- **`scorer-test.html`** — runs fixture routes through scorer.js and displays ranked output per bucket
- **`xert-test.html`** — live test of xert.js against a real Xert account, shows raw `training_info` plus today's activity summaries

---

## Recently completed

Recent completed work includes:

1. **RECOVERY scoring fix** — recovery recommendations now favor short, easy spins instead of reusing LOW scoring.
2. **Freshness-aware scoring** — tired statuses override the detected bucket and steer the rider to recovery routes.
3. **Today's worlds filter** — route ranking can be limited to the currently rideable worlds in Zwift.
4. **Daily Summary alignment** — the app now uses Xert activity summaries to derive completed low/high/peak/total buckets for today.
5. **W/kg timing + recent progress** — route timing defaults to rider W/kg, with manual override, and the app stores one progress snapshot per day.
6. **Trust-signal polish** — route cards and time summary now expose clearer bucket-fill and contribution cues.

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
- Scoring thresholds (PUNCH_ELEVATION_CAP, PUNCH_DISTANCE_MAX, etc.) will need further tuning against real-world ride data.

---

## Git
Repo: `https://github.com/cr45hmurphy/zwift-route-recommender`
Branch: `master`
Most recent local work before this update: Daily Summary alignment, local API reference docs, W/kg timing, recent progress panel, and route trust-signal polish
