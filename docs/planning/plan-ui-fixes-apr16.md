# Plan: UI Fixes + QA Pass — April 16 2026

## Items

### Items 1–3: Manual QA (no code changes expected)

Run after code changes land. Use `Mock: Low Deficit` or `Mock: Peak Focus`.

**1. Time estimates**
- Flat Out Fast: ~45 min at rider W/kg (formula confirmed correct at 3.0 W/kg)
- Alpe du Zwift / Road to Sky: should estimate long
- No changes unless readings are off

**2. Route honesty labels**
- Tempus Fugit → `LOW+HIGH route` (flat sprint, PEAK ~0)
- Volcano Circuit → PEAK ~0/18 is a **known data gap** (Sauce4Zwift yields only a lap marker with zero elevation; not a bug). Will not show `TRUE mixed` — correct behavior.

**3. scorer-test.html**
- Open `/tests/scorer-test.html` — all heuristic checks green
- PEAK rankings: Volcano Climb / Cobbled Climbs style at top

---

### Item 4: World title colors

**File:** `public/assets/style.css` lines 693–705

```css
.route-world[data-world="watopia"]          { color: #EE4000; }
.route-world[data-world="richmond"]         { color: #000000; }
.route-world[data-world="london"]           { color: #62C0EB; }
.route-world[data-world="new-york"]         { color: #D92592; }
.route-world[data-world="innsbruck"]        { color: #68C446; }
.route-world[data-world="bologna"]          { color: #5BA2FF; }
.route-world[data-world="yorkshire"]        { color: #E9C500; }
.route-world[data-world="crit-city"]        { color: #9CEF8C; }
.route-world[data-world="makuri-islands"]   { color: #268100; }
.route-world[data-world="france"]           { color: #3700FF; }
.route-world[data-world="paris"]            { color: #B4D8E7; }
.route-world[data-world="gravel-mountain"]  { color: #A05602; }
.route-world[data-world="scotland"]         { color: #160082; }
```

Note: Richmond `#000000` is black — check contrast on dark backgrounds. Add `text-shadow` or lighten if unreadable.

---

### Item 5: World schedule — source label + missing 3rd world

Two sub-issues:

#### 5a. Source label display (formatting)
`updateGuestWorldsLabel()` in `public/app/app.js` line 2058:
```javascript
// Current: "Watopia · Makuri Islands · ZwiftInsider" — looks like 3 worlds
`${worlds} · ${context.source}`

// Fix: clearly separates source attribution
`${worlds} (via ${context.source})`
```

#### 5b. Missing 3rd world (New York)
`getPreferredWorldContext()` in `public/app/core/routes.js` ~line 182.

The ZI proxy returned only 1 guest world (Makuri Islands). The condition `if (context?.guestWorlds?.length)` accepted incomplete data. New York was not included.

**Fix:** after getting a live context with < 2 guest worlds, supplement from built-in schedule:

```javascript
if (context?.guestWorlds?.length) {
  if (context.guestWorlds.length < 2) {
    const scheduleCtx = getWorldScheduleContext(guestWorldsFallback, now);
    for (const w of scheduleCtx.guestWorlds) {
      if (!context.guestWorlds.includes(w)) {
        context.guestWorlds.push(w);
        context.worlds.add(w);
      }
      if (context.guestWorlds.length >= 2) break;
    }
  }
  saveCachedLiveWorldContext(context);
  return context;
}
```

---

### Item 6: Toggle count mismatch

**Root cause:** Both toggle click handlers use `list.children.length` which counts world-group divs (direct children), not route cards. `groupedByWorldHTML()` wraps routes in one `.world-group` div per world — so 40 routes across 2 worlds → `children.length = 2`.

**File:** `public/app/app.js` lines 2453 and 2461

```javascript
// Both handlers: replace
const count = list.children.length;
// with
const count = list.querySelectorAll('.route-card').length;
```

---

## Files to modify

| File | Lines | Change |
|------|-------|--------|
| `public/assets/style.css` | 693–705 | World color values |
| `public/app/app.js` | 2058 | Source label format in `updateGuestWorldsLabel` |
| `public/app/app.js` | 2453, 2461 | `children.length` → `querySelectorAll('.route-card').length` |
| `public/app/core/routes.js` | ~182 | Supplement live worlds from schedule when < 2 guest worlds |

---

## Verification

1. **Colors:** World badges in grouped sections show correct colors; Richmond (black) is readable
2. **World label:** Shows "Watopia · Makuri Islands · New York (via ZwiftInsider)" — 3 worlds, source in parens
3. **Count:** Open "If you had more time" and "Other options" — count matches route cards, not world groups
4. **QA:** scorer-test.html all green; Tempus Fugit = LOW+HIGH; Volcano Circuit = PEAK ~0 (expected)
5. **No regressions:** Mock switching + time slider + unit toggle = no console errors
