# Route Recommender — Design Redesign

## Based on Test Ride #1: Sugar Cookie, Watopia — April 11 2026

## Implementation Status — April 16 2026

This document started as a redesign brief. It now serves as the design-status document for the `feature/zwift-cdn-overhaul` branch. Treat the Sugar Cookie findings below as historical context; this top section is the current source of truth for what the redesign has already fixed and what remains outstanding.

---

### ✅ Fully implemented

- **Route positioning / timeline layer.** Route timelines keyed by route `signature` are generated into `public/app/data/route-timelines-data.js` via `scripts/build-zwift-data.mjs` (Sauce-derived route manifests, not a runtime dependency).
- **Cue generation is timeline-aware.** `generateRideCue()` uses ordered effort occurrences, recovery-gap notes, and route-order cues when timeline data exists.
- **Lap logic.** Recommended lap count computed and surfaced in UI; timeline layer can expand lap routes for repeated occurrences.
- **Route inspection tooling.** Route Inspector in the UI lets you pick any route regardless of today's worlds.
- **Ordered route sequence inspection.** Route cards show an ordered preview of effort points with a full-sequence expander.
- **Recovery spacing (first pass).** Closely spaced efforts flagged in cue copy.
- **Today's worlds / event-only / level-locked visibility.** Cards surface `Not in today's worlds`, `Event only`, `Direct inspection`, and `Level locked` flags.
- **Zwift schedule/world availability integration.** Today's-world filtering now prefers Zwift's published guest-world rotation and keeps the old manual picker as a fallback when schedule data is unavailable.
- **`classifySegmentBucket(segment)` — scorer.js.** Classifies each segment as `'high'` or `'peak'` based on type + `avgIncline` + `distance`. Sprints always → HIGH. Short steep climbs (≥8%, <2 km) → PEAK. Very short climbs with no grade data (<1 km) → PEAK. Sustained/moderate climbs → HIGH. Exported from `scorer.js`.
- **Route honesty labels, tightened pass.** The app exposes route-truth flags such as `LOW+HIGH route` and `TRUE mixed`, and recent tuning raised PEAK support thresholds, raised the `maxPeak` floor, lowered the compact PEAK gain minimum, and filters downhill traversals so routes with near-zero PEAK support are less likely to be mislabeled as true mixed.
- **Per-bucket XSS badges on route cards — app.js.** Replaced the single blended "~89% of HIGH gap" badge with three per-bucket badges: `LOW ~X/Y · HIGH ~X/Y · PEAK ~X/Y`. HIGH and PEAK show `~0` when no qualifying segments exist. World-fallback routes (no route segment data) show only the LOW badge. Recovery path shows a single LOW estimate.
- **Route honesty label in route flags.** "TRUE mixed" or "LOW+HIGH route" pill shown in the flags row on each card. Styled with bucket-appropriate colors.
- **Time estimation overhaul.** The old additive climb model was replaced by a single effective-speed model using W/kg-derived flat speed and gradient penalty. The Sugar Cookie estimate that originally missed by ~18 minutes is now close to the observed ride time; remaining work is validation/tuning, not first-pass implementation.
- **Flat-route profile repair.** The Sauce-derived profile pipeline no longer renders the Flat Out Fast / Tempus Fugit phantom-profile class as mountain-shaped. `Flat Out Fast` was manually confirmed after `scripts/test-profile-scaling.mjs` was updated to treat repaired fixtures as clean while preserving synthetic phantom-spike audit coverage.
- **Share image copy repair.** Route-card sharing now writes PNG-only clipboard data on the image path, with plain text reserved as the fallback. This fixes paste targets choosing text instead of the card image.
- **LOW-day execution display fix.** LOW-day cards now show the prescribed steady-Z2 execution instead of over-advertising incidental HIGH opportunity, while route-truth pills still describe what the venue contains.
- **Favorites boost and plan history foundation.** Starred routes get a small self-limiting ranking nudge, and live refreshes save a top-5 daily plan into `xert_plan_history` for future history/last-ridden/feedback features.
- **Mock scenario expansion and `?mock=<id>`.** Missing-signature, empty-history, and tired-deficit QA scenarios are available, and URL query-param selection can persist a mock scenario.

---

### 🔶 Partially implemented

- **Cue copy rules.** Better than before, but truncation rules for long routes with many segments still need refinement. Some routes read too compressed, others too verbose.
- **Route-truth combos.** `LOW+HIGH` and `TRUE mixed` are useful, but we do not yet surface broader combo states like `HIGH+PEAK` or `LOW+PEAK`, and there is no dedicated filter/view for those yet.
- **Geometry-driven route truth.** The build now carries road-geometry-derived fields into segment and timeline data, and recent tuning made route labels stricter. Still, scoring and route-truth labels are not using geometry deeply enough to be considered finished, especially for borderline punchy-climb PEAK detection.
- **Fallback honesty.** The app is safer than before, but the explicit "no good PEAK route in this time budget — here's why" path is not yet a first-class UX state.
- **Time guidance validation.** The time model has been fixed enough to close the original Sugar Cookie miss, but the Time Guidance Round still needs validation: recommended time should choose the first route-feasible time, no-fit states should be honest, and "If you had more time" should sort by nearest viable overrun.
- **XSS rate calibration.** The per-bucket badges are honest about which buckets a route can fill (PEAK = 0 for flat routes), but the absolute XSS estimates still use flat rates (65/90/50 XSS/hr). These rates represent "doing that intensity for the full hour" — the real per-segment contribution is much smaller. Needs calibration from real ride data. Noted as a future task.
- **Plan history UX.** Plan history is saved locally, but the reopen-saved-plan UI was intentionally removed after testing because it interrupted the main flow. Reuse this data later for last-ridden context, post-ride feedback, or a dedicated history view rather than a reopen gate.

---

### ❌ Still outstanding

1. **Inspector navigation everywhere.** Full recommendation cards are wired, but compact cards plus `Other options` and `If you had more time` need Route Inspector jump links.
2. **Live WOTD validation.** Confirm the full `training_info -> workoutId -> fetchWorkout -> classifyWOTD -> banner/ranking/cue` chain against a live or simulated `#MIXEDMODE` day.
3. **Refine cue copy rules.** Better truncation, clearer repeat language, better mixed-route wording, and less awkward handling of interleaved KOM/sprint routes.
4. **WOTD fallback logic.** Honest "no route fits this bucket mix" messaging instead of forcing a weak match.
5. **Validate/tune time guidance.** Keep the overhauled time model, but finish the recommended-time/no-fit/over-budget validation round.
6. **Refactor recommendation scoring.** Move closer to the target architecture: time first, then bucket-segment type match, then density/quality.
7. **Segment ordering and duplicate hits.** Segment membership is much better, but the UI/cues still need true repeated-hit counts and sequence fidelity where data supports it.
8. **Post-ride feedback storage.** Store predicted vs. actual per-bucket deltas for calibration.
9. **Elevation/grade data as active input.** Use road coordinate paths more deeply for accurate per-segment grade classification, PEAK detection, and portal support.
10. **Expose richer route-truth combos.** Add `HIGH+PEAK`, `LOW+PEAK`, and filtering/browsing affordances for combo-capable routes when the labels are trustworthy.

