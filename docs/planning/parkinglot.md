# Parking Lot — Ideas & Issues for Later

Organized by priority tier. Top of each section = tackle first.

---

## Tier 1 — Next up (clear value, well-scoped)

### Fix card image copy. Text copy works. Image copy (html2canvas PNG via ClipboardItem) stopped working at some point — regression. Text-only fallback is still live. Needs root-cause investigation before next share-button work.

### Route card → inspector navigation on compact cards and secondary sections
Inspector navigation is wired on full recommendation cards. Remaining:
- compact route cards (profile-free summary cards) don't have the inspector affordance yet
- `Other options` and `If you had more time` sections still need the jump link
- two-way navigation (inspector → back to recommendation) should stay coherent across all entry points

### WOTD live validation
The workout fetch chain is wired but hasn't been tested end-to-end against a live mixed-mode day. When Xert schedules a `#MIXEDMODE` workout:
- Confirm `training_info` returns a `workoutId`
- Confirm `fetchWorkout` enriches rawWotd with `xlss/xhss/xpss/intervalPower/intervalDuration`
- Confirm `classifyWOTD` returns `'mixed_mode'`
- Confirm banner, route ranking, and ride cue all match the mixed-mode intent

### WOTD terrain heuristics tuning pass
After accumulating real ride data, revisit:
- `wotdTerrainScore()` cutoffs for `sustained_climb`, `repeated_punchy`, and `aerobic_endurance`
- Whether world-fallback segment data should influence sprint-power ranking as strongly as route-linked segment data
- Whether WOTD-first weighting should demote low/high support even further in `sprint_power` days

### Scoring / optimizer tuning pass
The live tuning panel in `scorer-test.html` makes this easy — adjust sliders and see ranking changes immediately. After accumulating real ride data, revisit:
- `ACTIVE_BUCKET_WEIGHT` — currently 0.65 (specialist weight vs 0.35 deficit balance); fixed the all-rounder bias but may need further tuning
- `PUNCH_ELEVATION_CAP` — currently 400m; may need adjustment
- `PUNCH_DISTANCE_MAX` — currently 18 km; still heuristic
- Whether LOW and mixed-deficit behavior still over-favors “all-rounder” routes on long time budgets

### Daily Summary fidelity pass
Confirm edge cases: multiple rides, imported rides, timezone boundaries, rounding differences with Xert's own UI.

### Route segment ordering, duplicate hits, and route inspection
The app is much better on route-to-segment membership now, but it still does not preserve the true order segments occur on a route, nor whether a route hits the same segment multiple times.

Why this still matters:
- Segment chips are membership-accurate, but not sequence-accurate
- Ride cues can name good targets, but not reliably say when they happen
- Duplicate sprint routes can understate how many opportunities a rider actually gets
- UI validation is harder because some routes are not visible under today's world filter, and there is no dedicated route-inspection test page

Future implementation direction:
1. Investigate whether Zwift has another public source with route-position data for segments, or whether existing community datasets can provide ordered segment positions per route
2. If no better source exists, evaluate a compatibility bridge using legacy `zwift-data` `segmentsOnRoute.from/to` data where available
3. Extend generated route data to support ordered segment occurrences, not just unique segment membership
4. Update route chips and ride cues to express duplicate occurrences, e.g. `JWB Sprint Rev. ×2`
5. Prefer rider-facing names like `JWB Sprint Reverse` over internal XML labels like `Sprint Forward End`
6. Add a lightweight route inspection/test harness so specific routes like `Road to Sky`, `Tempus Fugit`, `Surrey Hills`, and `Triple Flat Loops` can be checked regardless of today's worlds

Acceptance criteria when this is tackled:
- Segment chips reflect route order, not just sorted importance
- Duplicate segment hits are shown explicitly
- Triple Flat Loops resolves to two named sprint targets with correct duplicate counts
- Route-specific checks are possible even when the route is outside today's active worlds

---

---

## Known data gaps / intentional non-bugs

### Volcano Circuit PEAK score near zero
Sauce4Zwift's route projection for Volcano Circuit only yields a lap marker with zero elevation — no climb segments are projected for this route. The PEAK ~0 badge is correct given available data. Not a code bug. If a better segment source becomes available, revisit.

