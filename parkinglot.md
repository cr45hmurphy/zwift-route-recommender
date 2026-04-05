# Parking Lot — Ideas & Issues for Later

Organized by priority tier. Top of each section = tackle first.

---

## Tier 1 — Next up (clear value, well-scoped)

### Scoring: algorithm tuning pass
The PEAK elevation cap (500m) and other thresholds are rough starting points. After accumulating real ride data, revisit:
- `PUNCH_ELEVATION_CAP` — currently 500m; may need adjustment
- `PUNCH_DISTANCE_MAX` — currently 20 km; still unused as the cap
- Whether a combined distance+elevation filter is better than elevation alone
- LOW scoring: long flat routes always win; consider rewarding routes near the rider's actual time budget

---

## Tier 2 — Good features, moderate effort

### W/kg difficulty contextualization
FTP and weight are already in the Xert response. Compute watts per kg and annotate each route card with a personalized difficulty indicator (e.g. "Challenging / Moderate / Comfortable") based on gradient relative to the rider's W/kg. A 83 m/km climb is very different at 2.5 vs 4.5 W/kg. Zero new APIs needed.

### Estimated ride time via W/kg
Currently uses a fixed speed input. Replace with a personalized estimate derived from the rider's FTP/weight — higher W/kg = faster on climbs, slightly faster on flats. Makes time estimates specific to the rider rather than a generic average. Especially meaningful for climbing routes where pace varies a lot by fitness.

### Training load trend (local history)
We fetch Xert data every session but discard previous values. Cache the last 7–10 fetches in localStorage and show a simple per-bucket trend: "Low TL up 12 pts this week ↑". No new API — just persist what we already have. Gives context the current snapshot alone can't provide.

### Favorite routes
Let users star routes they enjoy. Starred routes get a visual indicator and a small score boost so they surface more often when they're a reasonable match. Pure localStorage, no API needed.

### Share / export
One-click copy of today's recommendation to clipboard. Plain text summary: route name, bucket, estimated time, XSS fill %, Xert status. Useful for sharing with a coach or dropping in a Zwift Discord. No API needed.

### "Last ridden" tracking
Once the history cache exists, show "last ridden 18 days ago" on route cards. Give a small score boost to routes not ridden recently to add variety without the rider having to think about it.

### Weekly training overview
Builds on the history cache. A 7-day bar view showing actual training load vs target per bucket across the week. Puts today's recommendation in context — "you've been light on HIGH all week, not just today."

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

### Multi-bucket route scoring
Current model picks one bucket and ranks against it. Better: score routes against all three buckets simultaneously, weighted by deficit size. A route that addresses your two most depleted systems ranks higher than one that nails only the biggest deficit. Foundation for the time-constrained optimization idea.

---

## Tier 3 — Longer term / needs more thought

### Route profiles (elevation graphs)
Not available via any API. `zwift-data` has only totals (distance, elevation), not segment-level profiles. Zwift Insider has profile images per route — we already link to their pages. Options: link directly to ZwiftInsider profile page, or source a community dataset if one exists. Needed for proportional per-segment bucket attribution (see multi-bucket scoring above).

### Sauce4Zwift live integration
WebSocket connection to Sauce4Zwift for live Magic Buckets tracking during a ride. Would show real-time bucket fill as you ride rather than pre-ride estimates. Requires Sauce4Zwift to be running and exposes a local WebSocket.

### Strava segment integration
Personal PRs on recommended routes. Requires Strava OAuth. Nice motivational layer — "you PRd this climb 3 weeks ago, you're fresher now."

### Proportional XSS per segment
Rather than labeling a route as "LOW" or "HIGH", estimate how much XSS each bucket generates from it (flat sections → low, climbs → high, sprint points → peak). Much closer to how Xert actually thinks about rides. Depends on route profile data being available first.

---

## UI polish (pick up anytime)
- Route cards have no visual differentiation between worlds. A small world colour tag could help scanability.
- Mobile layout works but hasn't been tested on a real device.
- HIE display: consider one decimal place since it's a smaller number than FTP.

## Operational
- Token TTL is hardcoded to 1 hour in `xert.js`. Xert's actual TTL may differ — worth checking if users hit unexpected logouts.
- `routes-data.js` needs regenerating when Zwift adds new worlds: `node bundle-routes.mjs` then commit.
- Local dev still requires two terminals (`node proxy.js` + `npx serve .`). A `start.sh`/`start.bat` launcher would simplify this.