---

### 🧪 Current testing status

**A first validation pass is complete, and several follow-up fixes have landed.** Key takeaways from route-by-route inspection:

- `Tempus Fugit` is moving in the right direction. Flat sprint routes now read as `LOW+HIGH` with `PEAK ~0`, which is much closer to the truth.
- `Flat Out Fast` profile display is manually confirmed fixed after the phantom-profile regression test was updated; it should remain a flat-looking conservative profile, not an audit-flagged oddball.
- `Road to Sky` reads correctly as a climb-oriented `LOW+HIGH` route rather than a fake sprint/PEAK route.
- `Knights of the Roundabout` and `The Greenway` confirm that timeline order is materially better, but cue copy still gets awkward on interleaved routes and when repeats need explaining.
- `2018 Worlds Short Lap` / `Leg Snapper KOM` show the next big scoring gap: short punchy climb routes still are not reliably getting PEAK credit, even though the geometry suggests they should be candidates.
- `Watopia Figure 8` and similar routes originally showed that `TRUE mixed` was too generous in some cases. Recent threshold/downhill-traversal fixes were intended to reduce this, but the check remains important before future scoring changes merge.

Use the following checks before merging future scoring changes:

- `Mock: Peak Focus` — PEAK badges should be non-zero only on routes with short steep climbs (Volcano Circuit, Cobbled Climbs style). Tempus Fugit should show `PEAK ~0`.
- `Mock: Low Deficit` — flat route recommendations should show `PEAK ~0` consistently.
- `Mock: Mixed Deficits` — all three bucket badges appear; HIGH and PEAK show 0 on known flat routes.
- `Mock: Recovery` — single LOW XSS estimate badge only, no per-bucket breakdown.
- Route flags — flat sprint routes like `Tempus Fugit` should show `LOW+HIGH route`; routes should only show `TRUE mixed` when the PEAK contribution is non-trivial in practice, not just theoretically possible.
- World-fallback routes (no segment data) — no honesty label, only `LOW ~X` badge.
- No console errors during mock switching, time slider changes, or unit toggling.
- `scorer-test.html` loads and heuristic checks pass.
- `npm run test:profiles` passes and covers both repaired flat fixtures plus a synthetic phantom-spike audit case.
- Share-copy browser check confirms route-card copy writes `image/png` only on the rich clipboard path, so paste targets receive the image.

