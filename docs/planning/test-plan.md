# Test Plan — Zwift Route Recommender

## Purpose
Validate the current app across both live Xert data and the new in-app mock scenarios. This plan covers route ranking, optimizer behavior, recovery override behavior, manual pace controls, browser-local history, the Zwift CDN-generated route snapshot, and the scorer harnesses.

## Test Environment
- Terminal 1: `node proxy.js`
- Terminal 2: `npm run serve`
- Open the local app URL from `serve`
- Keep browser devtools open for console/network errors
- Use both:
  - `Live Xert` for end-to-end auth and API checks
  - mock scenarios in the new data-source switcher for deterministic optimizer checks

## Preflight
1. Load the app home page.
2. Confirm CSS and JS load with no blocking console errors.
3. Confirm the auth form renders and accepts input.
4. Confirm the auth-screen data-source selector is visible.
5. Confirm the selector contains:
   - `Live Xert`
   - `Mock: Recovery`
   - `Mock: Low Deficit`
   - `Mock: Mixed Deficits`
   - `Mock: Peak Focus`

Expected result:
- The app loads cleanly and exposes both live and mock data modes. pass

## Live Xert Regression

### Auth and fetch flow
1. Select `Live Xert`.
2. Sign in with a real Xert account.
3. Confirm the app transitions from auth to dashboard.
4. Confirm `training_info` and activity-summary requests succeed through the local proxy.
5. Click refresh and confirm data reloads without errors.

Expected result:
- Live auth and proxy-backed fetches still work. Pass

### Status and recommendation
1. Confirm freshness badge, FTP, weight, and W/kg render after login.
2. Confirm low/high/peak bars show completed, target, and remaining values.
3. Confirm the recommendation title/subtitle match the highlighted bucket.
4. If WOTD exists, confirm it renders with name and optional description.
5. If Xert status is tired, very tired, or detraining, confirm the override note appears and recommendations switch to recovery behavior.

Expected result:
- Live status rendering matches Xert data and recovery override still works. Pass

### Route list structure
1. Confirm the app still shows:
   - primary route grid
   - `Other options`
   - `If you had more time`
2. Confirm route cards still render:
   - world
   - score
   - distance/elevation/gradient
   - time badge
   - route reason
   - ride cue
   - segment chips when route-linked data exists
3. Confirm Strava-linked segment chips still open correctly when present.

Expected result:
- Existing route-card structure remains intact. Pass

### Zwift route snapshot integrity
1. Run `npm run build-routes`.
2. Confirm generated files update with no script errors:
   - `public/app/data/routes-data.js`
   - `public/app/data/segments-data.js`
   - `public/app/data/zwift-metadata.js`
3. Confirm generated metadata includes a Zwift version string and non-zero route/segment counts.
4. Confirm `Road to Sky` still includes `Alpe du Zwift` in route-linked segments.
5. Confirm at least one route card shows a lead-in badge or lap-route badge.

Expected result:
- Zwift CDN data generates cleanly and preserves route-linked segment context. Pass

### Filtering and settings
1. Toggle `Today's worlds only` on and off.
2. Confirm unavailable worlds disappear when enabled and reappear when disabled.
3. Confirm the worlds label reflects Zwift's published schedule when data is present.
4. If schedule data is intentionally removed or unavailable, confirm the manual guest-world picker reappears.
5. Switch between `km / m` and `mi / ft`.
6. Confirm distance, elevation, gradient, and speed labels convert correctly.
7. Switch between `Auto (W/kg)` and `Manual pace`.
8. Confirm timing hint text changes and no console errors appear.

Expected result:
- Core settings still work in live mode. Pass

## Mock Scenario Coverage

### Recovery scenario
1. Switch to `Mock: Recovery`.
2. Confirm the app opens without live sign-in.
3. Confirm the recommendation is recovery-oriented.
4. Confirm route reasons read as recovery-oriented.
5. Confirm short, flat routes dominate.

