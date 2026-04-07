# Rapid QA Checklist — Zwift Route Recommender

Use this when you want a fast pass/fail sweep instead of the full test plan.

## Preflight
- [ ] App loads at local dev URL with no blocking console errors
- [ ] Auth screen renders correctly
- [ ] Data source selector is visible on auth screen
- [ ] Data source selector shows `Live Xert` plus 4 mock scenarios

## Live Xert
- [ ] `Live Xert` sign-in works
- [ ] Dashboard loads after sign-in
- [ ] Refresh works without errors
- [ ] Freshness badge, FTP, weight, and W/kg render
- [ ] Bucket bars show completed/target/remaining values
- [ ] Route cards render with score, stats, reason, cue, and links

## Recovery Override
- [ ] Tired / Very Tired / Detraining status forces recovery recommendations
- [ ] Recovery note appears when override is active
- [ ] Recovery routes look short and flat

## Mock Scenarios
- [ ] `Mock: Recovery` opens without live sign-in
- [ ] `Mock: Low Deficit` highlights low-focused recommendations
- [ ] `Mock: Mixed Deficits` shows balanced route reasoning
- [ ] `Mock: Peak Focus` surfaces punchier peak-style routes
- [ ] Switching between mock scenarios does not throw errors

## Time and Ranking
- [ ] Changing `Time available` changes ranking, not just sections
- [ ] Slightly over-budget routes still appear in `If you had more time`
- [ ] `Auto (W/kg)` and `Manual pace` both rerank routes
- [ ] Nearby manual speeds like `29`, `30`, and `33 mph` no longer cause obviously noisy flips

## Units and Manual Speed
- [ ] `km / m` and `mi / ft` conversion displays correctly
- [ ] Manual speed spinner works in metric mode
- [ ] Manual speed spinner works in imperial mode
- [ ] Imperial mode can go below the old `15 mph` floor
- [ ] Switching units keeps the manual speed value sensible

## Filtering and History
- [ ] `Today's worlds only` filters routes correctly
- [ ] History note says history is browser-local
- [ ] Mock mode note says mock scenarios do not save new history snapshots
- [ ] Switching mock scenarios does not overwrite live local history

## Harnesses
- [ ] `scorer-test.html` loads
- [ ] Heuristic checks pass in `scorer-test.html`
- [ ] Stability check passes in `scorer-test.html`
- [ ] `xert-test.html` still loads live Xert data correctly

## Final Gate
- [ ] No new console errors during login, refresh, mock switching, unit switching, or reranking
- [ ] Main route grid, `Other options`, and `If you had more time` all still work
