# Context

Sonnet 4.6 already shipped the segment-ordering build pipeline (Sauce v2.2.1 → `route-timelines-data.js` with `{order, startKm, endKm}` per occurrence). Two follow-ups remain:

1. **Chip-render order** — route detail/inspector chips still display via `getSegmentsForRoute()`, which sorts by importance, not by encounter order. Duplicate hits (lap routes hitting Fuego Flats 3x) collapse to a single chip with no count.
2. **Edge-case validation** — `parkinglot.md` lines 79–85 calls out 5 routes whose timeline order has not been ground-truthed against ZwiftInsider: Road to Sky, Tempus Fugit, Surrey Hills, Triple Flat Loops, 2018 Worlds Short Lap.

Validation runs first so chip-order changes don't expose latent data bugs in production.

---

# Phase A — Edge-case route validation

**Goal**: confirm `route-timelines-data.js` segment order matches ZwiftInsider for 5 routes; surface any Sauce-mapping bugs before changing the UI.

## Steps

1. Build a fixture at `public/tests/fixtures/expected-route-segments.js` listing expected segments **in encounter order** for each of the 5 routes, with duplicate hits explicit. Source: ZwiftInsider route pages. Shape:
   ```js
   export const expected = {
     'road-to-sky': ['epic-kom-forward'],
     'tempus-fugit': ['fuego-flats-rev', 'fuego-flats-fwd', 'fuego-flats-rev'],
     // ...
   };
   ```
2. Add `public/tests/route-timeline-validation.html` — manual harness that imports `getRouteTimeline()` from `public/app/core/timelines.js` plus the fixture, renders a side-by-side table per route (expected vs actual), and highlights mismatches.
3. Run the harness via `npm run serve`. For each red row, decide: data bug (fix in `scripts/build-zwift-data.mjs` Sauce mapping) or fixture wrong (fix the fixture).
4. Re-run `node scripts/build-zwift-data.mjs` after any build-script fix; commit regenerated data files.

**Exit criteria**: all 5 routes green in the validation harness, with duplicate hits showing matching counts.

**Critical files**:
- `scripts/build-zwift-data.mjs` (lines 1158–1211 — Sauce segment mapping; only edit if a route fails validation)
- `public/app/data/route-timelines-data.js` (regenerated; do not hand-edit)
- `public/app/core/timelines.js:10` (`getRouteTimeline` — read-only)
- `public/tests/fixtures/expected-route-segments.js` (new)
- `public/tests/route-timeline-validation.html` (new)

---

# Phase B — Timeline-order chip rendering with duplicate counts

**Goal**: route inspector chips render in chronological order with `xN` suffix for repeat hits; route cards keep current marquee-first sort.

## Steps

1. **New helper in `public/app/core/segments.js`**: export `getOrderedSegmentsForRoute(route)` that:
   - Calls `getRouteTimeline(route)` and `expandTimelineForLaps()`
   - Collapses consecutive/repeated occurrences of the same segment slug into `{segment, count}` tuples preserving first-encounter order
   - Falls back to existing `getSegmentsForRoute(route)` (weight-sorted, count=1) when no timeline exists
   - Returns the same partitioned shape as today (`{climbs, sprints, segments, source}`) but each entry carries `count`

2. **Chip render update in `public/app/app.js:1486`** (the `segment-chip` builder): when `count > 1`, append `× ${count}` to the chip label. CSS class unchanged.

3. **Wire ordered helper into inspector surfaces only**:
   - `app.js:773` (route detail block) → swap `getSegmentsForRoute` → `getOrderedSegmentsForRoute`
   - `app.js:816` (full segment list) → swap
   - **Leave** `app.js:883` and `app.js:1157` (route picker / share-card path) on `getSegmentsForRoute` — those want marquee-first

4. **Share-text path** (`app.js:1393` chipLine, `app.js:2327` chip-trim): verify ordered chips truncate sensibly when `totalCount > shareLimit`. The "+N more" chip already exists at `app.js:2331–2335`; should still work since order is preserved.

5. **Manual UI smoke test** via `npm run serve`:
   - Open Tempus Fugit (lap route) — expect `Fuego Flats × 3` style chip
   - Open Road to Sky — expect single chip in encounter order
   - Open a non-lap route (Going Coastal) — expect ordered chips, no `xN` suffixes
   - Confirm route picker cards still show marquee-first chip order (unchanged)

**Critical files**:
- `public/app/core/segments.js:42` (extend with new export)
- `public/app/core/timelines.js:78` (`uniqueTimelineSegments` — reuse, possibly extend to return counts)
- `public/app/app.js:773, 816, 1486` (call-site + render swaps)
- `public/assets/style.css:862` (`.segment-chip` — no changes expected; verify `× N` doesn't break layout)

**Reuse**: `getRouteTimeline`, `expandTimelineForLaps`, `uniqueTimelineSegments` already do the heavy lifting in `timelines.js` — the new helper is a thin wrapper plus a count collapser.

---

# Verification

End-to-end checks after both phases land:

1. `node scripts/build-zwift-data.mjs` runs clean; no diffs in `route-timelines-data.js` after Phase A unless a real bug was fixed.
2. `public/tests/route-timeline-validation.html` shows all 5 routes green.
3. `npm run serve` smoke checks:
   - Tempus Fugit inspector chips: `Fuego Flats Rev × 2`, `Fuego Flats` (or whatever ZwiftInsider says — driven by fixture from Phase A)
   - Road to Sky inspector: single `Epic KOM` chip in correct position
   - Going Coastal inspector: chronological chip order, no counts
   - Route picker cards (any world): chip order unchanged from today (marquee-first)
4. Share-card screenshot for a lap route: confirms `× N` chips render and truncate cleanly with the existing "+N more" overflow.
