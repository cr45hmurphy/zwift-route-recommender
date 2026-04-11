# Zwift Route Recommender — Project Spec
**Version:** 1.0  
**Type:** Single-page web app (no backend, no server required)  
**Purpose:** Pre-ride decision tool — "What should I ride today based on my current fitness?"

---

## Overview

A lightweight browser-based app that pulls your current Xert fitness data, compares your bucket deficits against the Xert daily targets, and recommends Zwift routes most likely to help fill your most depleted energy system. Open it before you clip in, pick a route, go ride.

---

## Data Sources

### 1. Xert Online API (v1.4)
- **Base URL:** `https://www.xertonline.com/oauth/`
- **Auth:** OAuth2 password grant
  - Token endpoint: `POST /oauth/token`
  - Client ID + secret: `xert_public` / `xert_public`
  - Store token in `localStorage` after first login, refresh as needed
- **Endpoints used:**
  - `GET /training_info` — returns fitness signature, training loads, targets, freshness status, and workout of the day

**Key fields from `/training_info`:**
```
signature.ftp       — Threshold Power (watts)
signature.ltp       — Lower Threshold Power (watts)  
signature.hie       — High Intensity Energy (kJ)
signature.pp        — Peak Power (watts)
status              — "Fresh", "Tired", "Very tired", etc.
tl.low / high / peak / total     — current training loads
targetXSS.low / high / peak / total  — recommended daily targets
wotd.name           — workout of the day name
wotd.difficulty     — difficulty score
wotd.description    — description text
weight              — rider weight in kg
```

---

### 2. Zwift public CDN snapshot
- **Authoritative source:** Zwift public CDN XML
- **Usage:** Normalize Zwift route and schedule XML into generated browser modules during a build step
- **Generator:** `node scripts/build-zwift-data.mjs`
- **Generated outputs:** `routes-data.js`, `segments-data.js`, `zwift-metadata.js`

**Key fields per route:**
```
name                — Route display name
world               — World slug (e.g. "watopia", "london", "innsbruck")
distance            — Distance in kilometers
elevation           — Total elevation gain in meters
eventOnly           — Boolean: true = can't free ride this route
levelLocked         — Boolean: true = requires a certain Zwift level
sports              — Array: ["cycling"] or ["running"] or both
supportedLaps       — Boolean: true = lap-friendly route
leadInDistance      — Lead-in distance in kilometers
leadInElevation     — Lead-in elevation in meters
zwiftInsiderUrl     — Link to ZwiftInsider page for the route
whatsOnZwiftUrl     — Link to What's on Zwift page
```

---

## Core Logic

### Step 1 — Calculate Bucket Deficit
For each of the three Xert energy systems, calculate how far current training load is from the recommended target:

```
lowDeficit  = targetXSS.low  - tl.low
highDeficit = targetXSS.high - tl.high
peakDeficit = targetXSS.peak - tl.peak
```

The bucket with the **highest positive deficit** is the primary recommendation driver.

If all deficits are negative (overtrained/at target), surface a recovery/endurance recommendation.

---

### Step 2 — Route Scoring

Each route gets scored based on its distance and elevation profile. The scoring logic maps to Xert's energy systems as follows:

#### Bucket → Route Characteristic Mapping

| Xert Bucket | Energy System | Target Route Profile |
|---|---|---|
| **Low (LTP)** | Aerobic endurance | Long distance, low elevation/km ratio — flat to rolling |
| **High (HIE)** | Sustained threshold | Moderate elevation, medium distance — climbing routes |
| **Peak (PP)** | Neuromuscular/explosive | Short, punchy — high elevation/km ratio or known sprint routes |

#### Scoring Formula

Calculate a **gradient ratio** for each route:
```
gradientRatio = elevation / distance  (meters per km)
```

Score each route 0–100 against the target bucket:

**For Low bucket (flat, long):**
```
distanceScore = min(distance / 40, 1) * 60       // favor routes 40km+, max 60pts
flatnessScore = max(0, 1 - gradientRatio / 15) * 40  // penalize routes >15m/km gradient
score = distanceScore + flatnessScore
```

**For High bucket (climbing, sustained):**
```
elevationScore = min(elevation / 800, 1) * 50    // favor routes with 800m+ gain, max 50pts
distanceScore  = min(distance / 25, 1) * 30      // favor routes 25km+
midGradient    = gradientRatio >= 8 && gradientRatio <= 25 ? 20 : 0  // reward moderate gradient
score = elevationScore + distanceScore + midGradient
```

**For Peak bucket (short, punchy):**
```
punchScore   = min(gradientRatio / 30, 1) * 60   // reward high gradient ratio
shortScore   = max(0, 1 - distance / 20) * 40    // reward routes under 20km
score = punchScore + shortScore
```

