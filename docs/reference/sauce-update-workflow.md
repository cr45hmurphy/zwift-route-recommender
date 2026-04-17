# Sauce Data Update Workflow

This repo does not depend on the Sauce repo at runtime.

Instead, we use Sauce for Zwift's published release bundle as a build-time source for route manifests and route-position data. The build script extracts the files we need, normalizes them, and writes generated app data into `public/app/data/`.

## Current implementation

- Build entry point: `scripts/build-zwift-data.mjs`
- Sauce pin: `SAUCE_RELEASE_VERSION` inside that file
- Generated outputs:
  - `public/app/data/routes-data.js`
  - `public/app/data/segments-data.js`
  - `public/app/data/route-timelines-data.js`
  - `public/app/data/zwift-metadata.js`

## What Sauce is used for

We currently use Sauce-derived data for:

- route manifests / road sequence
- route-position timelines
- world and segment metadata needed to place effort opportunities on routes

We do not currently use Sauce as:

- a runtime dependency
- a UI dependency
- an authenticated API client

## Relationship to `zwift-utils` and `docs/reference/zwift.mjs`

- `zwift-utils` was part of the investigation trail. It appears to be an upstream data bundle Sauce uses, but this repo does not depend on it directly.
- `docs/reference/zwift.mjs` is a reference copy from Sauce that documents Zwift's authenticated `/api/game_info` path. It is useful as a fallback/reference, but the current app does not call that API.

## How to update Sauce-derived data

When the Sauce developer ships a new release with route/data updates:

1. Update `SAUCE_RELEASE_VERSION` in `scripts/build-zwift-data.mjs`
2. Run:

```bash
npm run build-routes
```

3. Review generated changes in:
   - `public/app/data/routes-data.js`
   - `public/app/data/segments-data.js`
   - `public/app/data/route-timelines-data.js`
   - `public/app/data/zwift-metadata.js`
4. Spot-check important routes in Route Inspector
5. Commit the regenerated files

## Why this approach

This gives us:

- pinned, reproducible builds
- no live dependency on Zwift auth/API behavior
- no need to clone or run the Sauce repo directly
- a smaller app-specific dataset instead of inheriting Sauce's full app structure

## Next useful data to pull more deeply

- `worlds/{worldId}/roads.json`
  - needed for grade/profile-aware segment classification
  - needed for better per-segment terrain honesty
  - needed for better recovery and time modeling
- `portal_roads.json`
  - needed if Climb Portal routes become first-class recommendation targets
- improved route matching metadata / aliases
  - needed to reduce unmatched timeline routes

## Fallback path

If the Sauce release structure changes or becomes unavailable, the fallback reference is:

- `docs/reference/zwift.mjs`

That file shows how Sauce talks to Zwift's authenticated `/api/game_info` endpoint. That path is a backup/reference path, not the current implementation path.