### Segment membership is Sauce-projection accuracy
Where Sauce's projected XML misses known segments, `ROUTE_SEGMENT_OVERRIDES` in `build-zwift-data.mjs` provides a manual fix. Currently used for Scotland After Party / Loch Loop (Breakaway Brae). Any future gap reports should be evaluated against Sauce first; if Sauce is definitively missing it, add an override entry.

---

## Tier 2 — Good features, moderate effort

### Cue card editorial tuning
The route timelines and honesty labels are in much better shape now, but the copy still gets awkward on medium and busy routes. The next editorial pass should focus on:
- when to list the full effort sequence vs summarize
- better repeat language than `plus 8 later efforts`
- clearer mixed-route narration when sprints and KOMs interleave
- better handling for routes that are honest `LOW+HIGH` rather than true mixed

This is a product-quality pass, not a data-plumbing pass.

### Bucket-combo route discovery
The honesty labels (`LOW+HIGH`, `TRUE mixed`) are useful enough that the UI may want a second layer of route browsing:
- filters or tabs for `LOW+HIGH`, `HIGH+PEAK`, `LOW+PEAK`, `TRUE mixed`
- optional section near the bottom for "routes that are honest at this bucket combo, even if they are not the top recommendation"

This should wait until the geometry-driven classification pass is a little more mature, so the combos are trustworthy.

### Recent Progress panel — reconsider or remove
The bar chart is hard to read in practice (bars tend to be all-or-nothing), the history only accumulates when the live app is used daily, and it's unclear what value it provides. Deferred: leave it for now, evaluate whether to remove it or redesign it after more live usage.

### “You've filled this before” context
Recent Progress snapshots are currently used only for the small trend panel. Reuse that local history to show lightweight context on the banner or route card, e.g. “Last HIGH day you generated 87 XSS.” This would help riders calibrate whether today's recommendation is conservative or aggressive without any new API.

### Cue persistence / today's ride plan
Plan history now saves silently to `xert_plan_history` in localStorage after every live refresh (top-5 routes with slug, name, world, distance, elevation, and ride cue; max 30 records; upserted by date). This is the data foundation but the reopen UI — showing the saved plan before fetching fresh data — was intentionally removed after testing: it got in the way rather than helping.

Next step when this resurfaces: use `xert_plan_history` as the basis for last-ridden context (“ridden X days ago”), post-ride feedback matching, or a dedicated history view rather than a reopen gate.

### Weekly progress overview
The app now has a compact Recent Progress panel. A stronger next step would be a fuller 7-day overview showing completed vs target totals across the week rather than just a small per-bucket daily trend strip.

### Share — format improvements
Share button is live (PNG + plain text via ClipboardItem). Potential improvements: richer plain text formatting, better ride cue truncation, option to share just text without image.

### ZwiftMap iframe — expandable route map on cards
Adds an expandable map panel to route cards using ZwiftMap's public website via iframe so riders can visually inspect the route before starting.

Implementation shape:
- "View Map" button on each route card opens a panel below the card containing an iframe
- Only one map panel open at a time
- Lazy load the iframe only when opened
- Fall back to an external "View on ZwiftMap" link if embedding ever stops working

### Post-ride feedback loop
After the ride, ask for a lightweight completion signal such as `Executed / Partially / Not really` or a simple thumbs up/down on the recommendation. Even local-only storage would let the app start learning which route/cue combinations actually work for the rider.

### Multi-lap / compound route builder
On longer PEAK or mixed days, the right answer may be a short effort route repeated multiple times or a short hard route followed by a cooldown route. Long term, build compound plans instead of forcing every recommendation into a single-route answer.

### "Last ridden" tracking
Once activity history is being fetched more deliberately, show "last ridden 18 days ago" on route cards. Give a small score boost to routes not ridden recently to add variety without the rider having to think about it.

### Browser reminders
Optional daily notification via the browser Notifications API. "Your Xert data is ready — check today's route." No backend needed, fully client-side.

### Events matching training needs
Zwift has an unofficial events API (requires Zwift OAuth — separate from Xert auth, adds complexity). Useful version: surface upcoming events that match your target bucket — group rides for LOW days, climbing races for HIGH days, crits/sprints for PEAK. Needs Zwift login flow added alongside Xert.