Expected result:
- Recovery mode bypasses multi-bucket logic and remains recovery-first. Pass

### Low deficit scenario
1. Switch to `Mock: Low Deficit`.
2. Confirm low remains the highlighted target bucket.
3. Set `Time available` to 30 minutes, then 90 minutes.
4. Confirm the top recommendations change materially, not just section placement.
5. Confirm routes near the selected time rise in rank over obviously too-long routes.

Expected result:
- The optimizer responds to time while still prioritizing low-bucket needs. 
30 mins:
Fresh
FTP 252 W
Weight 76.8 kg
W/kg 3.3
Low
8.0 / 42.0 34.0 left
High
1.0 / 10.0 9.0 left
Peak
0.0 / 4.0 4.0 left
Recent Progress
Last 3 days
low
0.0 / 26.7 · → 0.0
high
0.0 / 0.0 · → 0.0
peak
0.0 / 0.0 · → 0.0
Recent Progress is stored in this browser only. Mock scenarios do not write new history snapshots.
Your aerobic base needs work
You still have 34.0 low XSS left today — a long flat ride will help.
Workout of the Day: Steady Foundations — difficulty Moderate
Aerobic endurance focus with long controlled efforts.
Time available

60 min
Timing
Auto (W/kg)
Manual pace
3.3 W/kg profile · ~20 mph flat pace
Using your 3.3 W/kg profile, 60 min should generate roughly 65 XSS — about 100% of your 34 remaining low target.
Recommended Routes
Watopia · London
Watopia
72
Waisted 8
19.1 mi
472 ft
24.8 ft/mi
~59m
~100% of low left
64 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Jarvis KOM Rev.
Jarvis Sprint Rev.
Best blend of low support and time fit.
ZwiftInsider
What's on Zwift
Watopia
69
Big Flat 8
18.2 mi
338 ft
18.5 ft/mi
~56m
~100% of low left
61 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Fuego Flats
Best blend of low support and time fit.
ZwiftInsider
What's on Zwift
Watopia
68
Watopia Figure 8
18.5 mi
833 ft
45.4 ft/mi
~1h
~100% of low left
65 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Zwift KOM Rev.
Zwift KOM
Watopia Sprint
Watopia Sprint Rev.
Best blend of low + high support and time fit.
ZwiftInsider
What's on Zwift
Watopia
68
Watopia Figure 8 Reverse
18.5 mi
833 ft
45.4 ft/mi
~1h
~100% of low left
65 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Zwift KOM Rev.
Zwift KOM
Watopia Sprint
Watopia Sprint Rev.
Best blend of low + high support and time fit.
ZwiftInsider
What's on Zwift
Watopia
67
Road to Ruins
18.4 mi
902 ft
49.1 ft/mi
~1h
~100% of low left
65 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Best blend of low + high support and time fit.
ZwiftInsider
What's on Zwift

90 mins:
Time available

90 min
Timing
Auto (W/kg)
Manual pace
3.3 W/kg profile · ~20 mph flat pace
Using your 3.3 W/kg profile, 90 min should generate roughly 98 XSS — about 100% of your 34 remaining low target.
Recommended Routes
Watopia · London
Watopia
78
Out And Back Again
24.8 mi
1076 ft
43.3 ft/mi
~1h 20m
~100% of low left
87 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Volcano KOM
Zwift KOM Rev.
Fuego Flats
Watopia Sprint
Best blend of low + high support and time fit.
ZwiftInsider
What's on Zwift
Watopia
77
Watts of the Wild
26.1 mi
1014 ft
39.1 ft/mi
~1h 24m
~100% of low left
91 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Titans Grove KOM
Jarvis KOM
Fuego Flats
Jarvis Sprint
Watopia Sprint Rev.
Best blend of low + high support and time fit.
ZwiftInsider
What's on Zwift
London
70
Triple Loops
25.4 mi
1854 ft
72.9 ft/mi
~1h 28m
~100% of low left
95 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Leith Hill
London Sprint Rev.
Best blend of low + high support and time fit.
ZwiftInsider
What's on Zwift
Watopia
68
Three Little Sisters
23.4 mi
1427 ft
60.7 ft/mi
~1h 19m
~100% of low left
86 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Volcano KOM
Titans Grove KOM
Zwift KOM
Strong low + high match that fits comfortably inside your time budget.
ZwiftInsider
Watopia
66
Triple Flat Loops
21.1 mi
515 ft
24.3 ft/mi
~1h 6m
~100% of low left
72 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Fuego Flats
Watopia Sprint
Watopia Sprint Rev.
Strong low match that fits comfortably inside your time budget.
ZwiftInsider