---

### Known gaps (updated)

- Cue phrasing for long mixed or sprint-heavy routes can still be too compressed or too verbose.
- The full route sequence expander is the truth source for inspection, but the main cue still needs better truncation rules.
- We are not yet using full road geometry deeply enough as an active scoring/classification input, so segment bucket-mapping is still less honest than it could be. This is separate from the repaired flat-route profile rendering issue, which is now confirmed clean for Flat Out Fast.
- `TRUE mixed` over-application has been tightened, but future scoring passes should keep checking that routes with `PEAK ~0` do not present as true mixed.
- Short punchy climbs may still be under-detected as PEAK opportunities in borderline cases.
- Portal road geometry is not yet pulled into the same recommendation path, so Climb Portal support is still shallower than normal route support.

-----

## Context

This document captures findings from the first real-world test of the Zwift Route Recommender and defines the architectural shift needed based on what the test revealed. Use this as the primary prompt for the next Claude Code session.

-----

## Core Reframe

**The app is not a route recommender. It is a cue generator.**

The route is the venue. The cue is the workout. Route selection should be driven by what efforts are needed to fill the buckets within the available time — not by a blended route score.

-----

## Test Findings — Sugar Cookie

### Pre-ride state

- Status: FRESH
- Buckets: LOW 127.8 needed / HIGH 16.2 needed / PEAK 9.3 needed
- WOTD: SMART - Body Movin' (#MIXEDMODE)
- Time available: 90 minutes
- App predicted: 136 mixed XSS, ~89% gap coverage

### Actual results

|Metric   |App Predicted|Xert Actual|
|---------|-------------|-----------|
|Total XSS|136          |100        |
|LOW      |—            |95         |
|HIGH     |—            |3.7        |
|PEAK     |—            |1.7        |
|Duration |1h 27m       |1h 44m     |

### What went wrong

1. **89% coverage claim was misleading** — actual coverage was ~65% of total XSS, and HIGH/PEAK were barely touched
1. **Cue under-utilized the route** — Sugar Cookie has 4 sprints + Epic KOM lead-in; app only cued 2 sprints, leaving significant HIGH and PEAK opportunity on the table
1. **Flat sprints cannot fill PEAK** — two all-out flat sprints moved PEAK from 0 to 1.7 out of 9.3 needed; flat sprint segments are fundamentally LOW/HIGH work, not PEAK
1. **Time estimate was off** — app said 1h 27m, Zwift said 1h 45m, actual was 1h 44m; Zwift's estimate was accurate, app's was not
1. **No laps logic** — a shorter route like Sugar Cookie might need 2 laps to hit targets; the app has no concept of this

-----

## Problems to Fix

### Problem 1: The coverage percentage is misleading

**Current behavior:** App shows a single blended "covers ~89% of today's gap" number.

**What's wrong:** This number obscures per-bucket reality. A route can cover 95% of LOW and 5% of PEAK and still show as "89% coverage." That's not useful.

**Fix needed:** Replace the blended percentage with per-bucket coverage estimates:

