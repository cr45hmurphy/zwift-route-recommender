# Visual Polish — Design Spec
**Date:** 2026-04-19
**Branch:** `feature/visual-polish`
**Approach:** Single PR, all changes + mobile audit together

---

## Scope

Four items from Tier 1 parking lot. Dev panel polish explicitly out of scope this round.

---

## 1. Watopia Title Color

**File:** `public/assets/style.css:693`

**Change:** `#EE4000` → `#F5784A`

Current orange is too saturated and dark for readability. Lightened warm orange retains Watopia identity with better contrast.

---

## 2. Profile Smoothing Reduction

**File:** `scripts/build-zwift-data.mjs` — `smoothProfile()` function (~line 798)

**Changes:**
- Window multiplier: `0.024` → `0.016`
- Second pass factor: `0.82` → `0.70`

Current two-pass smoothing is aggressive enough to obscure terrain character. Reducing both passes makes contours more truthful while remaining readable. Requires `npm run build-routes` rebuild; generated data files committed alongside the script change.

---

## 3. Mobile Layout Audit

**File:** `public/assets/style.css` — mobile/responsive sections

Audit on a physical device after other changes land. Fix any layout issues found reactively — no predetermined list. Focus areas: route cards, inspector filters, header actions, time controls.

---

## 4. Parking Lot Update

Add dev panel UX improvement (footer link + access control) to Tier 3 of parking lot. Not implemented this round.

---

## Out of Scope

- Dev panel affordances (parked for follow-up)
- Any scoring, recommendation logic, or data changes
