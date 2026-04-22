# Tier 2 Branch Plan: Scoring, Time Guidance & Cue Copy
## Session prompt for Claude Code

---

## Context & Constraints

This branch covers three tracks in `scorer.js`. All changes are confined to that file
unless explicitly noted. No UI changes, no new files, no restructuring of the call
graph.

**Data context:** Xert training data used for validation previously included lifting
workouts, which artificially suppressed HIGH and PEAK bucket deficits. Lifting is no
longer recorded in Xert. Clean signal starts from late April 2026 onward. This means:

- Static analysis and code inspection drove Track A fixes, not ride data
- Real calibration validation requires 2–3 weeks of clean Xert data post-merge
- Track A changes should be conservative — fix clear bugs, don't over-tune constants

---

## Track A: Scoring & Route Truth Fixes

### A1. `peakDistanceFactor` over-penalty in `deriveRouteBucketSupport()`

**Problem:** Current formula:
```js
const peakDistanceFactor = clamp(1 - (routeDistance / 60), 0.25, 1);
```
A 30km route loses 50% of its PEAK score before any segment data is considered.
A route with three punchy KOMs at 28km is still a valid PEAK day — the distance
penalty is too aggressive.

**Fix:** Soften the curve and raise the floor.
```js
const peakDistanceFactor = clamp(1 - (routeDistance / 90), 0.5, 1);
```
This means a 30km route retains ~67% of its PEAK score instead of 50%, and the
floor rises from 0.25 to 0.5 so no route is gutted purely by distance.

---

### A2. 3km PEAK dampener in `segmentSupport()`

**Problem:** Current code:
```js
if (distance >= 3 || elevationGain >= 140) {
  peak *= 0.12;
} else if (distance >= 2 || elevationGain >= 90) {
  peak *= 0.35;
}
```
Any segment over 3km gets 88% of its PEAK score stripped regardless of grade.
A 3.2km segment at 12% average grade is a genuinely hard punchy climb — 0.12
multiplier is wrong.

**Fix:** Gate on grade as well as distance. Only apply heavy dampening when the
segment is both long *and* not steep enough to be punchy.
```js
const avgGrade = segmentAverageGradePct(segment);
const isSteep = avgGrade !== null && avgGrade >= 8;

if (distance >= 3 || elevationGain >= 140) {
  peak *= isSteep ? 0.35 : 0.12;
} else if (distance >= 2 || elevationGain >= 90) {
  peak *= isSteep ? 0.65 : 0.35;
}
```

---

### A3. LOW-dominates-when-WOTD-says-otherwise in `detectBucket()`

**Problem:** On days with real HIGH or PEAK targets (e.g. Sugar Cookie: deficits were
LOW:33, HIGH:12.5, PEAK:7.6), `detectBucket()` fires LOW because 33 > 12.5. This is
technically correct by raw magnitude but ignores that Xert explicitly scheduled
HIGH/PEAK work that day.

The WOTD-first architecture principle says the workout of the day is the primary
signal. Raw deficit magnitude alone shouldn't override a day where Xert has assigned
non-trivial HIGH or PEAK targets.

**Fix:** When `targetXSS.high > 0` or `targetXSS.peak > 0`, apply a signal boost to
those buckets before comparing deficits. This reflects that Xert intentionally
scheduled structured work in those systems.

```js
export function detectBucket(tl, targetXSS) {
  const deficits = {
    low:  targetXSS.low  - tl.low,
    high: targetXSS.high - tl.high,
    peak: targetXSS.peak - tl.peak,
  };

  // When Xert has explicitly targeted HIGH or PEAK work today,
  // boost those deficits so they can compete with a larger LOW deficit.
  const WOTD_SIGNAL_BOOST = 1.6;
  if (targetXSS.high > 0) deficits.high *= WOTD_SIGNAL_BOOST;
  if (targetXSS.peak > 0) deficits.peak *= WOTD_SIGNAL_BOOST;

  const max = Math.max(deficits.low, deficits.high, deficits.peak);
  if (max <= 0) return 'recovery';
  return Object.keys(deficits).find(k => deficits[k] === max);
}
```

Export `WOTD_SIGNAL_BOOST` as a named constant at the top of the file alongside the
other tunable constants. Add it to `DEFAULTS`.

---

### A4. Route Truth — no-good-fit messaging

**Problem:** When no route scores well for the detected bucket, the app currently
surfaces its best guess silently with no indication it's a poor fit.

**Fix:** In `deriveRouteBucketSupport()`, expose a `fitQuality` field that downstream
UI can use to show a warning. This is a data change only — no UI work in this file.

```js
// Add to the return value of deriveRouteBucketSupport():
fitQuality: peak < 0.2 && high < 0.2 ? 'low' : peak < PEAK_SUPPORT_THRESHOLD ? 'partial' : 'good',
```

This gives the UI a hook without hard-coding any messaging in scorer.js.

