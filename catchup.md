# Catchup — What's Been Built

## Status: Live on Netlify. End-to-end working with time feature and improved scoring.

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
  - All scoring thresholds are named constants at the top of the file

- **`xert.js`** — Xert API wrapper. Auto-detects environment:
  - `localhost` → `http://localhost:3000` (local proxy)
  - Production → `/.netlify/functions/xert-proxy`
  - Exports: `authenticate`, `fetchTrainingInfo`, `parseTrainingData`, `clearToken`, `hasToken`

- **`routes.js`** — re-exports from `routes-data.js`, exports `WORLD_NAMES` map and `worldName(slug)` helper.

### UI
- **`index.html`** + **`style.css`** + **`app.js`** — single-page app.
  - Auth screen → signs in via xert.js, transitions to app on success
  - Status section: freshness badge, FTP, weight, three bucket bars showing `TL X · target Y` with gap highlighted (labeled as training load vs daily target, not today's remaining XSS)
  - Recommendation banner: which bucket needs work, plain-English explanation using "training load is X below daily target" framing, WOTD if available
  - **Time section:** slider (20–180 min) + avg speed input (default 28 km/h). Shows estimated ride time per route card — green badge if fits, red badge with "+Xm over" if not. Summary line: "With 60 min at your pace, you'd generate ~65 XSS (48% of your low target)." Updates live on slider drag.
  - Route grid: top 5 cards (3-col desktop / 1-col mobile), "Other options" collapsible (next 10)
  - Settings footer: username/password fields for re-auth, refresh button

### Test/validation files (not part of production app)
- **`cors-test.html`** — tests whether Xert API is reachable directly or via proxy
- **`scorer-test.html`** — runs fixture routes through scorer.js and displays ranked output per bucket
- **`xert-test.html`** — live test of xert.js against a real Xert account, shows raw parsed values

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
- Alpe du Zwift and Road to Sky now correctly surface in HIGH bucket top 5 (elevation bonus fix).
- They also appear in PEAK top 5 (#2 and #3) — their 83 m/km gradient maxes the punch score and they're short enough to get distance points. Mathematically correct but they're sustained climbers not punchy routes. A distance cap fix is in the parking lot (Tier 1).
- PEAK #1 is Volcano Climb (5km, 34 m/km) — correct.

---

## Git
Repo: `https://github.com/cr45hmurphy/zwift-route-recommender`
Branch: `master`
Last commit: Add time feature, Netlify deployment, label + scoring fixes