### Mixed deficits scenario
1. Switch to `Mock: Mixed Deficits`.
2. Confirm at least two buckets show meaningful remaining value.
3. Review the top-card route reasons.
4. Confirm the top results look like balanced compromises rather than extreme specialists.
5. Confirm explanation text references both bucket support and time fit.

Expected result:
- Mixed-deficit behavior is easy to validate without relying on live Xert state.

30 mins:
Fresh
FTP 266 W
Weight 72.3 kg
W/kg 3.7
Low
12.0 / 32.0 20.0 left
High
8.0 / 28.0 20.0 left
Peak
3.0 / 12.0 9.0 left
Recent Progress
Last 3 days
low
0.0 / 26.7 · → 0.0
high
0.0 / 0.0 · → 0.0
peak
0.0 / 0.0 · → 0.0
Recent Progress is stored in this browser only. Mock scenarios do not write new history snapshots.
Your aerobic base needs work
You still have 20.0 low XSS left today — a long flat ride will help.
Workout of the Day: Rolling Pressure — difficulty Hard
Repeated threshold surges with recoveries between efforts.
Time available

30 min
Timing
Auto (W/kg)
Manual pace
3.7 W/kg profile · ~21 mph flat pace
Using your 3.7 W/kg profile, 30 min should generate roughly 33 XSS — about 100% of your 20 remaining low target.
Recommended Routes
Watopia · London
Watopia
44
Tempus Fugit
10.7 mi
85 ft
7.9 ft/mi
~30m
~100% of low left
33 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Fuego Flats
Best blend of low + high support and time fit.
ZwiftInsider
What's on Zwift
Watopia
42
Coastal Crown Loop
9.4 mi
607 ft
64.9 ft/mi
~30m
~100% of low left
33 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Itza KOM
Mayan Mountainside KOM
Acropolis Sprint Rev.
Stoneway Sprint Rev.
Best blend of high + low support and time fit.
ZwiftInsider
What's on Zwift
Watopia
42
Tick Tock
10.5 mi
174 ft
16.4 ft/mi
~30m
~100% of low left
33 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Fuego Flats
Best blend of low + high support and time fit.
ZwiftInsider
What's on Zwift
Watopia
41
Going Coastal
10.2 mi
207 ft
20.1 ft/mi
~30m
~100% of low left
33 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Woodland Sprint Rev.
Fuego Flats
Sasquatch Sprint Rev.
Best blend of low + high support and time fit.
ZwiftInsider
What's on Zwift
Watopia
39
Loopin Lava
8.8 mi
643 ft
72.9 ft/mi
~29m
~100% of low left
31 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Volcano KOM
Jarvis KOM
Jarvis Sprint
Best blend of high + low support and time fit.
ZwiftInsider
What's on Zwift

90 mins:

Time available

