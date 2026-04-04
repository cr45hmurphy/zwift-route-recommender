# Parking Lot — Ideas & Issues for Later

Items that came up during build but weren't actioned. Pick these up in future sessions.

---

## Scoring tuning
- **Road to Sky / Alpe du Zwift rank too low in HIGH bucket.** Their gradient ratio (~83 m/km) blows past `CLIMB_GRADIENT_MAX` of 25 in scorer.js and misses the 20-point bonus. Options: raise the cap, use a softer penalty curve, or add a separate "pure climbing" bonus for routes with very high elevation gain regardless of gradient ratio.
- **RECOVERY bucket uses same logic as LOW.** Could be made stricter — e.g. cap distance at 30 km and penalise anything with elevation > 200 m to surface true easy options.

## UI polish
- Numbers from Xert (FTP, LTP, etc.) come in with many decimal places — currently rounded with `Math.round()`. Consider showing one decimal for HIE (kJ) since it's a smaller number.
- Route cards have no image or visual differentiation between worlds. A small world colour tag or icon could help scanability.
- Mobile layout works but hasn't been tested on a real device.

## Features (spec's future v2 list)
- Filter routes by world (only show routes in today's Zwift guest world)
- Sauce4Zwift WebSocket integration for live bucket tracking during a ride
- Strava segment integration for personal PRs on recommended routes
- ZwiftGopher scouting for TTT events

## Operational
- Proxy must be running manually — no auto-start. Could add a `start.bat` / shell script that launches both proxy and serve in one step.
- Token TTL is hardcoded to 1 hour in xert.js (`TOKEN_TTL_MS`). Xert may have a different actual TTL — worth checking if users get unexpected logouts.
- `routes-data.js` is committed to the repo. When zwift-data gets new routes (Zwift adds worlds occasionally), it needs to be regenerated: `node bundle-routes.mjs` and committed.
