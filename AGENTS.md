# Repository Guidelines

## Project Structure & Module Organization
This repository is a small browser-based route recommender for Zwift. Static app entry files live in `public/`: `public/index.html`, `public/assets/style.css`, and `public/app/app.js`. Shared browser modules live under `public/app/core/`, while generated and mock data live under `public/app/data/`; treat `routes-data.js` and `segments-data.js` as build output, not hand-edited source. Manual HTML harnesses live in `public/tests/`. Netlify serverless code lives in `netlify/functions/xert-proxy.js`. Build/dev utilities live in `scripts/`. Planning notes and references live in `docs/` and are not runtime code.

Current layout:

```text
.
|- public/
|  |- index.html
|  |- assets/
|  |  |- style.css
|  |- app/
|  |  |- app.js
|  |  |- core/
|  |  |  |- routes.js
|  |  |  |- scorer.js
|  |  |  |- segments.js
|  |  |  |- xert.js
|  |  |- data/
|  |     |- mock-data.js
|  |     |- routes-data.js
|  |     |- segments-data.js
|  |- tests/
|     |- cors-test.html
|     |- scorer-test.html
|     |- xert-test.html
|- netlify/
|  |- functions/
|     |- xert-proxy.js
|- scripts/
|  |- bundle-routes.mjs
|  |- proxy.js
|- docs/
|  |- planning/
|  |- reference/
|- AGENTS.md
|- CLAUDE.md
|- netlify.toml
|- package.json
```

## Build, Test, and Development Commands
- `npm install` installs dependencies, including `zwift-data`.
- `npm run build-routes` regenerates `public/app/data/routes-data.js` and `public/app/data/segments-data.js` from the latest `zwift-data` package.
- `npm run serve` starts a local static server for `public/`.
- `npx netlify dev` is the best local option when validating the Xert proxy function end-to-end.

Run `npm run build-routes` after updating route-source dependencies or changing the bundling script in `scripts/`.

## Coding Style & Naming Conventions
Use ES modules and keep files browser-friendly. Follow the existing style: 2-space indentation, semicolons, single quotes, and small focused functions. Use `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for tuning constants, and descriptive filenames like `xert.js` or `bundle-routes.mjs`. Keep generated-file warnings intact in `routes-data.js`, and prefer extending existing modules over adding new top-level files unless responsibilities clearly diverge.

## Testing Guidelines
There is no formal test runner configured yet. Validate behavior by serving the app locally and using the HTML harnesses in `public/tests/` (`scorer-test.html`, `xert-test.html`, and `cors-test.html`). For logic changes, test both the happy path and obvious edge cases such as missing tokens, zero-distance routes, and metric/imperial toggling. If you add automated tests later, keep them close to the module they cover and document the command in `package.json`.

## Commit & Pull Request Guidelines
Recent commits use short, imperative summaries such as `Add time feature, Netlify deployment, label + scoring fixes` and `Fix proxy.js: convert require to ESM imports`. Keep commits focused and descriptive. Pull requests should explain the user-visible change, call out any regenerated data files, link related issues, and include screenshots when UI output changes. Mention any manual test steps you ran so reviewers can reproduce them quickly.

## Configuration & Security Tips
Do not commit live Xert credentials or tokens. Prefer local environment configuration when working with proxy/auth flows, and verify CORS-sensitive changes through the Netlify function rather than direct browser calls.