90 min
Timing
Auto (W/kg)
Manual pace
3.7 W/kg profile · ~21 mph flat pace
Using your 3.7 W/kg profile, 90 min should generate roughly 98 XSS — about 100% of your 20 remaining low target.
Recommended Routes
Watopia · London
London
73
Surrey Hills
24.3 mi
2877 ft
118.3 ft/mi
~1h 29m
~100% of low left
96 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Keith Hill
Fox Hill
Leith Hill
Best blend of high + low support and time fit.
ZwiftInsider
What's on Zwift
Watopia
73
Itza Party
28.4 mi
1660 ft
58.6 ft/mi
~1h 30m
~100% of low left
98 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Itza KOM
Mayan Mountainside KOM
Zwift KOM
Woodland Sprint Rev.
Acropolis Sprint Rev.
Stoneway Sprint Rev.
Sasquatch Sprint Rev.
Best blend of high + low support and time fit.
ZwiftInsider
What's on Zwift
Watopia
71
Snowman
27.4 mi
1896 ft
69.2 ft/mi
~1h 29m
~100% of low left
96 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Itza KOM
Mayan Mountainside KOM
Watopia Sprint Rev.
Best blend of high + low support and time fit.
ZwiftInsider
What's on Zwift
Watopia
70
Big Loop
26.5 mi
2172 ft
81.8 ft/mi
~1h 28m
~100% of low left
95 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Epic KOM
Best blend of high + low support and time fit.
ZwiftInsider
What's on Zwift
Watopia
69
Out And Back Again
24.8 mi
1076 ft
43.3 ft/mi
~1h 16m
~100% of low left
82 XSS toward low
Best for low remaining
🎯
Keep it steady in Z2 the whole way. Resist the urge to push the climbs.
Segments on this route:
Volcano KOM
Zwift KOM Rev.
Fuego Flats
Watopia Sprint
Strong low + high match that fits comfortably inside your time budget.
ZwiftInsider
What's on Zwift

I'm not sure I understand what ~100% of low left means for any of these.

### Peak focus scenario
1. Switch to `Mock: Peak Focus`.
2. Confirm peak is the highlighted target bucket.
3. Confirm punchier routes rise above long sustained climbers.
4. Confirm peak-oriented route reasons and cues still read sensibly.

Expected result:
- The optimizer still preserves peak specificity.

30 mins:
Time available

30 min
Timing
Auto (W/kg)
Manual pace
4.1 W/kg profile · ~23 mph flat pace
Using your 4.1 W/kg profile, 30 min should generate roughly 25 XSS — about 100% of your 18 remaining peak target.
Recommended Routes
Watopia · London
Watopia
51
Mountain Mash
3.6 mi
1099 ft
305.7 ft/mi
~23m
~100% of peak left
19 XSS toward peak
Best for peak remaining
🎯
Sprint every banner at max effort. Woodland Sprint and Woodland Sprint Rev. are your PEAK XSS targets today.
Best blend of peak support and time fit.
ZwiftInsider
What's on Zwift
Watopia
48
Oh Hill No
4.9 mi
1004 ft
204.9 ft/mi
~21m
~100% of peak left
18 XSS toward peak
Best for peak remaining
🎯
Treat every short rise or sprint banner like a match strike. Full gas, then fully recover.
Segments on this route:
The Grade KOM
Best blend of peak support and time fit.
ZwiftInsider
What's on Zwift
London
39
London Loop
9.2 mi
758 ft
81.8 ft/mi
~29m
~100% of peak left
24 XSS toward peak
Best for peak remaining
🎯
Treat every short rise or sprint banner like a match strike. Full gas, then fully recover.
Segments on this route:
Box Hill
Best blend of peak + high support and time fit.
ZwiftInsider
What's on Zwift
Watopia
38
Coastal Crown Loop
9.4 mi
607 ft
64.9 ft/mi
~28m
~100% of peak left
23 XSS toward peak
Best for peak remaining
🎯
Sprint every banner at max effort. Acropolis Sprint Rev. and Stoneway Sprint Rev. are your PEAK XSS targets today.
Segments on this route:
Itza KOM
Mayan Mountainside KOM
Acropolis Sprint Rev.
Stoneway Sprint Rev.
Best blend of peak + high support and time fit.
ZwiftInsider
What's on Zwift
Watopia
37
Loopin Lava
8.8 mi
643 ft
72.9 ft/mi
~27m
~100% of peak left
23 XSS toward peak
Best for peak remaining
🎯
Sprint every banner at max effort. Jarvis Sprint are your PEAK XSS targets today.
Segments on this route:
Volcano KOM
Jarvis KOM
Jarvis Sprint
Best blend of peak + high support and time fit.