---

### A6. Per-route terrain fit quality flag in `optimizeRoutes()`

**Problem:** When the detected bucket is PEAK and every route scores near-zero on PEAK
terrain, the app silently returns the least-bad option with no signal to the UI that
nothing is a real fit. Same gap exists for HIGH on flat-only route sets.

**Fix:** Add a `terrainFit` flag to each result in `optimizeRoutes()`, same pattern as
`noFit` in Track B. Pure data hook — scorer makes no UI decisions.

Thresholds are bucket-specific to avoid misfires on non-PEAK days:

```js
const TERRAIN_FIT_THRESHOLDS = {
  peak: { partial: PEAK_ROUTE_MIN_SUPPORT, good: PEAK_ROUTE_STRONG_SUPPORT },
  high: { partial: 0.25, good: 0.5 },
  low:  { partial: 0.4,  good: 0.65 },
};

// In the optimizeRoutes() map, add to the returned object:
const fitThresholds = TERRAIN_FIT_THRESHOLDS[bucket] ?? TERRAIN_FIT_THRESHOLDS.low;
const bucketContribution = contributions[bucket] ?? 0;
terrainFit: bucketContribution < fitThresholds.partial ? 'low'
          : bucketContribution < fitThresholds.good    ? 'partial'
          : 'good',
```

`TERRAIN_FIT_THRESHOLDS` is a named constant at the top of the file. Do not add it
to `DEFAULTS` — it is not a single scalar and the tuning UI does not need to expose it.

UI aggregation to show "no good terrain today" is trivial — check if all top results
have `terrainFit: 'low'`. scorer.js does not do that check.

---

### A5. Constants to leave alone this branch

The following constants are flagged for future tuning once 2–3 weeks of clean Xert
data is available. Do not change them now:

- `ACTIVE_BUCKET_WEIGHT` (0.65)
- `PUNCH_ELEVATION_CAP` (400)
- `PUNCH_GRADIENT_TARGET` (32)
- `PEAK_SUPPORT_THRESHOLD` (0.52)
- `HIGH_SUPPORT_TARGET` (1.6)

---

## Track B: Time Guidance Calibration

### B1. Time estimation is the primary filter — enforce it

**Problem:** Time fit is currently weighted at 0.18–0.45 depending on `wotdStructure`,
but it should be a hard pre-filter before scoring. A route that takes 3 hours when the
rider has 45 minutes should not appear in results at all, regardless of terrain score.

**Fix:** In `optimizeRoutes()`, add a hard exclusion before the scoring map:

```js
const eligible = routes.filter(r => {
  if (r.eventOnly) return false;
  if (!Array.isArray(r.sports) || !r.sports.includes('cycling')) return false;
  const est = estimateMinutes(r);
  if (Number.isFinite(est) && Number.isFinite(availableMinutes)) {
    // Exclude routes that are more than 60% over the available time
    if (est > availableMinutes * 1.6) return false;
  }
  return true;
});
```

The 1.6x threshold is a named constant `TIME_HARD_CUTOFF_RATIO = 1.6` at the top of
the file. Add to `DEFAULTS`.

---

### B2. `timeFitScore()` under-time penalty is too harsh

**Problem:** Current formula penalizes routes shorter than available time at 0.55x
rate, flooring at 0.5. A 45-minute route on a 60-minute day scores 0.86 on time fit —
reasonable. But a 30-minute route on a 60-minute day scores 0.72, which meaningfully
depresses otherwise good routes when the rider could simply do laps.

**Fix:** Reduce the under-time penalty rate and raise the floor, since shorter routes
are always completable with laps.

```js
if (diff < 0) {
  const underRatio = Math.abs(diff) / availableMinutes;
  return clamp(1 - underRatio * 0.3, 0.65, 1); // was 0.55 rate, 0.5 floor
}
```

---

### B3. `describeTimeFit()` thresholds are too tight

**Problem:** `near-time` fires only within 10 minutes. For longer rides (90+ min),
10 minutes is a rounding error — a 95-minute route on a 90-minute day should still
read as near-time, not over-time.

**Fix:** Make the threshold proportional to available time:

```js
function describeTimeFit(estimatedMinutes, availableMinutes) {
  if (!Number.isFinite(estimatedMinutes) || !Number.isFinite(availableMinutes)) return 'time-unknown';
  const diff = estimatedMinutes - availableMinutes;
  const threshold = Math.max(10, availableMinutes * 0.12);
  const absDiff = Math.abs(diff);

  if (absDiff <= threshold) return 'near-time';
  if (diff < 0) return 'under-time';
  return 'over-time';
}
```

---

### B4. No-fit state — surface it explicitly

**Problem:** When `availableMinutes` is very short (e.g. under 20 minutes) and no
route fits cleanly, `optimizeRoutes()` still returns results with no signal to the
caller that nothing is a real fit.

