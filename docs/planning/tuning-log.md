# Track A Tuning Log

## Living document — add ride data and observations over time

-----

## Purpose

This document tracks real-world ride data used to tune the scoring and bucket detection
logic in `public/app/core/scorer.js`. It is structured so it can be handed to Claude
at any future point and provide full context without needing to re-explain the app.

When adding new data: paste the Xert activity summary and the app screenshot (or text
description of what the app showed) into the **Ride Log** section. Add observations
to the **Findings** section. The tuning constants table at the bottom reflects the
current live values.

-----

## What's Being Tuned

### 1. `detectBucket()` — which energy system needs work

Located in `scorer.js`. Takes `tl` (current training loads) and `targetXSS` (daily
targets) and returns `'low' | 'high' | 'peak' | 'recovery'`.

**Known issue:** When `targetXSS.high` and `targetXSS.peak` are both 0 (common when
Xert hasn't assigned structured work), LOW will always win by raw deficit magnitude
even on days where the rider intends to do mixed work. The `WOTD_SIGNAL_BOOST`
constant (Track A, A3 fix) addresses this by amplifying HIGH and PEAK deficits when
Xert has explicitly targeted those systems.

**Calibration question:** Is `WOTD_SIGNAL_BOOST = 1.6` the right multiplier? Needs
rides where `targetXSS.high > 0` or `targetXSS.peak > 0` to validate.

-----

### 2. `segmentSupport()` — how much HIGH/PEAK work a segment can generate

The core per-segment scoring function. Two known calibration issues:

**`peakDistanceFactor` over-penalty** in `deriveRouteBucketSupport()`:

- Current: `clamp(1 - (routeDistance / 60), 0.25, 1)`
- A 30km route loses 50% of its PEAK score before segment data is considered
- Fix (pending): `clamp(1 - (routeDistance / 90), 0.5, 1)`

**3km PEAK dampener** in `segmentSupport()`:

- Current: segments ≥ 3km get `peak *= 0.12` regardless of grade
- A 3.2km segment at 12% average grade is genuinely punchy — 0.12 is too harsh
- Fix (pending): gate on grade as well as distance — steep segments get `peak *= 0.35`
  instead of `0.12`

-----

### 3. HIGH coverage estimate for flat sprint segments

**Known problem, confirmed by ride data (see Croissant entry below):**

Flat sprint banners are classified as HIGH work in the segment support model, but
actual XSS actuals show sprint-heavy flat routes generate mostly LOW XSS with a
small PEAK spike and very little HIGH. The bucket chip UI was showing HIGH ~39 on
Croissant when actual HIGH XSS was 3.4.

This is a structural issue with `segmentSupport()` for non-climb segments — the HIGH
score for flat sprints (`0.45–0.95` range) does not reflect what Xert actually
records as HIGH strain on those efforts.

**Calibration question:** Should flat sprint segments contribute to HIGH at all, or
should they be reclassified as LOW + PEAK only? Need more sprint-heavy ride data to
confirm the pattern before changing the model.

-----

## Current Tuning Constants

These are the live values in `scorer.js` as of branch start. Update this table
whenever constants change.

|Constant                   |Current Value|Location       |Notes                                                             |
|---------------------------|-------------|---------------|------------------------------------------------------------------|
|`ACTIVE_BUCKET_WEIGHT`     |0.65         |`scorer.js` top|How strongly active bucket dominates deficit scoring              |
|`PUNCH_ELEVATION_CAP`      |400m         |`scorer.js` top|Routes above this score 0 on PEAK                                 |
|`PUNCH_GRADIENT_TARGET`    |32 m/km      |`scorer.js` top|Full punch points at/above this gradient                          |
|`PUNCH_DISTANCE_MAX`       |18 km        |`scorer.js` top|Full short-route bonus below this                                 |
|`PEAK_SUPPORT_THRESHOLD`   |0.52         |`scorer.js` top|Route-level support needed before calling route truly mixed       |
|`PEAK_ROUTE_MIN_SUPPORT`   |0.28         |`scorer.js` top|Below this, route should not contend on PEAK days                 |
|`PEAK_ROUTE_STRONG_SUPPORT`|0.5          |`scorer.js` top|Clear PEAK-day contender threshold                                |
|`HIGH_SUPPORT_TARGET`      |1.6          |`scorer.js` top|Summed segment support needed for full HIGH support               |
|`PEAK_SUPPORT_TARGET`      |1.2          |`scorer.js` top|Summed segment support needed for full PEAK support               |
|`PUNCHY_GRADE_MIN`         |8%           |`scorer.js` top|Climbs at/above this grade are PEAK-capable when short            |
|`PUNCHY_DISTANCE_MAX`      |2 km         |`scorer.js` top|Climbs shorter than this can generate PEAK work                   |
|`WOTD_SIGNAL_BOOST`        |1.6          |`scorer.js` top|**NEW (A3)** — amplifies HIGH/PEAK deficits when Xert targets them|
|`TIME_HARD_CUTOFF_RATIO`   |1.6          |`scorer.js` top|**NEW (B1)** — hard exclusion for routes >60% over available time |

-----

## Ride Log

Each entry follows this format:

```
### [Date] — [Route] ([World])
**Laps:** N
**Duration:** Xm  **Distance:** Xkm  **Elevation:** Xm
**XSS:** total ( LOW | HIGH | PEAK )
**Target XSS:** LOW | HIGH | PEAK (from Xert day view)
**WOTD:** name / type
**App bucket detected:** LOW / HIGH / PEAK / RECOVERY
**App showed:** [screenshot description or text]
**Observations:** [what matched, what didn't, what was surprising]
```

-----

### Apr 21 2026 — Croissant (France)

**Laps:** 3
**Duration:** 68 min  **Distance:** 32.0 km (19.9 mi)  **Elevation:** ~147m (49m × 3 laps)
**XSS:** 84 ( 79 LOW | 3.4 HIGH | 1.5 PEAK )
**Target XSS:** not recorded for this session
**WOTD:** Mixed mode day
**App bucket detected:** not recorded
**App score:** 57

**App showed:**

- Route label: LOW+HIGH route
- Cue: "This is a LOW+HIGH venue, not a true mixed route. Ride flats in Z2, then hit
  sprints in order: Dos d'Âne Sprint, Sprint du Cratère, Sprinteur Sprint, and Sprint
  du Cratère, then 3 more later. 4 recovery gaps are short, so later efforts will be
  somewhat degraded. Expect little true PEAK work."
- Bucket chips: LOW ~11/79, HIGH ~39/20, PEAK ~0/21
- Context: ZRL race, 3 laps, high effort throughout

**Observations:**

- **LOW+HIGH label was accurate.** Actual ride confirmed LOW dominated (79 of 84 XSS).
- **PEAK prediction was accurate.** App showed ~0 PEAK, actual was 1.5 — correct.
- **HIGH chip is significantly inflated.** App estimated ~39 HIGH against a 20-unit
  target. Actual HIGH XSS was 3.4. Sprint banners on a flat route do not generate
  meaningful HIGH strain — they generate LOW with a small PEAK spike.
- **Cue was honest and directionally correct** — rider was told not to expect PEAK
  work. This is the right call for a flat sprint route on a mixed day.
- **Key finding:** Flat sprint segment HIGH contribution is over-modeled. The
  `segmentSupport()` HIGH score for non-climb segments (0.45–0.95) does not match
  Xert's actual HIGH XSS recording for flat sprint efforts.

-----

### Apr 16 2026 — Road to Sky (Watopia)

**Laps:** 1
**Duration:** 3h 36m  **Distance:** 30.7 km (19.1 mi)  **Elevation:** not recorded
**XSS:** 180 ( 178 LOW | 1.1 HIGH | 0.5 PEAK )
**Target XSS:** not recorded
**WOTD:** not recorded
**App bucket detected:** not recorded
**App showed:** not recorded

**Observations:**

- **Even a major climbing route can produce almost entirely LOW when ridden at steady
  low intensity.** 178 of 180 XSS was LOW despite Road to Sky's substantial elevation.
- **Terrain is opportunity, not automatic bucket fill.** The app should distinguish
  between what a venue *can* produce if attacked versus what it will produce at
  conversational Z2 pace.
- **Design implication:** Route cards and cue text should keep reminding riders that
  HIGH/PEAK work requires deliberate effort — a climbing route does not guarantee
  HIGH strain by itself.

-----

## Pre-Clean-Signal Ride Data (March–April 2026)

> **Context:** These rides were recorded while lifting workouts were also logged in
> Xert. HIGH and PEAK targets were artificially suppressed (often 0.0) because lifting
> was filling those buckets. This data is useful for route scoring validation but
> **not** for `detectBucket()` calibration. Clean signal starts late April 2026 when
> lifting was removed from Xert tracking.

|Date  |Route                |World  |Duration|Distance|Elevation|LOW XSS|HIGH XSS|PEAK XSS|Target LOW|Target HIGH|Target PEAK|WOTD                   |
|------|---------------------|-------|--------|--------|---------|-------|--------|--------|----------|-----------|-----------|-----------------------|
|Mar 17|Flat Out Fast        |Watopia|48m     |22.4km  |48m      |45     |0.6     |0.1     |123       |0          |0          |Threshold 7x3min at 95%|
|Mar 19|Southern Coast Cruise|Watopia|58m     |24.1km  |138m     |57     |0.7     |0.2     |—         |—          |—          |—                      |
|Mar 22|Tempus Fugit         |Watopia|6m      |2.6km   |6m       |5      |0       |0       |27        |0          |0          |Active Recovery Day    |
|Mar 22|Neokyo All-Nighter   |Makuri |58m     |24.4km  |168m     |59     |3.0     |0.8     |27        |0          |0          |Active Recovery Day    |
|Mar 24|Sand and Sequoias    |Watopia|59m     |23.1km  |181m     |60     |8.3     |4.7     |—         |—          |—          |—                      |
|Mar 31|Big Spin Stage 3     |Watopia|55m     |26.7km  |149m     |62     |2.5     |0.5     |—         |—          |—          |—                      |
|Apr 2 |TTT Zone 28          |Watopia|63m     |22.0km  |188m     |74     |2.9     |1.2     |—         |—          |—          |—                      |
|Apr 4 |Mayan San Remo       |Watopia|62m     |21.3km  |217m     |61     |5.1     |2.2     |136       |0          |0          |Threshold 7x6min at 95%|
|Apr 7 |Mayan 8              |Watopia|18m     |7.0km   |22m      |13     |0.4     |0.1     |—         |—          |—          |—                      |
|Apr 7 |Temple Trek          |Watopia|30m     |8.7km   |52m      |24     |0.4     |0.1     |—         |—          |—          |—                      |
|Apr 11|Sugar Cookie         |Watopia|104m    |39.1km  |260m     |95     |3.7     |1.7     |128       |16.2       |9.3        |SMART - Body Movin'    |
|Apr 16|Road to Sky          |Watopia|3h 36m  |30.7km  |—        |178    |1.1     |0.5     |—         |—          |—          |—                      |
|Apr 16|Flat Out Fast        |Watopia|47m     |22.2km  |48m      |48     |0.7     |0.1     |123       |0          |0          |Threshold 7x3min at 95%|
|Apr 16|Wandering Flats      |Makuri |64m     |25.4km  |146m     |62     |2.5     |2.4     |62        |0          |0          |Tempo 24x60 at 75%     |

### Notes on individual pre-clean-signal rides

**Apr 11 — Sugar Cookie:** Pre-ride gaps were 127.8 LOW / 16.2 HIGH / 9.3 PEAK. Actual
fill was 74% LOW / 23% HIGH / 18% PEAK. An earlier blended single-number estimate
showed "89% of today's gap", which was misleading — HIGH and PEAK were barely touched.
Core evidence for per-bucket prediction display and for treating mostly flat routes
with sprint opportunities as LOW-dominant.

**Apr 16 — Road to Sky:** Ridden at very steady low intensity. Terrain produced almost
entirely LOW regardless of significant climbing. See full entry in the Ride Log above.

**Apr 16 — Flat Out Fast:** Rode Zone 2 with no sprints performed. Almost entirely LOW
strain (48 of 49 XSS). Clean flat-route Z2 baseline for validating LOW XSS/hour
estimates and confirming that non-attacked flat routes should not advertise meaningful
HIGH/PEAK support.

**Apr 16 — Wandering Flats:** Rode Z2 throughout, doing only the first two sprints.
Still overwhelmingly LOW (62 of 67 XSS) despite two sprint efforts. Flat sprint routes
ridden at moderate effort are primarily LOW venues with small incidental HIGH/PEAK.

-----

## Findings Summary

|Finding                                                    |Confidence                                |Status                  |Action                                                                                         |
|-----------------------------------------------------------|------------------------------------------|------------------------|-----------------------------------------------------------------------------------------------|
|Flat sprint HIGH is over-modeled; PEAK is under-modeled    |High — 4 rides confirm pattern            |**Implemented (A7)**    |HIGH capped 0.1–0.3; PEAK raised 0.2–0.7 for non-climb segments. Flag for live validation.    |
|`peakDistanceFactor` penalizes 30km routes too aggressively|Medium — logic analysis                   |**Implemented (A1)**    |Changed `/60 floor 0.25` to `/90 floor 0.5`. Validate on next punchy mid-distance route.      |
|3km PEAK dampener ignores grade                            |Medium — logic analysis                   |**Implemented (A2)**    |Steep segments (≥10% grade) at 3km+ now get `0.35` multiplier instead of `0.12`.              |
|`detectBucket()` LOW dominates when WOTD targets HIGH/PEAK |Medium — one confirmed case (Sugar Cookie)|Parked (A3)             |Needs rides with non-zero HIGH/PEAK targets post-lifting removal to validate `1.6` multiplier. |
|HIGH and PEAK targets were 0 due to lifting in Xert        |Confirmed                                 |Resolved                |Lifting removed from Xert tracking late April 2026.                                            |
|Even climbing routes produce mostly LOW at Z2 pace         |High — Road to Sky (178/180 LOW)          |Design note             |Route cue text must distinguish venue potential from execution intensity.                       |

### Open Calibration Questions

- How much HIGH/PEAK should the app expect from flat sprints when the rider otherwise
  rides Z2? (Wandering Flats and Croissant both suggest: very little)
- When does a flat sprint route deserve `LOW+HIGH` versus true mixed support?
- How aggressively should route cards separate today's prescribed execution from what
  the venue *contains* if attacked?
- Do current HIGH/PEAK XSS-per-hour assumptions overstate non-LOW contribution on flat
  routes?
- Is `WOTD_SIGNAL_BOOST = 1.6` the right multiplier? Needs rides where
  `targetXSS.high > 0` or `targetXSS.peak > 0` to validate.

-----

## How to Add a New Entry

1. Ride with the app open, note what bucket it detected and what cue it showed
1. After the ride, get the Xert XSS breakdown (LOW | HIGH | PEAK) from the activity
1. Get the Target XSS from the Xert day view (the forecast row)
1. Paste into the Ride Log section using the format above
1. Add any observations — what matched, what felt wrong, what was surprising
1. Update the Findings Summary if the new data confirms or contradicts an existing finding
