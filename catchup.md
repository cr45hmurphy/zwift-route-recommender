# Catchup — What's Been Built

## Status: Live on Netlify. End-to-end working with time re-ranking, unit toggle, improved scoring, freshness-aware recovery fallback, and today's-world filtering.

---

## What exists

### Infrastructure
- **`proxy.js`** — Node.js local proxy (ESM). Run with `node proxy.js`. Listens on port 3000, forwards all requests to `https://www.xertonline.com`. Required for local dev only.
- **`netlify/functions/xert-proxy.js`** — Serverless proxy for production. Replaces `proxy.js` on Netlify. Uses built-in `fetch` (Node 18+).
- **`netlify.toml`** — Sets publish dir to `.`, points to functions directory, pins Node 18.
- **`package.json`** — `"type": "module"` (ESM), single dependency: `zwift-data`.
- **`bundle-routes.mjs`** — one-time script that reads zwift-data and writes `routes-data.js`. Already been run — 320 routes written.

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
  - Exports: `authenticate`, `fetchTrainingInfo`, `parseTrainingData`, `clearToken`, `hasToken`

- **`routes.js`** — re-exports from `routes-data.js`, exports `WORLD_NAMES`, the fixed guest-world schedule, `todaysWorlds()`, `filterToAvailableWorlds()`, and `worldName(slug)`.

### UI
- **`index.html`** + **`style.css`** + **`app.js`** — single-page app.
  - Auth screen → signs in via xert.js, transitions to app on success
  - Status section: freshness badge, FTP, weight, three bucket bars showing `TL X · target Y` with gap highlighted
  - Recommendation banner: which bucket needs work, plain-English explanation, WOTD if available
  - **Freshness override:** when Xert reports Tired / Very Tired / Detraining, recommendations are forced to recovery and a yellow override note explains why
  - **Time section:** slider (20–180 min) + avg speed input. Routes are partitioned by time budget:
    - Within-budget routes fill the primary grid + "Other options" collapsible (score-sorted)
    - Over-budget routes go into a "If you had more time" collapsible, sorted by nearest first
    - Each card shows a green/red time badge and an XSS fill% badge (e.g. `~43% low target`)
    - No more opacity dimming — routes are separated, not faded
  - **Imperial/metric toggle:** `km/m` | `mi/ft` buttons in settings footer, stored in localStorage. Avg speed input converts between km/h and mph. All internal math stays metric.
  - **Today's worlds filter:** checkbox defaults on, persists in localStorage, and limits recommendations to Watopia plus the current guest world
  - Route grid: top 5 cards (3-col desktop / 1-col mobile), "Other options" collapsible, "If you had more time" collapsible
  - Settings footer: username/password fields for re-auth, unit toggle, refresh button

### Test/validation files (not part of production app)
- **`cors-test.html`** — tests whether Xert API is reachable directly or via proxy
- **`scorer-test.html`** — runs fixture routes through scorer.js and displays ranked output per bucket
- **`xert-test.html`** — live test of xert.js against a real Xert account, shows raw parsed values

---

## Recently completed

The three items that were previously tracked in `planning.md` are now implemented:

1. **RECOVERY scoring fix** — recovery recommendations now favor short, easy spins instead of reusing LOW scoring.
2. **Freshness-aware scoring** — tired statuses override the detected bucket and steer the rider to recovery routes.
3. **Today's worlds filter** — route ranking can be limited to the currently rideable worlds in Zwift.

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
- Scoring thresholds (PUNCH_ELEVATION_CAP, PUNCH_DISTANCE_MAX, etc.) will need further tuning against real-world ride data.

---

## Git
Repo: `https://github.com/cr45hmurphy/zwift-route-recommender`
Branch: `master`
Last pushed feature commit: `6657c78` — recovery scoring, freshness override, today's-world filter, and `AGENTS.md`
