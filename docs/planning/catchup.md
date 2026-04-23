# Catchup

## Current State

The core Zwift route recommender / cue-generator overhaul is complete enough to move from buildout into polish, validation, and calibration. The app runs as a browser-based Xert-aware recommender with live or mock data, Zwift world filtering, route cards, time guidance, route profiles, route inspector, share/favorite controls, and Sauce-derived route/timeline data.

- Active branch: `claude/add-truncation-checks-6D1xi` (cue copy overhaul + display fixes)
- Last merged PRs: #13 inspector filters + browsing caps, #14 visual polish, #15 and #16 favicon

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

- Cue copy overhaul (Track C): established a four-level effort taxonomy (full gas / hard but controlled / steady threshold / Zone 2) and applied it consistently across all `generateRideCue()` branches. Segment lists capped at 3 named efforts with overflow rewritten as "repeat that pattern for the remaining N". `spacingNote()` rewritten as a rider instruction rather than a passive description. Mixed-route branches now give sprint intent and climb intent as two explicit sentences. LOW+HIGH honesty branches stripped of internal jargon. Recovery cue preserved unchanged.
- `renderTimeSummary()` display fix: when `bucketOverride` is set (Tired / Very Tired / Detraining override), the XSS fill calculation is skipped and recovery language is shown instead. `applyFreshnessOverride()` and all override logic untouched.
- `orderedTimelineEfforts()` defensive filter: explicit `type === 'segment'` guard added so named route-section segments (Hilly Loop Rev., London Loop, Crit City, etc.) cannot appear in effort cue lists regardless of future data changes.
- Login screen about section: collapsible "What is ZwiftBuckets?" details element, wider than the login column (640px), collapsed by default. Covers what the app does, the three Xert energy buckets, what it does and does not do, requirements, credentials/privacy explanation, and a legal disclaimer (not affiliated with or endorsed by Xert or Zwift, not Xert EBC, hobby project on public APIs).
- Auth screen app title changed from "Zwift Route Recommender" to "ZwiftBuckets".
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
- LOW day XSS badge fix: `executionFirstLowDay` now triggers for no-WOTD low days (`wotdStructure === null`), so the LOW badge shows unweighted XSS matching the timing text; zero-gap HIGH/PEAK badges suppressed in single-bucket mode.
- Route Inspector UX overhaul: replaced flat dropdown with search + world filter + bucket-support filter; browsing caps (Other options ≤5, If you had more time ≤8); profiles on over-budget compact cards (PR #13).
- Visual polish: Watopia title color lightened (#EE4000 → #F5784A); profile smoothing reduced to single-pass near-raw for more terrain character; mobile time slider fix (touch-action: pan-x, larger touch target) (PR #14).

---

## Active Follow-Ups

Use `docs/planning/parkinglot.md` as the source of truth. The highest-value next items are:

1. Manual QA round across mock scenarios, source labels, toggles, and scorer harness.
2. Live WOTD validation against a real or simulated `#MIXEDMODE` day.
3. Scoring/optimizer tuning: bucket weights, punch caps, LOW over-favor check.
4. Time guidance calibration: recommended-time picks first route-feasible time.

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