- LOW: estimated fill vs. target
- HIGH: estimated fill vs. target
- PEAK: estimated fill vs. target

Be honest if a route cannot meaningfully fill a bucket. Do not overstate.

-----

### Problem 2: Cue is under-utilizing available effort opportunities

**Status:** Partially addressed on this branch.

**Current behavior:** When timeline data exists, the cue now uses ordered route occurrences instead of a small curated subset. We still need better copy rules for when to list everything vs summarize.

**What's wrong:** Sugar Cookie originally cued only 2 sprints. That specific failure mode has been improved, but some longer routes still need clearer narration so the rider understands repeats and interleaving climbs/sprints.

**Fix needed:** The cue should use all viable effort opportunities on the route, not just a subset. If a route has 4 sprints and the rider needs PEAK work, cue all 4. If there's a KOM section, decide explicitly whether to include it or exclude it — and if excluded, say why.

-----

### Problem 3: Segment type is not matching bucket type

**Status:** Partially addressed, not finished.

**Current behavior:** The app now does a first-pass split between HIGH and PEAK using segment incline/distance, and flat sprints like Tempus Fugit are behaving better. But the scorer still is not using geometry deeply enough, so punchy climbs can miss PEAK credit and route-level truth can still overstate mixed capability.

**What's wrong:** Flat sprints (e.g., Woodland Sprint at -2% grade) are essentially HIGH work at best. They do not generate meaningful PEAK XSS even at 100% effort. PEAK requires truly maximal neuromuscular efforts — punchy climbs, steep short segments, not flat runway sprints. The opposite failure mode is also now visible: short punchy climbs like Leg Snapper are still being under-credited.

**Fix needed:** Segment type needs to map to bucket type more honestly:

- Flat sprints → HIGH opportunity
- Punchy short climbs → PEAK opportunity
- Sustained climbs → HIGH/LOW depending on duration
- Long flat sections → LOW only

Route scoring for PEAK should require segments that can actually deliver PEAK XSS, not just any sprint segment. The next pass should explicitly consume the geometry-derived timeline fields so PEAK classification is based on real punch, not just coarse segment metadata.

-----

### Problem 4: Time is not being used as the primary filter

**Status:** Partially addressed, not finished.

**Current behavior:** Time fit is part of the optimizer, the time model has been overhauled, and the current test plan focuses on route-feasible recommended time plus honest no-fit/over-budget behavior. The broader architecture is still more route-ranking-led than cue-plan-led.

**What's wrong:** Time determines how much LOW you can accumulate. Everything else fits inside that constraint. If the rider has 90 minutes, that caps the LOW ceiling regardless of route. The app should be honest about this upfront before recommending anything.

**Fix needed:** Time becomes the first filter in the recommendation logic:

1. Given available time, what is the realistic LOW ceiling?
1. Given the WOTD bucket mix, what segment types are needed for HIGH and PEAK?
1. Which routes have enough of the right segment types within the time budget?

-----

### Problem 5: Laps logic is missing

**Status:** First-pass implemented.

**Current behavior:** The app can now recommend additional laps and expand route timelines for lap routes. This is working as a UI and cue-support layer, but it is not yet part of a fully honest per-bucket fill model.

**What's wrong:** A shorter route may need 2 laps to hit the target buckets. There is no mechanism to recommend this.

**Fix needed:** Add laps as a first-class recommendation option. If a route is a good terrain fit but too short for the time/XSS target, recommend 2 laps explicitly in the cue rather than recommending a different route.

-----

### Problem 6: Time estimate uses app profile, not Zwift history

**Status:** First-pass model fix landed; validation still needed.

**Current behavior:** App calculates time from W/kg profile using an overhauled effective-speed model with a gradient penalty. The original Sugar Cookie miss has been corrected enough that this is no longer an unimplemented item, but it remains an app estimate rather than Zwift's own estimate.

**Remaining work:** Validate the current model across more real rides and keep investigating whether Zwift's own estimate can be surfaced. The current Time Guidance Round should confirm recommended-time stability, honest no-fit messaging, and nearest-over-budget ordering.

-----

### Problem 7: No recovery spacing between cued efforts

**Status:** First-pass implemented.

**Current behavior:** Timeline-backed cues now calculate recovery gaps between effort occurrences and warn when spacing is short. This is currently copy-level honesty, not yet a full adjustment to expected bucket-fill math.

