# Parking Lot — Ideas & Issues for Later

Organized by priority tier. Top of each section = tackle first.

---

## Tier 1 — Next up (clear value, well-scoped)

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

### Route-segment lookup table (manual, high precision)
World-level segment association (all segments in Watopia shown for any Watopia route) is an approximation — some segments won't appear on a given route. Long-term, maintain a manual lookup: route slug → [segment slugs]. Roughly 50 key routes covers the most-ridden content. Would make ride cues and PR chips precise rather than approximate. Prerequisite: segment bundling (Tier 1) must be complete first. Build opportunistically — add entries as routes get ridden and verified.

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
- `routes-data.js` needs regenerating when Zwift adds new worlds: `node bundle-routes.mjs` then commit.
- Local dev still requires two terminals (`node proxy.js` + `npx serve .`). A `start.sh`/`start.bat` launcher would simplify this.
- QA docs now live in `test-plan.md` and `rapid-qa-checklist.md`; keep them updated whenever major recommendation logic or testing affordances change.
