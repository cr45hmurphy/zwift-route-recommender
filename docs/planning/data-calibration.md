# Data Calibration

Use this file for real-ride evidence that can tune route scoring, time estimates, bucket-fill math, and route-truth labels. Keep entries factual: route, context, intended execution, actual execution, and XSS split.

---

## Ride Datapoints

### 2026-04-11 - Sugar Cookie, Watopia

- Source note: `Zwift - Sugar Cookie in Watopia`
- Start time: 11:19 AM
- Distance: 24.3 mi
- Duration: 1h 44m
- Total XSS: 100
- XSS split: 95 LOW / 3.7 HIGH / 1.7 PEAK
- Pre-ride target gaps: 127.8 LOW / 16.2 HIGH / 9.3 PEAK
- Actual target fill: 74% LOW / 23% HIGH / 18% PEAK
- Original app estimate: no per-bucket prediction; showed a blended `89% of today's gap`
- Calibration takeaway: the blended estimate was misleading because HIGH and PEAK were barely touched. This ride is the core evidence for showing per-bucket predictions and treating mostly flat routes with sprint opportunities as LOW-dominant unless the cue and terrain can genuinely produce meaningful HIGH/PEAK.

### 2026-04-16 - Flat Out Fast, Watopia

- Source note: `Zwift - Flat Out Fast in Watopia`
- Start time: 05:01 PM
- Distance: 13.8 mi
- Duration: 0h 47m
- Total XSS: 49
- XSS split: 48 LOW / 0.7 HIGH / 0.1 PEAK
- Intended workout: Zone 2 / LOW
- Actual execution: rode Z2; no sprints performed
- Calibration takeaway: clean flat-route Z2 baseline. The ride produced almost entirely LOW strain, with negligible HIGH and PEAK. Useful for validating LOW XSS/hour estimates and confirming that non-attacked flat routes should not advertise meaningful HIGH/PEAK support.

### 2026-04-16 - Wandering Flats, Makuri Islands

- Source note: `Zwift - Wandering Flats in Makuri Islands - Green Jersey, BABY!`
- Start time: 06:06 PM
- Distance: 15.8 mi
- Duration: 1h 4m
- Total XSS: 67
- XSS split: 62 LOW / 2.5 HIGH / 2.4 PEAK
- Intended workout: LOW effort only
- Actual execution: rode everything before and after the first two sprints as Zone 2; also did the first two sprints
- Calibration takeaway: even with two sprints, a mostly Z2 flat route was overwhelmingly LOW. This supports treating flat sprint routes as primarily LOW venues with small incidental HIGH/PEAK unless the cue calls for much more aggressive repeated efforts.

---

## Calibration Questions

- How much HIGH/PEAK should the app expect from flat sprints when the rider otherwise rides Z2?
- When does a flat sprint route deserve `LOW+HIGH` versus true mixed support?
- How aggressively should route cards separate today's prescribed execution from what the venue contains if attacked?
- Do current LOW/HIGH/PEAK XSS-per-hour assumptions overstate non-LOW contribution on flat routes?