**What's wrong:** Back-to-back maximal efforts degrade quality. The fourth sprint in a sequence won't produce the same XSS as the first if recovery is insufficient. Cueing all available segments (per Problem 2) without accounting for this will overstate expected bucket fill.

**Fix needed:** Add minimum recovery logic to the cue generator. If two effort segments are closer together than a recovery threshold (e.g., under 2–3 minutes of riding between them), flag the degraded quality in the cue output. Adjust per-bucket estimates to account for diminishing returns on closely spaced efforts.

-----

### Problem 8: No route honesty label

**Status:** Partially addressed, not finished.

**Current behavior:** The app now exposes more honest reason text and visible route flags, including `LOW+HIGH route` and `TRUE mixed`. This is already useful, and riders are responding well to those labels.

**What's wrong:** The label system is not strict enough yet. A flat route with sprint segments can still look more mixed than it really is, and some routes currently labeled `TRUE mixed` still show `PEAK ~0` in practice. That is a contradiction, and it weakens trust in the whole honesty model.

**Fix needed:** Keep the label system, but make it stricter and more expressive:

- `LOW route`
- `LOW+HIGH route`
- `HIGH+PEAK route`
- `LOW+PEAK route`
- `TRUE mixed route`

Only use `TRUE mixed` when all three buckets have meaningful support. This label should be visible before the rider selects a route, setting expectations before the cue is even generated. Longer term, these route-truth combos may deserve their own filter or browsing section.

-----

### Problem 9: No WOTD fallback when route terrain doesn't match

**Current behavior:** App always returns a recommendation, even if no route in the time budget can deliver the WOTD's required bucket mix.

**What's wrong:** If the WOTD calls for PEAK work but no available route within 90 minutes has real PEAK terrain, the app will recommend a bad-fit route dressed up as a match. A forced bad recommendation is worse than no recommendation.

**Fix needed:** Add fallback logic. When no route can deliver the required bucket mix within the available time, the app should say so explicitly: "No good PEAK route available in 90 minutes — consider a shorter focused session on [steep route] or accept LOW+HIGH only today." Honest no-result is better than a false match.

-----

### Problem 10: No knowledge of where and when segments occur on a route

**Status:** Major breakthrough implemented.

**Current behavior:** This is no longer true for most routes on this branch. We now have route-position timelines for the majority of routes, including ordered effort points, lap-aware expansion, and recovery-gap calculation.

**What's wrong:** Without position data, the cue generator cannot tell the rider "sprint effort at km 8.2, recovery for 3.4 km, then KOM effort at km 11.6." It cannot calculate recovery gaps between efforts. It cannot sequence the cue to match the actual ride experience. This is the foundational gap that makes the cue generator a list of segments rather than a ride plan.

**What we found:** The GameDictionary XML (`cdn.zwift.com/gameassets/GameDictionary.xml`) contains the data needed to solve this. Every segment has three key fields: `onRoutes` (comma-separated route signature IDs — the direct segment-to-route mapping), `roadId` (which road the segment lives on), and `roadTime` (a 0.0–1.0 normalized position along that road). For Sugar Cookie (signature `240388043`), the segments that reference it include:

| Segment | Type | roadId | roadTime | Distance (km) |
|---|---|---|---|---|
| Stoneway Sprint | Sprint | 149 | 0.124 | 0.40 |
| Acropolis Sprint | Sprint | 149 | 0.266 | 0.45 |
| Sasquatch Sprint | Sprint | 149 | 0.583 | 0.35 |
| Jungle Loop | Lap | 35 | 0.542 | 7.80 |

Segments on the same `roadId` can be ordered by `roadTime`. Three of Sugar Cookie's four sprints share road 149, so their ride order is known: Stoneway → Acropolis → Sasquatch. The `roadTime` gaps between them give relative spacing.

**What's missing from the GameDictionary:** `roadTime` gives position on a *road*, not on a *route*. A route is composed of multiple roads in sequence, and the road ordering within a route is not explicitly in the GameDictionary. To get absolute "km from route start" for each segment, we need the road sequence.

