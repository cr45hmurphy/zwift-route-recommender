# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For the current file layout and working conventions, use `AGENTS.md` as the source of truth. This file keeps the higher-level project notes and intent.

## Project Overview

A single-page web app (no backend required) that pulls Xert fitness data, calculates energy bucket deficits, and recommends Zwift routes to fill the most depleted system. Full spec: `docs/reference/zwift-route-recommender-spec.md`.

## Build Order

1. **Test CORS first** — before any UI, verify Xert's API responds to a direct browser `fetch`. If blocked, build `scripts/proxy.js` first.
2. **Build `public/app/core/scorer.js` in isolation** — pure math, no API or DOM dependencies. Validate that the right routes surface before wiring auth or UI.
3. **Wire `public/app/core/xert.js`** — auth + data fetch.
4. **Build UI last** — `public/index.html`, `public/assets/style.css`, rendering in `public/app/app.js`.

## Build & Run

This is a static frontend app using vanilla HTML/CSS/JS with one npm dependency.

```bash
npm install          # installs zwift-data
# Open index.html directly in browser, OR serve locally:
npm run serve
```

**CORS issue:** Xert's API (`https://www.xertonline.com/oauth/`) will likely block direct browser requests. A minimal local proxy may be needed:
```bash
node scripts/proxy.js
```

## File Architecture

```
public/index.html            — single page shell
public/assets/style.css      — app styles
public/app/app.js            — orchestration: init, auth flow, rendering
public/app/core/xert.js      — Xert OAuth2 + API wrapper; stores token in localStorage
public/app/core/scorer.js    — route scoring logic (pure functions, no side effects)
public/app/core/routes.js    — route metadata helpers and world filters
public/app/core/segments.js  — segment metadata helpers
public/app/data/*.js         — mock and generated browser data
public/tests/*.html          — manual validation harnesses
scripts/bundle-routes.mjs    — generates route and segment data
scripts/proxy.js             — local proxy for CORS debugging
```

## Key Architecture Decisions

**No framework** — vanilla JS only. Avoid introducing React/Vue/etc.

**zwift-data** is imported as an npm package (`import { routes } from 'zwift-data'`). Route data is bundled at build time — no API calls needed for route data.

**Xert auth** uses OAuth2 password grant with public client credentials (`xert_public`/`xert_public`). Token stored in `localStorage`. Endpoint: `POST https://www.xertonline.com/oauth/token`.

## Core Scoring Logic

The scoring in `scorer.js` maps Xert's three energy buckets to route characteristics:

- **Low bucket** (aerobic/LTP) → long flat routes: score favors distance ≥40km, gradient ≤15m/km
- **High bucket** (threshold/HIE) → climbing routes: score favors elevation ≥800m, gradient 8–25m/km  
- **Peak bucket** (neuromuscular/PP) → short punchy routes: score favors gradient ≥30m/km, distance ≤20km

`gradientRatio = elevation / distance` is the key derived metric. Top 5 routes displayed; next 10 in a collapsed "Other options" section.

All scoring thresholds (e.g. `40` km for flat, `800` m elevation for climbing, `8`/`25` m/km gradient band) must be named constants at the top of `scorer.js` — they will need tuning after seeing real recommendations.

**Recovery mode:** when all bucket deficits are ≤ 0, recommend flat/short/easy routes regardless of scores.

## World Name Slugs

`zwift-data` uses slugs (e.g. `"watopia"`). Map to display names using the `WORLD_NAMES` constant defined in the spec. Keep this mapping in `public/app/core/routes.js`.

## Data Shape Reference

From Xert `/training_info`:
- `signature.ftp`, `signature.hie`, `signature.pp`, `signature.ltp`
- `tl.low`, `tl.high`, `tl.peak` — current training loads
- `targetXSS.low`, `targetXSS.high`, `targetXSS.peak` — daily targets
- `status` — freshness string ("Fresh", "Tired", "Very Tired", etc.)
- `wotd.name`, `wotd.difficulty`, `wotd.description` — workout of the day
- `weight` — rider weight in kg
