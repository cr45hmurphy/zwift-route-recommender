# Implementation Record: Three Scoring & Filter Features

All three items below have been implemented and verified locally in the browser. This file is now an archive of what shipped rather than an active plan.

---

## Completed: RECOVERY Scoring Fix

**Why:** `scoreRoute` currently uses identical logic for `'recovery'` and `'low'`, surfacing long flat routes. Recovery should surface short, easy spins (≤30 km, ≤200 m elevation).

**File: `scorer.js`**

1. Add two constants after `PUNCH_ELEVATION_CAP`:
   ```js
   const RECOVERY_DISTANCE_MAX  = 30;  // km — routes above this score near 0 in RECOVERY
   const RECOVERY_ELEVATION_MAX = 200; // m  — routes above this score near 0 in RECOVERY
   ```

2. In `scoreRoute`, the current condition is:
   ```js
   if (bucket === 'low' || bucket === 'recovery') {
   ```
   Split into two separate blocks. The `'low'` block is unchanged. Replace with:
   ```js
   if (bucket === 'low') {
     const distanceScore = Math.min(distance / FLAT_DISTANCE_TARGET, 1) * 60;
     const flatnessScore = Math.max(0, 1 - gradientRatio / FLAT_GRADIENT_MAX) * 40;
     return Math.round(distanceScore + flatnessScore);
   }

   if (bucket === 'recovery') {
     const distancePenalty  = Math.max(0, 1 - Math.max(0, distance  - RECOVERY_DISTANCE_MAX)  / RECOVERY_DISTANCE_MAX);
     const elevationPenalty = Math.max(0, 1 - Math.max(0, elevation - RECOVERY_ELEVATION_MAX) / RECOVERY_ELEVATION_MAX);
     const flatnessScore    = Math.max(0, 1 - gradientRatio / FLAT_GRADIENT_MAX) * 100;
     return Math.round(flatnessScore * distancePenalty * elevationPenalty);
   }
   ```

Shipped in `scorer.js`.

---

## Completed: Freshness-Aware Scoring

**Why:** `d.status` from Xert ("Tired", "Very Tired") is displayed but ignored by scoring. Tired riders should be pushed toward recovery routes regardless of bucket deficits.

### `app.js`

1. Add `bucketOverride: null` to the `state` object.

2. Add this function near `freshnessClass` (which is the existing status→CSS mapper):
   ```js
   function applyFreshnessOverride(bucket, status) {
     const s = (status ?? '').toLowerCase();
     if (s.includes('very tired') || s.includes('detrain')) {
       return { bucket: 'recovery', overrideNote: `Your Xert status is "${status}" — overriding to Recovery. Rest up.` };
     }
     if (s.includes('tired') && bucket !== 'recovery') {
       return { bucket: 'recovery', overrideNote: `Your Xert status is "${status}" — biasing toward easier routes today.` };
     }
     return { bucket, overrideNote: null };
   }
   ```

3. In `refresh()`, find the two lines:
   ```js
   state.bucket = detectBucket(state.trainingData.tl, state.trainingData.targetXSS);
   state.ranked = rankRoutes(routes, state.bucket);
   ```
   Replace with:
   ```js
   const rawBucket = detectBucket(state.trainingData.tl, state.trainingData.targetXSS);
   const { bucket, overrideNote } = applyFreshnessOverride(rawBucket, state.trainingData.status);
   state.bucket         = bucket;
   state.bucketOverride = overrideNote;
   state.ranked = rankRoutes(routes, state.bucket);
   ```

4. At the end of `renderRecommendation()`, after the wotd block, add:
   ```js
   const overrideEl = document.getElementById('override-note');
   if (state.bucketOverride) {
     overrideEl.textContent = state.bucketOverride;
     overrideEl.style.display = 'block';
   } else {
     overrideEl.style.display = 'none';
   }
   ```

### `index.html`

Inside `<section id="recommendation">`, add this div immediately after `<div class="rec-subtitle" id="rec-subtitle">`:
```html
<div id="override-note" class="override-note" style="display:none"></div>
```