**Breakthrough: sauce4zwift already solved this.** The sauce4zwift project (`github.com/SauceLLC/sauce4zwift`) — the same codebase behind Sauce for Zwift — contains structured JSON data files and JavaScript logic that solve the road-sequence problem completely:

**Route manifests (`shared/deps/data/routes.json`).** Each route has a `manifest` — an ordered array of road sections that define the exact road sequence. Each manifest entry contains `roadId`, `start` (roadTime where the route enters this road), `end` (roadTime where the route leaves this road), and `reverse` (direction of travel). This is the missing glue between roadTime-on-a-road and position-on-a-route.

**Road geometry (`shared/deps/data/worlds/{worldId}/roads.json`).** Full coordinate paths for every road, with elevation data. Roads include spline type (CatmullRom or Bezier), whether they loop, and the full path array. This gives actual distances, not just normalized positions.

**Segment definitions (`shared/deps/data/worlds/{worldId}/segments.json`).** Segments with `roadId`, `roadStart`, `roadFinish`, direction, and whether they loop. This is richer than the GameDictionary's segment data because it includes explicit start/finish positions on the road.

**Segment projection logic (already written).** The `readRoutes()` function in `src/env.mjs` already projects segments onto routes: it iterates each route's manifest entries, finds segments on matching roads (by `roadId` and direction), checks if the segment falls within the manifest entry's roadTime range, and sorts them in ride order. It assigns `segmentIds` to each manifest section. The projection logic handles forward/reverse direction and filters out partial overlaps.

**The `shared/deps/data` directory may require building from source** — it wasn't directly accessible via raw GitHub URLs, suggesting it may be generated during the build process or pulled as a submodule. Investigation needed: clone the full repo, run the build, and extract the data files. Alternatively, the sauce4zwift developer (who provided the tip about the public API) may be able to confirm how to access these files directly.

**What changed:** We did not end up cloning Sauce as a repo dependency. Instead, the build script now extracts the needed route-manifest and world data from Sauce for Zwift's public release bundle and normalizes it into app-specific timeline data. That is the right long-term shape for this project.

**Fix needed — remaining phases:**

**Phase 1: Extract and integrate sauce4zwift data (short term).** Mostly done. The remaining work is cleanup, documenting the build dependency clearly, and handling unmatched routes more deliberately.

**Phase 2: Build the cue timeline engine (medium term).** Partially done. We now have absolute ordered effort sequences and recovery-gap logic. The remaining work is to make the cue engine smarter about truncation, explanatory copy, and bucket-fill modeling.

**Phase 3: Enrich with elevation and grade data (long term).** Still pending. This remains the key to honest segment-to-bucket mapping.

**Necessary remaining Sauce-derived inputs to pull more deeply:**

- **`worlds/{worldId}/roads.json` as a first-class build input.** This is now necessary, not optional. We need it to:
  - calculate actual segment grade/profile instead of relying mostly on labels
  - distinguish flat sprint vs punchy climb vs sustained climb more honestly
  - improve recovery modeling and eventually improve time modeling
- **`portal_roads.json` as a first-class build input.** This is necessary if Climb Portal routes are going to be treated as real route recommendations rather than side notes.
- **Better route alias / matching metadata.** This is necessary to reduce the small set of unmatched routes that still fall back to old behavior.

**Fallback if sauce4zwift data is inaccessible:** The sauce4zwift developer confirmed that the Zwift public API endpoint `/api/game_info` (requires authentication but not OAuth — same auth the game client uses) returns route and segment data in JSON format. This is an alternative path to the same data. Additionally, manual mapping from Zwift Insider profiles remains viable for a small number of priority routes.

-----

## Data Sources

### Confirmed Public Endpoints (no auth)

|Endpoint|What it gives you|
|---|---|
|`cdn.zwift.com/gameassets/GameDictionary.xml`|374 routes, 217 segments with route-to-segment mappings via `onRoutes`, segment position via `roadId`/`roadTime`, portal climbs, bike frames, achievements|
|`cdn.zwift.com/gameassets/MapSchedule_v2.xml`|Guest world rotation schedule|
|`cdn.zwift.com/gameassets/PortalRoadSchedule_v1.xml`|Climb Portal rotation schedule + climb metadata (48 climbs with distance/elevation)|
|`us-or-rly101.zwift.com/relay/worlds`|Live active worlds with player counts|
|`cdn.zwift.com/gameassets/Zwift_Updates_Root/Zwift_ver_cur.xml`|Current game version|

