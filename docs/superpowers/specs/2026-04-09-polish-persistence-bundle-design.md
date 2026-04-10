# Polish & Persistence Bundle — Design Spec
*2026-04-09*

## Context
Three independent quality-of-life features selected from the parking lot. Ships as one PR.
No new dependencies. All state is localStorage-backed.

---

## Feature 1: Favorites Score Boost

Starred routes receive a small utility multiplier in `optimizeRoutes()`.
The boost is self-limiting: at 8%, a route at utility 0.50 → 0.54 (won't beat a 0.75);
a route at 0.80 → 0.86 (competitive within the same tier).

**Constant:** `FAVORITE_BOOST = 0.08` in `scorer.js`
**Integration:** `optimizeRoutes()` accepts `options.favorites` (a `Set` of route keys).
Applied after the sprint_power adjustment block, before the route object is returned.
**App wiring:** `recomputeRankedRoutes()` passes `favorites: loadFavorites()`.

---

## Feature 2: Save Today's Plan

**Auto-save trigger:** After `recomputeRankedRoutes()` in `refresh()`, live mode only.
**Storage key:** `xert_plan_history` — JSON array, max 30 records (oldest dropped).
**Record shape:**
```json
{
  "date": "2026-04-09",
  "bucket": "high",
  "wotdClassification": "sustained_climb",
  "savedAt": "07:14",
  "routes": [
    { "slug": "road-to-sky", "name": "Road to Sky", "world": "watopia",
      "distance": 15.8, "elevation": 1169, "rideCue": "..." }
  ]
}
```
**Reopen UX:** `init()` checks for today's record before API fetch.
If found: render `#today-plan` section with condensed top-5, header "Today's plan · saved at HH:MM",
and a "↺ Refresh for today's recommendations" button.
Plan section hidden on Refresh; normal `refresh()` runs.

---

## Feature 3: Mock Scenario Expansion

Three new entries in `MOCK_SCENARIOS` and `DATA_SOURCE_OPTIONS`:
- `missing-signature` — null FTP/weight, validates auto-timing fallback
- `empty-history` — zero completed rides, validates zero-state rendering
- `tired-deficit` — Very Tired + nonzero deficits, validates freshness override

**Query-param support:** `?mock=<id>` in URL sets and persists the scenario via
`localStorage.setItem(DATA_SOURCE_KEY, mockParam)` at top of `init()`.
Unknown `?mock` values are silently ignored (app falls back to live mode).
