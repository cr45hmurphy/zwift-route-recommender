# Catchup — What's Been Built

## Status: Working end-to-end. UI loads, auth works, routes render.

---

## What exists

### Infrastructure
- **`proxy.js`** — Node.js local proxy (ESM). Run with `node proxy.js`. Listens on port 3000, forwards all requests to `https://www.xertonline.com`. Required because Xert's API blocks direct browser requests (CORS).
- **`package.json`** — `"type": "module"` (ESM), single dependency: `zwift-data`.
- **`bundle-routes.mjs`** — one-time script that reads zwift-data and writes `routes-data.js`. Run with `node bundle-routes.mjs`. Already been run — 320 routes written.

### Core Logic
- **`scorer.js`** — pure functions, no DOM/API dependencies. Exports:
  - `detectBucket(tl, targetXSS)` → `'low' | 'high' | 'peak' | 'recovery'`
  - `scoreRoute(route, bucket)` → 0–100
  - `rankRoutes(routes, bucket)` → top 15 scored routes, filters out eventOnly and non-cycling
  - All scoring thresholds are named constants at the top of the file — tune them after seeing real output.

- **`xert.js`** — Xert API wrapper. Exports:
  - `authenticate(username, password)` — OAuth2 password grant, stores token in localStorage (1hr TTL)
  - `fetchTrainingInfo(username?, password?)` — fetches `/oauth/training_info` using stored token
  - `parseTrainingData(raw)` — extracts the fields the app uses (signature, tl, targetXSS, wotd, etc.)
  - `clearToken()`, `hasToken()`
  - Points at `http://localhost:3000` (the proxy), not xertonline.com directly.

- **`routes.js`** — re-exports from `routes-data.js`, exports `WORLD_NAMES` map and `worldName(slug)` helper.

### UI
- **`index.html`** + **`style.css`** + **`app.js`** — single-page app.
  - Auth screen → signs in via xert.js, transitions to app on success
  - Status section: freshness badge, FTP, weight, three bucket bars (current vs target, deficit highlighted)
  - Recommendation banner: which bucket needs work, plain-English explanation, WOTD if available
  - Route grid: top 5 cards (3-col desktop / 1-col mobile), "Other options" collapsible (next 10)
  - Settings footer: username/password fields for re-auth, refresh button

### Test/validation files (not part of production app)
- **`cors-test.html`** — tests whether Xert API is reachable directly or via proxy
- **`scorer-test.html`** — runs fixture routes through scorer.js and displays ranked output per bucket
- **`xert-test.html`** — live test of xert.js against a real Xert account, shows raw parsed values

---

## How to run

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

Then open the URL from Terminal 2 in a browser and sign in with Xert credentials.

---

## Known things to revisit (see parkinglot.md)

- Road to Sky and Alpe du Zwift rank lower than expected in the HIGH bucket because their gradient (83 m/km) exceeds `CLIMB_GRADIENT_MAX` of 25 and misses the bonus. The scoring constants may need tuning after real-world use.
- FTP/LTP/HIE/PP are displayed rounded — raw values from Xert have many decimal places.
- WOTD was empty in initial live test — UI handles this gracefully (hides the section).

---

## Git
Repo: `https://github.com/cr45hmurphy/zwift-route-recommender`  
Branch: `master`