### Equipment recommendations (frame/wheel)
No live API — Zwift doesn't expose your garage. But can be a static recommendation system based on route characteristics, using Zwift Insider's published testing data:
- Gradient >30 m/km → climbing frame
- Flat/TT route → aero frame + deep wheels
- Mixed → all-rounder

### Workout-route pairing
WOTD data already comes from Xert. Match the workout structure to a route — interval workout → route with repeated punchable climbs; long endurance block → flat loop; recovery spin → short flat. Bridges the gap between "do this workout" and "ride this route."

### PR targeting via Strava segment links
`zwift-data`'s segments export includes `stravaSegmentUrl` for most climbs and sprints. Surface these directly on route cards as tappable chips so riders can jump to current PRs before the ride.

### Strava integration, phase 1: live PRs on segment chips
Add Strava OAuth and fetch the rider's current PRs for the climbs/sprints on today's recommended routes so the chips show real personal context rather than only linking out.

### Strava integration, phase 2: post-ride verification and feedback
Use Strava activities after the ride to verify whether the rider actually rode the recommended route, which segments fired, and how their efforts compared with the cue. Xert remains the source of truth for bucket accounting and XSS.

---

## Tier 3 — Longer term / needs more thought

### Sauce4Zwift route export: pre-built JSON library
Add a `Download for S4Z` button to supported route cards so the rider can import a pre-built JSON route file into Sauce4Zwift and focus entirely on executing the cue during the ride.

### Route profiles — fidelity / polish follow-up
Native route profiles are now generated from Sauce4Zwift road geometry and rendered directly on full route cards plus the Route Inspector. Remaining work is quality-focused rather than plumbing-focused:
- continue tuning smoothing / exaggeration so profiles read closer to Zwift Insider without hiding real contour
- validate more routes for geometry interpretation edge cases beyond the `manifest.reverse` + looped-road reverse fixes
- decide whether compact cards should eventually get a simplified profile treatment
- consider a stronger profile simplification pass before proportional per-segment XSS work

### Sauce4Zwift live integration
WebSocket connection to Sauce4Zwift for live Magic Buckets tracking during a ride. Would show real-time bucket fill as you ride rather than pre-ride estimates. Requires Sauce4Zwift to be running and exposes a local WebSocket.

### Strava segment integration
Personal PRs on recommended routes. Requires Strava OAuth. Nice motivational layer — "you PRd this climb 3 weeks ago, you're fresher now."

### Seasonal / phase awareness
Xert exposes enough context that the app may eventually infer whether the rider is in build, maintenance, taper, or recovery emphasis. That could tune the language and aggressiveness of recommendations even when today's deficits look similar on paper.

### Sauce4Zwift: dynamic WOTD-tailored route generation
Instead of only recommending pre-existing Zwift routes, generate custom S4Z route JSON tailored to the workout structure, e.g. repeated KOM hits with controlled recovery between.

### Proportional XSS per segment
Rather than labeling a route as "LOW" or "HIGH", estimate how much XSS each bucket generates from it (flat sections → low, climbs → high, sprint points → peak). Much closer to how Xert actually thinks about rides. Depends on route profile fidelity being solid enough to trust per-segment attribution.

---

## UI polish (pick up anytime)
- Route cards have no visual differentiation between worlds. A small world colour tag could help scanability.
- Mobile layout works but hasn't been tested on a real device.
- HIE display: consider one decimal place since it's a smaller number than FTP.
- The Recent Progress panel is clearer now, but a legend or tooltip may still help explain target track vs completed fill for first-time users.
- The testing/dev data-source controls are functional, but they are plainly styled. If they stay long term, they could use better affordances and maybe a “dev only” visual treatment.

## Operational
- Token TTL is hardcoded to 1 hour in `xert.js`. Xert's actual TTL may differ — worth checking if users hit unexpected logouts.
- Generated route data should be refreshed when Zwift publishes new world or route data: `npm run build-routes` then commit the updated snapshot files.
- Local dev still requires two terminals (`node proxy.js` + `npx serve .`). A `start.sh`/`start.bat` launcher would simplify this.
- QA docs now live in `test-plan.md` and `rapid-qa-checklist.md`; keep them updated whenever major recommendation logic or testing affordances change.

