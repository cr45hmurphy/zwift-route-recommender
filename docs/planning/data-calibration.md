# Data Calibration

Use this file for real-ride evidence that can tune route scoring, time estimates, bucket-fill math, and route-truth labels. Keep entries factual: route, context, intended execution, actual execution, and XSS split.

---

## Ride Datapoints

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
