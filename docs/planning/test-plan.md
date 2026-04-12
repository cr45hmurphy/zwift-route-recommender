# Test Plan — Time Guidance Round

## Purpose
Validate only the latest time-guidance changes:

- `Use recommended time`
- time summary honesty
- `If you had more time` ordering

This round is not for re-testing the full cue-generator closeout.

## Setup
- Run `npx netlify dev`
- Open the local app
- Keep devtools open for console errors

## 1. Recommended Time

Use a scenario where theoretical bucket time is shorter than the first viable route.

Example shape:
- low bucket still needs work
- bucket math suggests about `0:30`
- no route can honestly fit in `0:30`

Confirm:
- `Use recommended time` does not stay at the theoretical `0:30`
- it jumps to the first viable route time instead
- clicking `Use recommended time` repeatedly keeps the same value
- moving the slider somewhere else first does not change the recommended answer for the same scenario

Expected:
- recommended time is stable and route-feasible

## 2. Time Summary

In the same scenario, confirm the summary text tells the truth about the mismatch.

Confirm:
- the summary can still mention the bucket/XSS math
- if bucket math is shorter than route feasibility, the summary explains that the first honest route fit is later
- the summary does not imply a real route exists at the shorter theoretical time

Expected:
- summary text distinguishes theoretical bucket time from actual route feasibility

## 3. No-Fit Behavior

Use a scenario where nothing honestly fits inside the current time budget.

Confirm:
- the main route grid shows the no-fit message
- the no-fit message points to the first honest route fit when one exists later
- if no viable route exists at all in range, the message stays honest about that too

Expected:
- the app does not pretend a route fits when none does

## 4. If You Had More Time

Use a scenario where no route fits the current budget but several routes fit if you go longer.

Confirm:
- `If you had more time` contains viable over-budget routes only
- the first route shown is the one closest over budget
- following routes increase in overrun time
- score/utility only breaks ties between routes with similar overrun

Expected:
- over-budget routes are ordered by nearest viable option first

## Acceptance
- recommended-time button is stable
- recommended time reflects first viable route time, not just bucket math
- time summary explains bucket-math vs route-feasibility mismatch
- no-fit state is honest
- `If you had more time` is sorted by nearest over-budget route first