### Authenticated Endpoint (game client auth, not OAuth)

|Endpoint|What it gives you|
|---|---|
|`/api/game_info`|Same route/segment data as GameDictionary but in JSON format, with segment IDs preserved. Requires `Zwift-Api-Version: 2.7` header. See `src/zwift.mjs` in sauce4zwift for auth details.|

### sauce4zwift Data Files (github.com/SauceLLC/sauce4zwift)

|File|What it gives you|
|---|---|
|`shared/deps/data/routes.json`|All routes with **manifests** — the ordered road sequence for each route. Each manifest entry has `roadId`, `start`, `end` (roadTime range), and `reverse`. This is the missing link between segment road positions and absolute route positions. We are already deriving normalized route timelines from this data in the build step.|
|`shared/deps/data/worlds/{worldId}/roads.json`|Full road geometry — coordinate paths with elevation, spline type, loop flag. Enables actual distance calculation and grade profiles. This should now be treated as a necessary next-phase input, not just nice-to-have reference data.|
|`shared/deps/data/worlds/{worldId}/segments.json`|Segments with `roadId`, `roadStart`, `roadFinish`, direction. Richer than GameDictionary segment data.|
|`shared/deps/data/portal_roads.json`|Road geometry for Climb Portal roads. This should be treated as necessary if portal climbs are meant to participate honestly in route selection and cue generation.|
|`shared/deps/data/worldlist.json`|World metadata — courseId, worldId, name, coordinate system parameters.|

### Key sauce4zwift Code References

|File|What it does|
|---|---|
|`src/env.mjs` → `readRoutes()`|**Already-written segment projection logic.** Iterates each route's manifest, finds segments on matching roads by `roadId` and direction, checks roadTime range overlap, sorts segments in ride order, assigns `segmentIds` to manifest sections.|
|`src/env.mjs` → `getRoadCurvePath()`|Builds spline curves from road coordinate paths. Enables distance-along-road calculation from roadTime values.|
|`src/env.mjs` → `getRoadSig()`|Creates unique road signature from courseId + roadId + direction. Useful for lookups.|
|`src/zwift.mjs` → `getGameInfo()`|Fetches route/segment data from Zwift's authenticated API in JSON format.|
|`src/zwift.mjs` → `decodePlayerStateFlags2()`|Decodes `roadId` from player state bitfield — shows how Zwift internally tracks which road a rider is on.|

-----

## Architectural Shift: Recommendation Logic

### Current logic (still current, but improving)

Score routes → pick highest scoring route → generate cue from segments on that route

### New logic (proposed)

1. **Time filter** — what routes fit in the available time? (consider laps)
1. **Bucket priority** — what does the WOTD say is needed? What mix of LOW/HIGH/PEAK?
1. **Segment opportunity** — which routes have the right segment *types* and *density* to deliver that mix?
1. **Segment positioning** — where on the route does each segment occur, in what order, and with how much recovery distance between them?
1. **Route honesty label** — tag each candidate as LOW / LOW+HIGH / TRUE mixed based on segment profile
1. **WOTD feasibility check** — if no candidate can deliver the required bucket mix, surface a fallback recommendation instead of forcing a bad match
1. **Cue generation** — given the selected route and segment positions, build a sequenced cue that uses ALL viable effort opportunities, with recovery spacing between efforts and distance-based timing
1. **Honest coverage estimate** — show per-bucket expected fill, not a blended percentage

-----

## The Deeper Insight

The user can ride any route in Z2 and fill LOW. That requires no intelligence. The value of the app is in identifying:

- Which routes have the right effort opportunities for HIGH and PEAK
- How many laps or how much time is needed to actually hit the targets
- Which specific segments to target and at what intensity
- Whether the route can realistically deliver the mix, or whether it's fundamentally a single-bucket route

A flat route dressed up with sprint segments is a LOW route. The app should say so honestly rather than calling it a mixed recommendation.

-----

## What to Build Next

Priority order for Claude Code:

