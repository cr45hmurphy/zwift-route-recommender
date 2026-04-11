# Parking Lot — Ideas & Issues for Later

Organized by priority tier. Top of each section = tackle first.

---

## Tier 1 — Next up (clear value, well-scoped)

### Zwift public CDN integration — live schedules, authoritative route/segment data, and route-to-segment mapping

#### Discovery

Zwift serves several XML data files from its public CDN (`cdn.zwift.com/gameassets/`) with no authentication required. These are the same files the Zwift game client fetches on startup — source of truth for route data, segment data, world schedules, and Climb Portal schedules. Community tools like ZwiftHacks, What's on Zwift, and ZwiftMap all derive from these same sources.

#### Confirmed public endpoints

| Endpoint | Auth | Content | Update frequency |
|---|---|---|---|
| `cdn.zwift.com/gameassets/GameDictionary.xml` | None | 374 routes, 217 segments (195 with route mappings), 48 portal climbs | Updated with game patches |
| `cdn.zwift.com/gameassets/MapSchedule_v2.xml` | None | Guest world rotation schedule with ISO 8601 dates | Monthly |
| `cdn.zwift.com/gameassets/PortalRoadSchedule_v1.xml` | None | Climb Portal rotation schedule + portal climb metadata | Monthly |
| `us-or-rly101.zwift.com/relay/worlds` | None | Live active worlds with real-time player counts | Real-time |
| `cdn.zwift.com/gameassets/Zwift_Updates_Root/Zwift_ver_cur.xml` | None | Current game version string | Per release |

**Confirmed inaccessible (401/403):** Events, profile data, activity data, ClimbSchedule.xml. These require Zwift developer API access not available to hobby developers.

---

#### Data source 1: GameDictionary.xml — the foundational one