**Fix:** Add a `noFit` flag to each result when time fit score drops below a threshold:

```js
// In the optimizeRoutes() map, add to the returned object:
noFit: timeFit < 0.4,
```

UI can use this to show "no great options for your time today" without scorer.js
having to know anything about UI copy.

---

## Track C: Cue Copy Editorial Pass

### Voice & Tone Guidelines

Apply consistently across every branch:

- **Direct, not cute.** No metaphors that try too hard.
- **Honest, not apologetic.** When a route is a poor fit, say what it *can* do.
- **Specific when we have data, restrained when we don't.** Named segments → use
  them. World fallback → acknowledge once, then give actionable guidance anyway.
- **Consistent register.** Reads like one person wrote it.
- **No redundant recovery gaps sentence** when `spacingNote()` is already appended.

---

### C1. `sprint_power` — low PEAK support (`peakSupport < PEAK_ROUTE_MIN_SUPPORT`)

**Problem:** "This route can only fake a sprint day" is condescending. The hedging
reads like an apology rather than a workaround.

**Rewrite guidance:**
- Lead with what to do, not what's missing
- Acknowledge imperfection without dwelling on it
- Keep the actionable segment cue when available
- Drop "only fake"

---

### C2. `sprint_power` — medium PEAK support

**Problem:** Copy is nearly identical to the low support branch. A rider cannot tell
the difference between "barely qualifies" and "reasonable approximation."

**Rewrite guidance:**
- Noticeably more positive framing than low support branch
- Still honest that it's not a full PEAK day
- "Reasonable approximation" register, not "compromise" register

---

### C3. `sprint_power` — strong PEAK support

**Problem:** "Full gas, then fully recover because these are your best PEAK
opportunities on this route today" is wordy and repeats across sub-branches.

**Rewrite guidance:**
- Cut trailing justification clauses where the instruction is already clear
- `spacingNote()` handles spacing — don't repeat it in the lead sentence

---

### C4. `mixed_mode` — not true-mixed

**Problem:** "This is a LOW+HIGH venue, not a true mixed route" sounds like a system
message, not a riding instruction.

**Rewrite guidance:**
- Lead with the riding instruction
- Mention PEAK limitation once, briefly, at the end if at all
- Should feel like advice, not a disclaimer

---

### C5. `mixed_mode` — true-mixed, climb-only fallback

**Problem:** "This is mostly a climb route" is weak and inconsistent with the rest of
the branch.

**Rewrite guidance:**
- Replace with a proper riding instruction
- Timeline effort ordering copy is good — keep it
- `spacingNote()` is appended separately — don't pre-empt it

---

### C6. `aerobic_endurance` / null fallback — add named climbs branch

**Problem:** Only three thin branches for the most common bucket. Climb-heavy routes
with named segments get the same generic copy as unknown-terrain routes.

**Fix:** Add a fourth branch:

```js
if (gradientRatio > 15 && namedClimbs.length) {
  return `Ride ${formatSegmentList(namedClimbs.slice(0, 2))} in Z2 and resist the urge to push them. Today is aerobic volume, not threshold work.`;
}
```

Insert this before the existing `gradientRatio > 15 && climbs.length` branch.

---

### C7. `recovery` branch — add sprint banner variant

**Problem:** Single line, no acknowledgment of sprint banners. A rider on a route
with sprint banners needs to know to ignore them.

**Fix:** Two variants based on whether sprint segments are present:

```js
if (bucket === 'recovery') {
  const hasSprints = timelineSprints.length > 0 || namedSprints.length > 0;
  if (hasSprints) {
    return 'Easy spin only. Roll through any sprint banners without accelerating — no efforts today.';
  }
  return 'Easy spin only. Keep it light and let your legs recover.';
}
```

---

### C8. `spacingNote()` — editorial pass

**Rewrite guidance for each variant:**

- No short gaps: current "Recovery gaps are workable between efforts" is fine, leave it
- One short gap: `'One gap is tight, so the effort after it will be a bit compromised.'`
- Multiple short gaps: `'Several gaps are tight — later efforts will be progressively more compromised.'`

---

### What Not to Change in Track C

- Do not restructure the branching logic
- Do not change `summarizeOccurrenceList()` or `formatSegmentList()`
- Do not add new branches beyond C6 and C7 above
- Do not change any constants or thresholds

---

## Deliverables

All three tracks produce changes to `public/app/core/scorer.js` only.

After merging, the following require live validation before a tuning pass:
- `WOTD_SIGNAL_BOOST` value (A3) — validate against real rides with HIGH/PEAK targets
- `peakDistanceFactor` floor and curve (A1) — validate against punchy routes
- `TIME_HARD_CUTOFF_RATIO` (B1) — validate that hard exclusion doesn't drop
  legitimately close routes
- All Track A constants flagged in A5

Plan a follow-up tuning session after 2–3 weeks of clean Xert data.