1. **Fix card image copy regression** — text copy works, but PNG copy via `html2canvas`/`ClipboardItem` stopped working
1. **Finish inspector navigation coverage** — add Route Inspector jump links to compact cards, `Other options`, and `If you had more time`
1. **Validate live WOTD mixed-mode flow** — confirm workout enrichment and classification against a real or simulated `#MIXEDMODE` day
1. **Finish geometry-driven scoring** — use the road-geometry-derived fields more deeply so punchy climbs earn PEAK and flat sprints stay HIGH
1. **Continue tightening route-truth labels** — keep `LOW+HIGH`, add richer combo labels where justified, and keep guarding against `TRUE mixed` when `PEAK ~0`
1. **Refine cue copy rules** — better truncation rules, clearer explanation of repeats, and better mixed-route wording
1. **Add WOTD fallback logic** — honest no-result when no route fits the required bucket mix
1. **Refactor recommendation scoring** — time first, then bucket-segment type match, then density
1. **Validate and tune time guidance** — the first model overhaul landed; finish recommended-time, no-fit, and over-budget route validation
1. **Handle unmatched or fallback-only routes deliberately** — either map them or clearly classify them as known fallback routes
1. **Pull portal road geometry into the build path** — make portal routes first-class if we want portal recommendations to be honest
1. **Add combo-based browsing affordances** — filters or sections for `LOW+HIGH`, `HIGH+PEAK`, `LOW+PEAK`, and `TRUE mixed`
1. **Add post-ride feedback storage** — store predicted vs. actual per-bucket deltas to calibrate segment-to-bucket mapping over time

-----

## Notes for Claude Code Session

- **Primary data sources are still the GameDictionary XML and Sauce-derived route data.** But the implementation path has changed: the build step now produces app-specific normalized route timelines rather than trying to mirror Sauce's internal app structure.
- **Do not clone Sauce as a runtime dependency.** The current branch already proved the better shape: build-time extraction and normalization into committed app data.
- **The next logic work is not "get route positioning."** That part is already here for most routes. The next logic work is honest bucket modeling, route-truth labeling, and cleaner cue generation on top of the positioning layer.
- **The next data work is to promote road geometry from reference data to actual model input.** We should explicitly pull `roads.json` and `portal_roads.json` into the recommendation pipeline so segment classification and portal support are terrain-truthful.
- The GameDictionary contains 374 routes (with signature, distance, ascent, world, lead-in data) and 217 segments (with type, road position, jersey info, and route mappings)
- Segment type classification should drive bucket prediction, not just segment presence — use `archSegmentDistanceInKilometers` and jersey type (polka = KOM/climb, green = sprint) to distinguish effort types
- Segments on the same `roadId` can be ordered by `roadTime` — this gives intra-road ordering for free even without the full manifest
- The `onRoutes` field uses route `signature` values as IDs — match these to the `signature` attribute on each `ROUTE` element
- The WOTD `#MIXEDMODE` tag is already being detected — make sure its bucket weighting reflects the actual physiological demands of mixed mode work
- The PortalRoadSchedule (`cdn.zwift.com/gameassets/PortalRoadSchedule_v1.xml`) has Climb Portal rotation + metadata — useful if portal climbs become part of the recommendation engine
- **Zwift's authenticated API** (`/api/game_info` with `Zwift-Api-Version: 2.7`) returns the same data as the GameDictionary in JSON format — this is a fallback if the CDN XML structure changes. See `src/zwift.mjs` for auth flow (standard game client auth, not OAuth). The sauce4zwift developer confirmed this is the same API the game client and Sauce use.
- **Road geometry enables grade calculation.** The `roads.json` files contain full coordinate paths with elevation. Combined with spline interpolation (`getRoadCurvePath()` in `env.mjs`), this enables computing actual grade at any point on any road — which is what ultimately determines whether a segment produces PEAK, HIGH, or LOW XSS.
- RoadCaptain (`github.com/sandermvanvliet/RoadCaptain`) has a road network model in C# — not directly extractable, but could be a cross-reference for validating road connectivity if needed
- UI structure has already changed in this branch with Route Inspector and route-sequence inspection helpers. Keep future UI additions lightweight and in service of validation/honesty, not decorative redesign.
- After changes, a second test ride should be run to validate the new estimates against reality
- Post-ride delta storage can be simple at first — a correction factor per segment type is enough to start calibrating
