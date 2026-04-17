# Parking Lot

The core route recommender is complete enough to treat the remaining work as polish, validation, calibration, and future extensions. This is the active list. Historical design and implementation records live in `docs/planning/archive/` or older planning files.

---

## Tier 1 - Product Polish And Validation

### Route Browsing Cleanup
The secondary browsing surfaces need a product pass.

- Cap `If you had more time`. At low budgets such as 30 minutes, it can show nearly everything. Decide whether to cap by time overrun, such as routes X-Y minutes above the selected time, or by a fixed max card count.
- Reconsider whether `Other options` should exist. It may not add enough beyond Route Inspector and could be removed or folded into a better browsing surface.
- Add route profiles to `If you had more time` cards so over-budget options are visually scannable.
- Add inspector jump links to compact cards and secondary sections if those sections remain.
- Keep two-way navigation coherent from recommendation card to inspector and back.

### Route Inspector UX
Route Inspector is useful, but the dropdown is getting hard to scan.

- Remove the `Key efforts` section from Route Inspector.
- Reorganize route finding: search input, world filter, bucket-support filter, or grouped route picker.
- Explore filtering by route usefulness: LOW, HIGH, PEAK, `LOW+HIGH`, `HIGH+PEAK`, `LOW+PEAK`, and true mixed.
- Keep inspector useful for routes outside today's active worlds.

### Visual Polish
- Lighten Watopia's world title color slightly. The current orange is directionally right but needs a small readability bump.
- Route profiles should be smoothed a little less so contours feel more truthful while staying readable.
- Mobile layout works but still needs a real-device pass.
- Testing/dev data-source controls are functional but plainly styled; improve affordances if they remain long term.

### Manual QA Round
Run a focused browser pass after the current PR lands.

- `Mock: Low Deficit`: flat route cards should show `PEAK ~0`, and Tempus Fugit should remain `LOW+HIGH route`.
- `Mock: Peak Focus`: punchy routes such as Volcano Climb / Cobbled Climbs style should rank high; Volcano Circuit's PEAK near zero remains a known data gap.
- `scorer-test.html`: heuristic checks should stay green.
- Mock switching, time slider, unit toggle, source label tooltip, and world filtering should not produce console errors.

### Live WOTD Validation
The workout fetch chain is wired but still needs end-to-end validation against a live mixed-mode day.

- Confirm `training_info` returns `workoutId`.
- Confirm `fetchWorkout()` enriches raw WOTD with `xlss`, `xhss`, `xpss`, `intervalPower`, and `intervalDuration`.
- Confirm `classifyWOTD()` returns `mixed_mode` for a real or simulated `#MIXEDMODE` day.
- Confirm banner, route ranking, and ride cue all match the mixed-mode intent.

---

## Tier 2 - Recommendation Quality

### Scoring And Optimizer Tuning
The current scoring is good enough for the main recommender, but should be tuned against real rides.

- Revisit `ACTIVE_BUCKET_WEIGHT`, currently 0.65 specialist vs 0.35 deficit balance.
- Revisit `PUNCH_ELEVATION_CAP`, currently 400 m.
- Revisit `PUNCH_DISTANCE_MAX`, currently 18 km.
- Check whether LOW and mixed-deficit days still over-favor all-rounder routes on long budgets.
- Check whether sprint-power days should demote LOW/HIGH support even further.

### Time Guidance And More-Time Behavior
The time model is substantially improved, but the guidance layer still needs calibration.

- Validate recommended-time behavior: it should choose the first route-feasible time, not just theoretical bucket math.
- Keep no-fit states honest when nothing fits the selected time.
- Sort `If you had more time` by nearest viable overrun first, then use score/utility as a tie-breaker.
- Decide whether Zwift's own time estimates can be surfaced or approximated better.

### Cue Copy Editorial Pass
Timeline-aware cues are in place, but copy still gets awkward on busy routes.

- Improve truncation rules for long route sequences.
- Replace awkward repeat language such as `plus 8 later efforts`.
- Clarify mixed-route narration when climbs and sprints interleave.
- Better explain honest `LOW+HIGH` routes so riders know what to do today versus what the venue contains.

### Route Truth And Bucket Modeling
Route honesty labels work, but they should eventually become more expressive and better grounded in terrain.