90 mnis:

Fresh
FTP 281 W
Weight 69.1 kg
W/kg 4.1
Low
5.0 / 20.0 15.0 left
High
3.0 / 14.0 11.0 left
Peak
0.0 / 18.0 18.0 left
Recent Progress
Last 3 days
low
0.0 / 26.7 · → 0.0
high
0.0 / 0.0 · → 0.0
peak
0.0 / 0.0 · → 0.0
Recent Progress is stored in this browser only. Mock scenarios do not write new history snapshots.
Your peak power bucket needs work
You still have 18.0 peak XSS left today — a short punchy route will help.
Workout of the Day: Snap and Recover — difficulty Hard
Short maximal efforts with full recoveries.
Time available

90 min
Timing
Auto (W/kg)
Manual pace
4.1 W/kg profile · ~23 mph flat pace
Using your 4.1 W/kg profile, 90 min should generate roughly 75 XSS — about 100% of your 18 remaining peak target.
Recommended Routes
Watopia · London
Watopia
47
Out And Back Again
24.8 mi
1076 ft
43.3 ft/mi
~1h 12m
~100% of peak left
60 XSS toward peak
Best for peak remaining
🎯
Sprint every banner at max effort. Fuego Flats and Watopia Sprint are your PEAK XSS targets today.
Segments on this route:
Volcano KOM
Zwift KOM Rev.
Fuego Flats
Watopia Sprint
Strong low + high match that fits comfortably inside your time budget.
ZwiftInsider
What's on Zwift
Watopia
45
The Big Ring
30.4 mi
879 ft
29.0 ft/mi
~1h 26m
~100% of peak left
72 XSS toward peak
Best for peak remaining
🎯
Sprint every banner at max effort. Woodland Sprint Rev. and Fuego Flats are your PEAK XSS targets today.
Segments on this route:
Woodland Sprint Rev.
Fuego Flats
Acropolis Sprint Rev.
Stoneway Sprint Rev.
Sasquatch Sprint Rev.
Best blend of low + high support and time fit.
ZwiftInsider
What's on Zwift
Watopia
45
Deca Dash
30.0 mi
1588 ft
52.8 ft/mi
~1h 29m
~100% of peak left
74 XSS toward peak
Best for peak remaining
🎯
Sprint every banner at max effort. Jarvis Sprint Rev. are your PEAK XSS targets today.
Segments on this route:
Jarvis KOM Rev.
Jarvis Sprint Rev.
Best blend of low + high support and time fit.
ZwiftInsider
What's on Zwift
Watopia
44
Peak Performance
28.5 mi
2382 ft
83.4 ft/mi
~1h 30m
~100% of peak left
75 XSS toward peak
Best for peak remaining
🎯
Sprint every banner at max effort. Woodland Sprint Rev. and Sasquatch Sprint Rev. are your PEAK XSS targets today.
Segments on this route:
The Grade KOM
Titans Grove KOM Rev.
Woodland Sprint Rev.
Sasquatch Sprint Rev.
Best blend of high + low support and time fit.
ZwiftInsider
What's on Zwift
London
43
Surrey Hills
24.3 mi
2877 ft
118.3 ft/mi
~1h 24m
~100% of peak left
70 XSS toward peak
Best for peak remaining
🎯
Treat every short rise or sprint banner like a match strike. Full gas, then fully recover.
Segments on this route:
Keith Hill
Fox Hill
Leith Hill
Best blend of high + low support and time fit.
ZwiftInsider
What's on Zwift