**Apply filters before scoring:**
- Exclude `eventOnly: true` routes (can't free ride them)
- Exclude `sports` that don't include cycling
- Optionally filter by world (future feature)

**Sort** all routes by score descending. Return top 5.

---

## UI Layout

Single page, no routing needed. Three visual sections:

---

### Section 1 — Your Status (top of page)

Displayed as a card row. Shows:

- **Freshness badge** — color-coded pill: green = Fresh/Very Fresh, yellow = Tired, red = Very Tired / Detraining
- **FTP** — current watts
- **Weight** — kg
- **Three bucket bars** — horizontal progress bars showing current load vs. target for Low / High / Peak
  - Each bar labeled with current/target values
  - The most-deficient bucket highlighted (this drives recommendations)

---

### Section 2 — Today's Recommendation (middle)

A highlighted banner showing:
- Which bucket needs filling most (e.g. "Your High Intensity bucket needs work")
- Plain-English explanation (e.g. "You're 12 XSS short of your threshold target — a climbing route will help")
- Xert's Workout of the Day name + difficulty if available

---

### Section 3 — Recommended Routes (main content)

A card grid (3 columns desktop, 1 column mobile) showing the top 5 routes. Each card shows:

- Route name
- World name (human readable, not slug)
- Distance (km) and Elevation (m) — displayed prominently
- Gradient ratio badge (e.g. "12 m/km")
- A short generated reason why this route matches (e.g. "Good climbing volume for HIE")
- Links: ZwiftInsider and What's on Zwift (if available in the data)

Below the primary 5, show a collapsed/expandable section "Other options" with the next 10 routes.

---

### Section 4 — Settings / Auth (bottom or modal)

- Xert username + password fields (for initial token fetch)
- Token stored in localStorage after successful auth
- "Refresh data" button to re-fetch Xert training_info
- Last updated timestamp

---

## Tech Stack

Keep this simple and dependency-light:

- **Vanilla HTML + CSS + JavaScript** — no framework required
- **Zwift CDN snapshot generator** — bundled route/schedule metadata built ahead of time
- **Fetch API** — for Xert OAuth and training_info calls
- **No backend** — all API calls go directly from the browser to Xert's API

> **CORS note:** Xert's API still needs a proxy in practice. Zwift route data is generated ahead of time from public XML so the browser app does not depend on runtime CDN fetches.

---

## File Structure

```
zwift-recommender/
├── index.html
├── style.css
├── app.js              # Main logic — auth, API calls, scoring, rendering
├── routes.js           # Zwift route data helpers over generated snapshot data
├── xert.js             # Xert API wrapper (auth, training_info fetch)
├── scorer.js           # Route scoring logic (isolated, easy to tune)
└── README.md
```

---

## World Name Map

The generated Zwift snapshot is normalized to these slugs:

```javascript
const WORLD_NAMES = {
  watopia: "Watopia",
  london: "London",
  "new-york": "New York",
  innsbruck: "Innsbruck",
  richmond: "Richmond",
  bologna: "Bologna",
  yorkshire: "Yorkshire",
  "crit-city": "Crit City",
  "makuri-islands": "Makuri Islands",
  france: "France",
  paris: "Paris",
  scotland: "Scotland",
  "gravel-mountain": "Gravel Mountain",
};
```

---

## Error States to Handle

- Xert auth failure → show friendly error, prompt re-entry of credentials
- Xert API unreachable → show cached data with stale timestamp warning
- No routes match filters → relax filters and show best available with a note
- All buckets at/over target → show recovery mode: recommend flat, short, easy routes regardless of deficit

---

## Out of Scope (v1)

- Live during-ride data (requires Sauce4Zwift WebSocket integration — future v2)
- ZwiftGopher team optimization (solo tool for now)
- Scheduled/event routes
- Mobile app packaging
- User accounts or cloud sync — localStorage only

---

## Future v2 Ideas (don't build now, just notes)

- Connect Sauce4Zwift WebSocket to show live power/bucket progress during a ride
- Add ZwiftGopher scouting for TTT events
- Route filtering by world (only show routes in today's Zwift guest world)
- Strava segment integration for personal PRs on recommended routes

---

## Known Limitations

- Zwift route data still does not classify routes by energy system — the scoring is a heuristic based on distance/elevation and route-linked segment cues
- Xert's MPA algorithm is proprietary — live bucket tracking during a ride is not possible via REST API
- Xert CORS behavior may require a local proxy — test this first before building the full UI

---

*Built for a cybersecurity professional and Zwifter learning to vibeCode. Keep it clean, keep it simple, make it useful.*