- Add richer route-truth combos when justified: `HIGH+PEAK`, `LOW+PEAK`, and true mixed.
- Keep guarding against `TRUE mixed` when PEAK support is effectively zero.
- Use road geometry more deeply for segment-to-bucket mapping, especially punchy-climb PEAK detection.
- Start estimating proportional XSS per segment instead of treating a route as one blended bucket.
- Add explicit no-good-fit messaging when no route can deliver the WOTD bucket mix inside the time budget.
- Keep real-ride calibration notes in `docs/planning/data-calibration.md`.

### Route Segment Order And Duplicate Hits
Sauce-derived timelines solved most route-position needs, but some route/segment display remains approximate.

- Preserve true route order and duplicate segment hits wherever source data supports it.
- Show duplicate hits explicitly, for example `JWB Sprint Reverse x2`.
- Keep rider-facing names preferred over internal XML labels.
- Validate routes such as Road to Sky, Tempus Fugit, Surrey Hills, Triple Flat Loops, and 2018 Worlds Short Lap.

### Daily Summary Fidelity
Confirm edge cases against live Xert behavior.

- Multiple rides in one day.
- Imported rides.
- Timezone boundaries.
- Rounding differences with Xert's own UI.
- Activity detail failures and summary fallback behavior.

---

## Tier 3 - Future Features

### Plan History And Last-Ridden Context
Plan history is saved locally in `xert_plan_history`, but the reopen UI was intentionally removed because it interrupted the main flow.

- Reuse plan history for last-ridden context, such as `ridden 18 days ago`.
- Add lightweight post-ride feedback: executed, partially, not really, thumbs up/down.
- Compare predicted route bucket fill against actual post-ride results.
- Build a dedicated history view only if it helps decision-making.

### Recent Progress Reconsideration
The panel exists, but its value is uncertain.

- Decide whether to remove it, redesign it, or expand into a fuller 7-day overview.
- Add clearer legend/tooltip for target track versus completed fill if it stays.
- Consider lightweight context like `Last HIGH day you generated 87 XSS`.

### Share Improvements
Share image/text controls work and were manually confirmed.

- Improve plain-text formatting.
- Improve ride cue truncation in shared cards.
- Keep PNG-only image copy behavior because rich paste targets choose the card image correctly.

### Maps And External Context
- Add expandable ZwiftMap iframe or external map link on route cards.
- Surface Strava segment PR links from route chips.
- Later: Strava OAuth for live PRs and post-ride verification.
- Later: static equipment recommendations based on route characteristics and published Zwift Insider testing.

### Workout And Event Matching
- Pair Xert workout structure to route shape more directly.
- Surface Zwift events that match training needs: LOW group rides, HIGH climbing events, PEAK crits/sprints.
- Requires separate Zwift auth if events need authenticated APIs.

### Sauce4Zwift Extensions
- Add `Download for S4Z` route JSON for supported cards.
- Explore Sauce4Zwift live WebSocket integration for real-time Magic Buckets during a ride.
- Long term: generate custom S4Z routes tailored to the WOTD instead of only recommending existing Zwift routes.

---

## Known Data Gaps / Intentional Non-Bugs

### Volcano Circuit PEAK Score Near Zero
Sauce4Zwift's route projection for Volcano Circuit only yields a lap marker with zero elevation, so no climb segments are projected for this route. The PEAK near-zero badge is correct given available data. Revisit only if a better segment source becomes available.

### Segment Membership Is Sauce-Projection Accuracy
Where Sauce's projected XML misses known segments, `ROUTE_SEGMENT_OVERRIDES` in `scripts/build-zwift-data.mjs` provides manual fixes. Currently used for Scotland After Party / Loch Loop Breakaway Brae style gaps. Future reports should be checked against Sauce first; if Sauce is definitively missing it, add an override.

### Portal Routes Are Not First-Class Recommendations Yet
Climb Portal support is surfaced as a side note. Portal road geometry is not yet pulled into the same recommendation path as normal Zwift routes.

---

## Operational

- Token TTL is hardcoded to 1 hour in `public/app/core/xert.js`; verify if users hit unexpected logouts.
- Refresh generated route data when Zwift publishes meaningful world/route changes: `npm run build-routes`, review generated output, commit generated files with the build-script change if any.
- Local dev still benefits from `npx netlify dev` for proxy/function testing.
- Keep `docs/planning/test-plan.md` and `docs/planning/rapid-qa-checklist.md` updated when recommendation logic or manual QA steps change.