### `style.css`

Add after the `.wotd` rule block:
```css
.override-note {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--yellow);
  background: var(--yellow-dim);
  border: 1px solid var(--yellow);
  padding: 8px 12px;
  margin-top: 8px;
}
```

`--yellow` and `--yellow-dim` already exist in `:root` (same vars used by `.freshness-badge.tired`).

---

## Completed: Today's Worlds Filter

**Why:** The app recommends routes from all 12 worlds, but Zwift only makes one guest world available per day (plus Watopia which is always open). Recommending an unreachable world is a core UX problem.

### `routes.js`

Add after the `WORLD_NAMES` constant:
```js
// Zwift's fixed weekly guest world rotation. 0 = Sunday … 6 = Saturday.
// Watopia is always available. Richmond, Bologna, Scotland, Crit City are event-only.
export const GUEST_WORLD_SCHEDULE = {
  0: 'paris',
  1: 'london',
  2: 'makuri-islands',
  3: 'france',
  4: 'new-york',
  5: 'innsbruck',
  6: 'yorkshire',
};

export function todaysWorlds() {
  const available = new Set(['watopia']);
  const guest = GUEST_WORLD_SCHEDULE[new Date().getDay()];
  if (guest) available.add(guest);
  return available;
}

export function filterToAvailableWorlds(routes) {
  const available = todaysWorlds();
  return routes.filter(r => available.has(r.world));
}
```

### `app.js`

1. Extend the import from `routes.js` to include `filterToAvailableWorlds` and `todaysWorlds`.

2. Add a helper after the existing `getUnits()` function:
   ```js
   function getTodayOnly() {
     return localStorage.getItem('today-only') !== 'false'; // default true
   }
   ```

3. Add `todayOnly: true` to the `state` object.

4. In `init()`, after restoring units, add:
   ```js
   state.todayOnly = getTodayOnly();
   document.getElementById('today-only-toggle').checked = state.todayOnly;
   const worlds = [...todaysWorlds()].map(worldName).join(' · ');
   document.getElementById('today-worlds-label').textContent = worlds;
   ```

5. In `refresh()`, the line from Feature 3 is:
   ```js
   state.ranked = rankRoutes(routes, state.bucket);
   ```
   Replace `routes` with a conditional:
   ```js
   const eligibleRoutes = state.todayOnly ? filterToAvailableWorlds(routes) : routes;
   state.ranked = rankRoutes(eligibleRoutes, state.bucket);
   ```

6. Add a change handler in the event-wiring section:
   ```js
   document.getElementById('today-only-toggle').addEventListener('change', (e) => {
     state.todayOnly = e.target.checked;
     localStorage.setItem('today-only', state.todayOnly);
     if (state.trainingData) {
       const eligibleRoutes = state.todayOnly ? filterToAvailableWorlds(routes) : routes;
       state.ranked = rankRoutes(eligibleRoutes, state.bucket);
       renderRoutes();
     }
   });
   ```

### `index.html`

Insert this div immediately before `<div class="route-grid">`:
```html
<div id="world-filter-row">
  <label class="world-filter-label">
    <input type="checkbox" id="today-only-toggle" checked>
    Today's worlds only
  </label>
  <span id="today-worlds-label" class="world-filter-hint"></span>
</div>
```

### `style.css`

Add after the `#routes-section h2` rule:
```css
#world-filter-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.world-filter-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
}

.world-filter-label input[type="checkbox"] {
  accent-color: var(--accent);
  cursor: pointer;
}

.world-filter-hint {
  font-size: 0.78rem;
  color: var(--text-muted);
}
```

---

## Notes

- `scorer.js` remains pure: no DOM, no API calls.
- `detectBucket` is unchanged; `applyFreshnessOverride` lives in `app.js`.
- The worlds filter is applied before `rankRoutes`, and the preference is persisted in `localStorage`.
- No new npm dependencies or frameworks were introduced.