**374 routes** — each `<ROUTE>` element has:
- `name`, `map` (world), `signature` (unique integer ID used by segments' `onRoutes`)
- `distanceInMeters`, `ascentInMeters`, `leadinDistanceInMeters`, `leadinAscentInMeters`
- `eventOnly` (1 = not available for free-ride), `levelLocked` (1 = requires rider level)
- `supportedLaps` (1 = supports lapping)

Route count by world: WATOPIA 129 · NEWYORK 50 · MAKURIISLANDS 47 · LONDON 24 · FRANCE 23 · SCOTLAND 16 · RICHMOND 10 · YORKSHIRE 9 · INNSBRUCK 7 · PARIS 4 · GRAVEL MOUNTAIN 4 · CRITCITY 2 · BOLOGNATT 1 · Climb Portal 48

**217 segments** — each `<SEGMENT>` element has:
- `name`, `world` (integer ID), `roadId`, `direction`
- **`onRoutes`** — comma-separated list of route `signature` values that pass through this segment

**This solves the route-to-segment mapping problem.** The `onRoutes` field maps every segment to the exact routes it appears on — authoritatively, from Zwift's own data. Verified examples:
- Alpe du Zwift → Road to Sky, Four Horsemen, Tour of Fire and Ice, Uber Pretzel, Quatch Quest, Accelerate to Elevate
- Epic KOM → Watopia Mountain Route, Pretzel, Three Sisters, Big Loop, Mega Pretzel, Four Horsemen, WBR Climbing Series
- Fuego Flats Sprint → Tempus Fugit, Tick Tock, Big Flat 8, Spiral into the Volcano, and 6 others

This **retires the Tier 3 "Route-segment lookup table (manual, high precision)"** item entirely.

World ID integer mapping: 1=Watopia · 2=Richmond · 3=London · 4=NewYork · 5=Innsbruck · 6=Bologna · 7=Yorkshire · 8=France · 9=MakuriIslands · 10=Paris · 11=Scotland · 12=GravelMountain

---

#### Data source 2: MapSchedule_v2.xml

Guest world rotation. `<appointment map="LONDON" start="2026-04-10T00:01-04" />` — filter for `start <= now`, take the most recent entry for today's guest world. Covers ~2 months; Watopia always implicitly available.

**Replaces** the hardcoded `guestWorldSchedule` in `routes.js` (previously listed as a separate Tier 1 item — subsumed here).

---

#### Data source 3: PortalRoadSchedule_v1.xml

Portal climb metadata + rotation schedule. Distances and elevations are in **centimeters** — divide by 100 for meters. `portal_of_month="true"` marks the featured climb. Enables "Today's Climb Portal" display; on HIGH/sustained_climb days, mention the portal as an alternative.

---

#### Data source 4: relay/worlds (live)

Live player counts per world. `{"worldId":1,"name":"Public Watopia","playerCount":3483,...}`. Lower priority — possible "riders online" badge.

---

#### Implementation plan

**Phase 1 — Replace hardcoded data (high value, well-scoped)**
1. Fetch and parse `MapSchedule_v2.xml` on app load → replace hardcoded guest world schedule; cache in localStorage with 24h TTL; fallback to user-selectable picker if fetch fails
2. Fetch and parse `GameDictionary.xml` → build `routeSignature → [segment names]` lookup; replace world-level segment association with precise per-route `onRoutes` mappings; ride cues and segment chips become precise instead of approximate
3. Fetch and parse `PortalRoadSchedule_v1.xml` → show "Today's Climb Portal: [name] — [distance] / [elevation]"

**Phase 2 — Enrich route cards**
4. Surface `leadinDistanceInMeters`, `eventOnly`, `levelLocked`, `supportedLaps` flags on cards from GameDictionary data
5. Evaluate whether GameDictionary can replace `zwift-data` + `bundle-routes.mjs` entirely (374 routes vs ~320; keep `zwift-data` only for Strava segment IDs and route slugs for ZwiftMap URLs)
6. Version-check cache invalidation: fetch `Zwift_ver_cur.xml` to detect game patches and re-fetch GameDictionary when version changes

**Phase 3 — Nice-to-haves**
7. Live rider count badge from `relay/worlds`
8. Portal climb difficulty contextualization (effort rating, estimated duration at rider's W/kg)

---

#### CORS considerations

Test browser `fetch()` from Netlify before building a proxy. If blocked, add `netlify/functions/zwift-cdn-proxy.js` following the same pattern as the Xert proxy.

---

#### World name mapping (XML → app slug)

```
WATOPIA → watopia · LONDON → london · FRANCE → france · PARIS → paris
MAKURIISLANDS → makuri-islands · NEWYORK → new-york · INNSBRUCK → innsbruck
RICHMOND → richmond · SCOTLAND → scotland · YORKSHIRE → yorkshire
CRITCITY → crit-city · BOLOGNATT → bologna · GRAVEL MOUNTAIN → gravel-mountain
```

Route name → slug mapping: GameDictionary uses `name` strings, not slugs. Build a one-time lookup: `GameDictionary.name → routes-data.js slug` by matching on name. Document mismatches in `zwift-data-reference.md`.

---

#### Files involved

**New:** `zwift-cdn.js` (fetch + parse all CDN endpoints), `segment-route-map.js` (runtime-built mapping from `onRoutes`), possibly `netlify/functions/zwift-cdn-proxy.js`

**Modified:** `routes.js` (live schedule), `segments.js` (precise per-route mappings), `app.js` (init fetch, portal display), `index.html` / `style.css` (portal element), `zwift-data-reference.md`

**Unchanged:** `xert.js`, `proxy.js`, `netlify/functions/xert-proxy.js`, `mock-data.js`, `scorer.js` function signatures (better input data, same interface)

---

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

### Bucket bars: replace training load with completed-vs-target

The status bars currently render `training_info.tl.low/high/peak` (accumulated training load) against `targetXSS` daily targets. Training load is always much larger than a single day's target, so the bars appear fully filled even on zero-activity days. This is confusing — it looks like "I crushed it" when the real message is "Xert set a small target today."

**Fix — two-layer bar model:**
- Bar total width = daily target (`targetXSS.low/high/peak` from `training_info`)
- Bar fill = completed today (sum of `summary.xlss/xhss/xpss` from `GET /oauth/activity?from=&to=`)
- When target is 0 for a bucket (like High/Peak on a low-only day), show a collapsed/empty bar with "0 / 0" — not a full bar
- When completed exceeds target, cap the fill at 100% and show an overflow indicator (e.g. "77.9 / 26.7 — 291%")

**Training load display:**
- Remove `tl.low/high/peak` from the bar rendering entirely
- Optionally surface training load as a small secondary text element (e.g. "TL: 77.9") near the bar or in a tooltip — it's useful context for why targets are low, but it doesn't belong in the progress visualization

**Edge cases:**
- Zero-activity day with non-zero targets: bars should be empty, showing "0 / 26.7 — 26.7 left"
- Zero-target buckets: bar should be visually collapsed or minimal, not full
- Multiple activities: sum all `xlss/xhss/xpss` values across today's activity list
- Activity sync delay: when activity list is empty but `targetXSS > 0`, consider showing "Syncing..." rather than confidently displaying 0 completed (see existing parking lot note on API sync delay)

**Files involved:**
- `app.js` — bar rendering logic, data binding from `parseTrainingData` output
- `style.css` — two-layer bar styling, overflow indicator
- `index.html` — if bar markup needs structural changes for the second layer

**Does not change:**
- `scorer.js` — no scoring logic affected
- `xert.js` — data fetch is already correct, just need to use the right fields
- Recent Progress panel — separate concern, leave as-is

### Daily Summary fidelity pass
Confirm edge cases: multiple rides, imported rides, timezone boundaries, rounding differences with Xert's own UI.

### Route segment ordering, duplicate hits, and route inspection
The new Zwift CDN route-to-segment mapping is now much better for **membership** — we can accurately say which segments belong to a route — but it still does **not** preserve the order those segments occur on the route, nor whether a route hits the same segment multiple times.

This matters because the app is now showing route-specific segment chips and using those segments in ride cues, but the displayed order is still a sorting heuristic, not true route order. Repeated sprint routes are where this is most obvious.

**Observed example — Triple Flat Loops**
- Zwift Insider lists:
  - `Fuego Flats Sprint`
  - `JWB Sprint Reverse`
  - `JWB Sprint Reverse`
  - `Fuego Flats Sprint`
- The app currently shows:
  - `Fuego Flats`
  - `Sprint Forward End`

So the app is correctly detecting multiple sprint memberships, but it is **not yet able to express duplicate occurrences cleanly**, and one XML-only sprint label is still not mapping to the rider-facing name we actually want.

**Current technical limitation**
- `GameDictionary.xml` gives us `onRoutes`, which is route membership only
- The generated `segmentsOnRoute` entries currently use `from: null` / `to: null`
- We therefore do not know:
  - exact route order
  - repeated occurrences
  - whether a cue should say "first sprint", "second sprint", or "hit this twice"

**Why this matters**
- Segment chips are membership-accurate, but not sequence-accurate
- Ride cues can name good targets, but not reliably say when they happen
- Duplicate sprint routes can understate how many opportunities a rider actually gets
- UI validation is harder because some routes are not visible under today's world filter, and there is no dedicated route-inspection test page

**Future implementation direction**
1. Investigate whether Zwift has another public source with route-position data for segments, or whether existing community datasets can provide ordered segment positions per route
2. If no better source exists, evaluate a compatibility bridge using legacy `zwift-data` `segmentsOnRoute.from/to` data where available
3. Extend generated route data to support ordered segment occurrences, not just unique segment membership
4. Update route chips and ride cues to express duplicate occurrences, e.g. `JWB Sprint Rev. ×2`
5. Prefer rider-facing names like `JWB Sprint Reverse` over internal XML labels like `Sprint Forward End`
6. Add a lightweight route inspection/test harness so specific routes like `Road to Sky`, `Tempus Fugit`, `Surrey Hills`, and `Triple Flat Loops` can be checked regardless of today's worlds

**Acceptance criteria when this is tackled**
- Segment chips reflect route order, not just sorted importance
- Duplicate segment hits are shown explicitly
- Triple Flat Loops resolves to two named sprint targets with correct duplicate counts
- Route-specific checks are possible even when the route is outside today's active worlds

---

## Tier 2 — Good features, moderate effort

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
Share button is live (PNG + plain text via ClipboardItem). Potential improvements: richer plain text formatting (emoji, markdown), better ride cue truncation, option to share just text without image.

### ZwiftMap iframe — expandable route map on cards

Adds an expandable map panel to route cards using ZwiftMap's public website via iframe. Riders can visually inspect the route — road layout, elevation profile, segment locations, road surfaces — before starting their ride.

**Confirmed feasibility:**
- ZwiftMap does NOT send `X-Frame-Options` or `Content-Security-Policy` frame-ancestors headers — iframe embedding is allowed (verified via response header check)
- URL pattern: `https://zwiftmap.com/{world}/{route-slug}` — predictable and clean
- ZwiftMap uses `zwift-data` as its data source (same package this app uses), so route slugs should match directly

**Implementation — expandable panel approach:**
- "🗺️ View Map" button on each route card; tap to expand a panel below the card containing an iframe
- Only one map panel open at a time — opening a new one collapses the previous
- Iframe dimensions: 100% width, 350–400px height
- Lazy load: iframe `src` is only set when the panel is opened — no iframes rendered until tapped
- Collapse button to close the panel

**URL construction:**
```javascript
const zwiftMapUrl = `https://zwiftmap.com/${route.world}/${route.slug}`;
```
World slug mapping is 1:1 with `routes-data.js` slugs (`watopia`, `london`, `makuri-islands`, `france`, `paris`, `new-york`, `innsbruck`, `richmond`, `scotland`, `yorkshire`).

**Validation before shipping:** Test top 20 recommended routes' ZwiftMap URLs to confirm slugs resolve. Document any mismatches in `zwift-data-reference.md`. Hide the "View Map" button for any route that 404s.

**Fallback:** If ZwiftMap ever adds `X-Frame-Options` blocking, degrade to an external "View on ZwiftMap" link in a new tab. If the iframe fails to load, show an error message with a "Try opening in new tab" link.

**Data enrichment note:** ZwiftMap cannot be used as a data source. The iframe is sandboxed — the app cannot read any DOM or JavaScript data from inside it. Visual enrichment only.

**Files involved:**
- `app.js` — zwiftMapUrl on route card data, expandable panel toggle logic
- `index.html` — expandable panel markup with iframe container
- `style.css` — panel expand/collapse animation, iframe sizing, button styling

**Does not change:** `scorer.js`, `routes-data.js`, `xert.js`

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
No API needed, baked-in logic on the route card.

### Workout-route pairing
WOTD data already comes from Xert. Match the workout structure to a route — interval workout → route with repeated punchable climbs; long endurance block → flat loop; recovery spin → short flat. Bridges the gap between "do this workout" and "ride this route."

### PR targeting via Strava segment links
`zwift-data`'s segments export includes `stravaSegmentUrl` for most climbs and sprints. Surface these directly on route cards as tappable chips — climbs in orange, sprints in green. Rider can tap before their ride to check their current PR. Pairs naturally with ride cues: if the cue says "hit the Epic KOM at threshold," the Strava link is right there. No new API or auth required — pure static data from the already-bundled `segments-data.js`.

### Strava integration, phase 1: live PRs on segment chips
Add Strava OAuth and fetch the rider's current PRs for the climbs/sprints on today's recommended routes so the chips show real personal context rather than only linking out. Cache aggressively in localStorage to keep request volume low. This is the highest-value Strava feature because it improves the pre-ride workflow directly.

What it does:
- Replaces static Strava links on segment chips with actual PR time and rank pulled from Strava before the ride.
- Lets the rider see “your PR: 52:14, ranked 4,823” directly on the card instead of tapping out to Strava first.

What it needs before starting:
- Strava OAuth credentials from `https://www.strava.com/settings/api`
- `client_id`, `client_secret`
- Redirect URIs:
  - local: `http://localhost:3001/strava-callback`
  - production: `https://[your-netlify-domain]/strava-callback`
- Scope:
  - `read` is sufficient for Phase 1
  - `activity:read` will be needed later for Phase 2
- Store credentials in Netlify environment variables:
  - `STRAVA_CLIENT_ID`
  - `STRAVA_CLIENT_SECRET`

API / implementation notes:
- Strava segment IDs already exist in `segments-data.js` as `stravaSegmentId`
- Add `netlify/functions/strava-proxy.js` mirroring the Xert proxy pattern
- Add `strava.js` to handle OAuth token exchange, refresh, caching, and segment stat fetches
- Fetch PR data only for route-linked segments on today's top recommendations
- Cache by `segmentId + date` in localStorage with ~24h staleness
- If Strava is not connected or a segment has no usable data, fall back silently to the current static-link behavior

Files likely involved:
- `netlify/functions/strava-proxy.js`
- `strava.js`
- `app.js`
- `index.html`
- `style.css`
- `zwift-data-reference.md`

Known limitation:
- Some `stravaSegmentId` values from `zwift-data` may 404 or return no athlete stats. Missing PR data must degrade gracefully.

### Strava integration, phase 2: post-ride verification and feedback
Use Strava activities after the ride to verify whether the rider actually rode the recommended route, which segments fired, and how their efforts compared with the cue. This would close the loop meaningfully, but it is enrichment and validation only — Xert remains the source of truth for bucket accounting and XSS.

Prerequisite:
- Phase 1 must exist first, including Strava OAuth and `strava.js`

What it does:
- Fetches the rider's most recent Strava activity after the ride
- Compares it against the route and segments the app recommended
- Writes a richer history snapshot and shows a “today's ride recap” view

What it needs before starting:
- Strava endpoint: `GET /api/v3/athlete/activities?per_page=1`
- Needed fields:
  - `id`, `name`, `elapsed_time`, `distance`, `total_elevation_gain`
  - `segment_efforts[]`
- Scope upgrade to `activity:read`
- Graceful re-auth prompt if the rider previously granted only `read`

Planned behavior:
- Match `segment_efforts` against the recommended route's `stravaSegmentId` values
- Detect PRs from Strava achievements metadata
- Expand local history snapshots to include:
  - `routeRidden`
  - `segmentEfforts: [{ name, elapsed, prRank, isPR }]`
- Add a rider-initiated `Log today's ride` button rather than fetching automatically
- Handle upload delay gracefully with a message like “No recent activity found yet — try again in a few minutes”

Files likely involved:
- `strava.js`
- `app.js`
- `index.html`
- `style.css`

---

## Tier 3 — Longer term / needs more thought

### Sauce4Zwift route export: pre-built JSON library
Add a `Download for S4Z` button to supported route cards so the rider can import a pre-built JSON route file into Sauce4Zwift and focus entirely on executing the cue during the ride.

What it needs before starting:
- Understand the S4Z route JSON format from the sample `Test_Route-Watopia.json`
- Key fields include:
  - `manifest[]` with ordered road segments
  - `courseId`
  - `spawnPoint`
  - informational `distance` / `elevation`
- This data is not derivable from `zwift-data` route totals alone

Manual build process:
1. Start S4Z and Zwift
2. Ride the target route while S4Z records the road graph
3. Export the route from S4Z
4. Save it as `{route-slug}.json` in `s4z-routes/`

Priority routes to build first:
- Watopia: `radio-rendezvous`, `glyph-heights`, `out-and-back-again`, `canopies-and-coastlines`, `mountain-mash`, `road-to-ruins`, `tempus-fugit`, `waisted-8`, `big-flat-8`, `watopia-figure-8`
- London: `surrey-hills`, `triple-loops`, `london-loop`

Implementation shape:
- Add `s4z-routes/`
- Add `s4z-route-index.js` mapping route slug -> file availability
- In `app.js`, enrich cards with `hasS4ZExport`
- In the UI, show a download button only when a JSON export exists
- Document the process in `catchup.md` and `zwift-data-reference.md`

Operational note:
- The library can grow opportunistically. No minimum route count is required before shipping the button.

### ~~Route-segment lookup table (manual, high precision)~~ — RETIRED
Superseded by `GameDictionary.xml` `onRoutes` field (see Tier 1 CDN integration). The authoritative mapping is already there — no manual work needed.

### Route profiles (elevation graphs)
Not available via any API. `zwift-data` has only totals (distance, elevation), not segment-level profiles. Zwift Insider has profile images per route — we already link to their pages. Options: link directly to ZwiftInsider profile page, or source a community dataset if one exists. Needed for proportional per-segment bucket attribution (see multi-bucket scoring above).

### Sauce4Zwift live integration
WebSocket connection to Sauce4Zwift for live Magic Buckets tracking during a ride. Would show real-time bucket fill as you ride rather than pre-ride estimates. Requires Sauce4Zwift to be running and exposes a local WebSocket.

### Strava segment integration
Personal PRs on recommended routes. Requires Strava OAuth. Nice motivational layer — "you PRd this climb 3 weeks ago, you're fresher now."

### Seasonal / phase awareness
Xert exposes enough context that the app may eventually infer whether the rider is in build, maintenance, taper, or recovery emphasis. That could tune the language and aggressiveness of recommendations even when today's deficits look similar on paper.

### Sauce4Zwift: dynamic WOTD-tailored route generation
Instead of only recommending pre-existing Zwift routes, generate custom S4Z route JSON tailored to the workout structure, e.g. repeated KOM hits with controlled recovery between.

Prerequisite:
- The pre-built S4Z library must exist first so the import/export path is proven and there are real sample JSON files to learn from

What it needs before starting:
- A usable Zwift road graph with `roadId`, lengths, connectivity, and segment positions
- `zwift-data` is not enough for this
- Best public sources to investigate:
  - RoadCaptain: `https://github.com/sandermvanvliet/RoadCaptain`
  - Sauce4Zwift source: `https://github.com/SauceLLC/sauce4zwift`
  - community road ID maps on GitHub / Zwift modding forums

Research spike first:
- Can the RoadCaptain or S4Z road graph be extracted into a route-composer-friendly format?
- If yes, build a solver that accepts:
  - `must_include_segments[]`
  - target duration
  - world
  - start point
- Then output a valid connected S4Z manifest

Reality check:
- This is a serious graph-search / data-modeling project, not a quick feature. If the road graph cannot be extracted cleanly, the manual library may remain the practical ceiling.

### Proportional XSS per segment
Rather than labeling a route as "LOW" or "HIGH", estimate how much XSS each bucket generates from it (flat sections → low, climbs → high, sprint points → peak). Much closer to how Xert actually thinks about rides. Depends on route profile data being available first.

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