The XSS left really needs to show the XSS as whatever color represents that bucket is needing the fill (low = green, high = blue, peak = red).

## Time and Manual Pace Validation

### Time-fit behavior
1. In `Mock: Recovery` or `Mock: Low Deficit`, set `Time available` to 30 minutes.
2. Note the top 3 routes.
3. Increase time to 90 minutes.
4. Confirm the top recommendations change materially instead of only moving between sections.
5. Confirm slightly over-budget routes remain visible in `If you had more time`.

Expected result:
- Ranking responds to time.
- Long routes do not dominate purely because they score well for one dimension.

### Manual pace reranking
1. Leave time at 60 minutes.
2. Switch to `Manual pace`.
3. Set a slower pace and confirm route ordering changes as estimated times increase.
4. Set a faster pace and confirm some longer routes become more competitive.
5. Compare nearby speeds such as `29`, `30`, and `33 mph` in imperial mode.

Expected result:
- Rankings should change when manual pace changes.
- Tiny speed changes should no longer cause obviously noisy near-tie flips.

### Manual speed bounds
1. Switch to imperial units.
2. Use the arrow controls on the manual speed input.
3. Confirm the control can go below the old `15 mph` floor.
4. Switch back to metric.
5. Confirm bounds convert back correctly and the displayed value remains sensible.

Floor is now 9mph

Expected result:
- Manual speed bounds match the active unit system.
- Arrow buttons and typed values behave consistently.

## History and Data Source Behavior
1. In live mode, refresh the app and confirm history still behaves normally.
2. Confirm the UI note says history is browser-local.
3. Switch to a mock scenario.
4. Confirm the UI note says mock scenarios do not write new history snapshots.
5. Switch between several mock scenarios and confirm the existing history trend is not replaced by mock data.

Expected result: Pass
- History remains browser-local by design.
- Mock testing does not pollute real local history snapshots.

## Harness Checks

### `scorer-test.html`
1. Open `scorer-test.html`.
2. Confirm heuristic checks still pass.
3. Confirm the new stability check passes.
4. Review the optimizer tables:
   - low-heavy day, 30 min target
   - mixed deficits, 60 min target
   - peak-focused day, 40 min target
5. Confirm the top-ranked routes and explanations look sensible for each scenario.

Expected result:
- The harness still validates fixed scoring logic and now also validates deterministic tie handling.

### `xert-test.html`
1. In live mode, confirm auth succeeds.
2. Confirm raw `training_info` loads.
3. Confirm daily activity summary values load for today.
4. Compare rough low/high/peak totals against the main app.

Expected result:
- Xert integration data still matches what the main app shows.

## Acceptance Criteria
- Zwift CDN route data generates successfully into the tracked browser snapshot files.
- `Today's worlds only` prefers the generated Zwift world schedule and falls back safely if schedule data is unavailable.
- Route-linked segment chips come from authoritative route membership instead of generic world fallback when that data exists.
- Live Xert auth, refresh, and route rendering still work.
- Mock scenarios cover recovery, low-deficit, mixed-deficit, and peak-focused behavior without requiring live training-state luck.
- Ranking changes when time budget changes.
- Ranking changes when timing mode or manual pace changes.
- Recovery override still wins over optimizer logic.
- Manual speed bounds behave correctly in both metric and imperial units.
- Existing route-card content and route sections remain intact.
- History remains browser-local and mock mode does not write new snapshots.
- No new console errors appear in login, refresh, mock switching, or reranking flows.

## Notes
- `scorer-test.html` uses a curated fixture set, not the full Zwift route catalog. That is expected.
- The optimizer is heuristic, so acceptance is based on recommendation quality and consistency, not exact numeric scores.
- When validating “better” recommendations, compare both ranking order and explanation text.
