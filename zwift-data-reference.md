# zwift-data Reference

This repository uses the `zwift-data` npm package as the source of route metadata.

## Install and Import
```js
import { routes } from 'zwift-data';
```

Install:
```bash
npm install zwift-data
```

## How This Repo Uses It
The package is not imported directly by the browser app at runtime. Instead:
1. `bundle-routes.mjs` imports `routes` from `zwift-data`
2. the script normalizes the fields this app cares about
3. it writes generated output to `routes-data.js`
4. `routes.js` re-exports that generated data plus display helpers

Do not edit `routes-data.js` manually. Regenerate it with:
```bash
npm run build-routes
```

## Route Fields Used Here
- `name`
- `world`
- `distance`
- `elevation`
- `eventOnly`
- `sports`
- `zwiftInsiderUrl`
- `whatsOnZwiftUrl`

The bundling script also normalizes missing values to safe defaults.

## Slug Conventions Used in This Repo
Examples from the generated data:
- `watopia`
- `london`
- `new-york`
- `makuri-islands`
- `innsbruck`
- `france`
- `paris`
- `yorkshire`

These slugs are mapped to display names in `routes.js`.

## Why Bundle Locally
- avoids runtime package loading in the browser
- keeps the app static-host friendly
- lets the repo pin a known route snapshot
- gives the app a stable, minimal field shape

## Notes
- `zwift-data` includes much more than routes, but this repo currently only uses route/world-related data.
- The package also exports TypeScript types even though this repo is plain JavaScript.
- If Zwift adds or changes route/world data upstream, rerun the bundling step and verify slug mappings in `routes.js`.

## Upstream Source
- Package docs: https://andipaetzold.github.io/zwift-data/
