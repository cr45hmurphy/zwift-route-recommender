# Zwift Route Data Reference

This repository now treats Zwift's public CDN XML as the authoritative source of route, segment, guest-world, and Climb Portal data.

## Authoritative Upstream Sources
- `https://cdn.zwift.com/gameassets/GameDictionary.xml`
- `https://cdn.zwift.com/gameassets/MapSchedule_v2.xml`
- `https://cdn.zwift.com/gameassets/PortalRoadSchedule_v1.xml`
- `https://cdn.zwift.com/gameassets/Zwift_Updates_Root/Zwift_ver_cur.xml`

## How This Repo Uses Them
The browser app still consumes generated JavaScript modules, not raw XML.

`npm run build-routes` and `npm run build-segments` both run:
```bash
node scripts/build-zwift-data.mjs
```

That generator:
1. fetches the Zwift CDN XML files
2. normalizes them into the app's browser-friendly route and segment shape
3. writes `routes-data.js`, `segments-data.js`, and `zwift-metadata.js`
4. uses `zwift-data` only as a temporary compatibility layer for slugs, external links, and Strava segment URLs

Do not edit any generated file under `public/app/data/` manually.

## Generated Route Fields
- `name`
- `slug`
- `world`
- `distance`
- `elevation`
- `eventOnly`
- `sports`
- `segments`
- `segmentsOnRoute`
- `zwiftInsiderUrl`
- `whatsOnZwiftUrl`
- `signature`
- `leadInDistance`
- `leadInElevation`
- `levelLocked`
- `supportedLaps`

Distance fields are normalized to kilometers. Elevation fields are normalized to meters.

## Generated Segment Fields
- `name`
- `slug`
- `type` (`climb` or `sprint`)
- `world`
- `distance`
- `elevation`
- `avgIncline`
- `climbType`
- `stravaSegmentUrl`

Route-linked segment membership comes from `GameDictionary.xml` `onRoutes`, not the old world-level approximation.

## Generated Metadata Fields
`zwift-metadata.js` currently exports:
- `zwiftMetadata` — generated timestamp, Zwift version, route count, segment count
- `guestWorldAppointments` — normalized entries from `MapSchedule_v2.xml`
- `portalRoadMetadata` — normalized portal climb metadata
- `portalRoadAppointments` — normalized portal rotation schedule

## Slug Conventions
The browser app remains slug-centric. These must stay stable:
- route `slug`
- segment `slug`
- world slug values like `watopia`, `london`, `new-york`, `makuri-islands`, `france`, `paris`, `scotland`, `gravel-mountain`

These slugs are mapped to display names in `routes.js`.

## Notes
- The generated snapshot approach avoids runtime CORS dependency for Zwift route data.
- `zwift-data` is still installed for compatibility enrichment during the cutover, but it is no longer the source of truth for route totals or route-to-segment mapping.
- If Zwift changes upstream route data or releases a new game version, rerun the generator and commit the refreshed generated files.
