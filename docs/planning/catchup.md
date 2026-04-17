# Catchup

## Current State

The core Zwift route recommender / cue-generator overhaul is complete enough to move from buildout into polish, validation, and calibration. The app runs as a browser-based Xert-aware recommender with live or mock data, Zwift world filtering, route cards, time guidance, route profiles, route inspector, share/favorite controls, and Sauce-derived route/timeline data.

- Active branch: `feature/zwift-cdn-overhaul`
- Merge target: `master`
- Draft PR: https://github.com/cr45hmurphy/zwift-route-recommender/pull/9

The active future-work list is now `docs/planning/parkinglot.md`. The former Route Recommender design brief has been archived under `docs/planning/archive/`.

---

## What Is Built

### App And Runtime
- Static app lives in `public/`: `index.html`, `assets/style.css`, `app/app.js`.
- Core browser modules live in `public/app/core/`.
- Generated route data lives in `public/app/data/`; treat generated files as build output.
- Netlify functions provide Xert and world-schedule proxy support.
- Local validation can use `npm run serve` for static mode or `npx netlify dev` when functions/proxy behavior matters.

### Xert Integration
- `public/app/core/xert.js` handles auth, training info, WOTD detail fetch, activity summaries, token storage, and environment-specific proxy selection.
- Live WOTD enrichment is wired: `training_info -> workoutId -> fetchWorkout() -> rawWotd enrichment -> classifyWOTD()`.
- Mock scenarios exist for recovery, low deficit, mixed deficits, peak focus, missing signature, empty history, and tired deficit.
- `?mock=<id>` can persist a mock scenario for QA.

### Recommendation Logic
- `public/app/core/scorer.js` is pure logic: bucket detection, WOTD classification, route scoring, optimizer, route honesty labels, and ride cues.
- WOTD-first matching works when workout detail is available; otherwise the app falls back to bucket-deficit logic.
- Tired / Very Tired / Detraining freshness overrides bias to recovery.
- Favorites get a small self-limiting ranking nudge.
- Time guidance uses W/kg-derived effective speed with gradient penalty and manual speed override.

### Zwift Route Data
- `scripts/build-zwift-data.mjs` pulls Zwift/Sauce-derived data at build time and regenerates:
  - `routes-data.js`
  - `segments-data.js`
  - `route-timelines-data.js`
  - `zwift-metadata.js`
- Sauce is a build-time data source, not a runtime dependency.
- Native route profiles and timeline-aware effort ordering are generated into committed data.
- `ROUTE_SEGMENT_OVERRIDES` handles known Sauce projection gaps.

### UI
- Route cards show score, world, distance/elevation/gradient, time estimate, bucket support, route truth, ride cue, segments, profile, share, favorite, and external links.
- Route Inspector can inspect routes outside today's active worlds.
- Today's-world filtering prefers complete live/proxy data, then supplements partial data from the built-in Zwift schedule only after trying all live/proxy sources.
- Source labels are formatted as `Worlds (via Source)` with a tooltip containing source/fetch/fallback detail.
- Share supports image copy and plain text copy.
- Plan history is saved locally in `xert_plan_history`, but no reopen gate is shown.

---

## Recently Completed

- Sauce-derived CDN route/timeline/profile overhaul.
- Native route profiles with flat-route phantom profile fixes.
- Time estimation overhaul and recommended-time groundwork.
- Route honesty label tightening, including protection against fake `TRUE mixed` labels when PEAK support is near zero.
- Downhill traversal filtering for climb/PEAK opportunities.
- Share image/text repair.
- Favorite route boost.
- Mock scenario expansion and `?mock=<id>`.
- LOW-day execution display fix.
- World-schedule UI polish: complete-source preference, fallback source labeling, source tooltip, route-card count fix, and world title color readability pass.
- Parking-lot consolidation and Route Recommender design doc archival.

---

## Active Follow-Ups

Use `docs/planning/parkinglot.md` as the source of truth. The highest-value next items are:

1. Route browsing cleanup: cap `If you had more time`, reconsider `Other options`, add profiles to over-budget cards.
2. Route Inspector UX: better route finding/filtering, remove `Key efforts`, support bucket-based discovery.
3. Visual polish: lighten Watopia title color slightly, reduce profile smoothing a bit, mobile pass.
4. Manual QA round across mock scenarios, source labels, toggles, and scorer harness.
5. Live WOTD validation against a real or simulated `#MIXEDMODE` day.

---

## Test And Verification Commands

- `npm run test:ui-fixes`
- `npm run test:scorer`
- `npm run test:profiles`
- `npm run build-routes` after build-pipeline or upstream route-data changes

Manual harnesses:
- `public/tests/scorer-test.html`
- `public/tests/xert-test.html`
- `public/tests/cors-test.html`

---

## Operational Notes

- Do not commit live Xert credentials or tokens.
- Use `npx netlify dev` when validating serverless proxy paths.
- Generated data files should be committed together with any generator/source-version change that produced them.
- `zwift-data` remains installed as temporary compatibility support for slugs/external links while the generated data path continues to settle.
