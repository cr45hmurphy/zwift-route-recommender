# Repository Guidelines

## Project Structure & Module Organization
This repository is a small browser-based route recommender for Zwift. Static app entry files live in `public/`: `public/index.html`, `public/assets/style.css`, and `public/app/app.js`. Shared browser modules live under `public/app/core/`, while generated and mock data live under `public/app/data/`; treat `routes-data.js`, `segments-data.js`, `route-timelines-data.js`, and `zwift-metadata.js` as build output, not hand-edited source. Manual HTML harnesses live in `public/tests/`. Netlify serverless code lives in `netlify/functions/xert-proxy.js`. Build/dev utilities live in `scripts/`. Planning notes and references live in `docs/` and are not runtime code.

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
|  |  |  |- timelines.js
|  |  |  |- xert.js
|  |  |- data/
|  |     |- mock-data.js
|  |     |- routes-data.js
|  |     |- segments-data.js
|  |     |- route-timelines-data.js
|  |     |- zwift-metadata.js
|  |- tests/
|     |- cors-test.html
|     |- scorer-test.html
|     |- xert-test.html
|- netlify/
|  |- functions/
|     |- xert-proxy.js
|- scripts/
|  |- build-zwift-data.mjs
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
- `npm install` installs dependencies, including temporary compatibility packages used by the build.
- `npm run build-routes` runs `scripts/build-zwift-data.mjs` and regenerates `routes-data.js`, `segments-data.js`, `route-timelines-data.js`, and `zwift-metadata.js`.
- `npm run serve` starts a local static server for `public/`.
- `npx netlify dev` is the best local option when validating the Xert proxy function end-to-end.

Run `npm run build-routes` after updating route-source dependencies or changing the build script in `scripts/`.

## Catchup Workflow
When the user says `catchup`, summarize the current project state instead of treating it as a generic question. Start with `git status --short` and `git log --oneline -5`. Then use `rg --files` to find and read continuity notes, especially `docs/planning/catchup.md`, `docs/planning/parkinglot.md`, and any Markdown files under `docs/planning/` whose names include `plan` such as `planning.md`, `test-plan.md`, or `test-plan-feedback.md`.

Keep the catchup concise and practical. Report the git state, recent commits, important notes from the planning files, and obvious next actions. Call out generated data files or local artifacts separately from source changes.

## Sauce-Derived Data
This repo currently uses Sauce for Zwift's release bundle as a build-time data source for route manifests and route-position timelines. It does not depend on the Sauce repo or authenticated Zwift API at runtime.

Before changing the route-data pipeline, read:
- `docs/reference/sauce-update-workflow.md`
- `docs/reference/zwift.mjs` for the authenticated `/api/game_info` fallback reference only

If the Sauce developer publishes new route data, bump `SAUCE_RELEASE_VERSION` in `scripts/build-zwift-data.mjs`, run `npm run build-routes`, review the generated outputs, and commit them together.

## Coding Style & Naming Conventions
Use ES modules and keep files browser-friendly. Follow the existing style: 2-space indentation, semicolons, single quotes, and small focused functions. Use `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for tuning constants, and descriptive filenames like `xert.js` or `bundle-routes.mjs`. Keep generated-file warnings intact in `routes-data.js`, and prefer extending existing modules over adding new top-level files unless responsibilities clearly diverge.

## Testing Guidelines
There is no formal test runner configured yet. Validate behavior by serving the app locally and using the HTML harnesses in `public/tests/` (`scorer-test.html`, `xert-test.html`, and `cors-test.html`). For logic changes, test both the happy path and obvious edge cases such as missing tokens, zero-distance routes, and metric/imperial toggling. If you add automated tests later, keep them close to the module they cover and document the command in `package.json`.

## Commit & Pull Request Guidelines
Recent commits use short, imperative summaries such as `Add time feature, Netlify deployment, label + scoring fixes` and `Fix proxy.js: convert require to ESM imports`. Keep commits focused and descriptive. Pull requests should explain the user-visible change, call out any regenerated data files, link related issues, and include screenshots when UI output changes. Mention any manual test steps you ran so reviewers can reproduce them quickly.

## Configuration & Security Tips
Do not commit live Xert credentials or tokens. Prefer local environment configuration when working with proxy/auth flows, and verify CORS-sensitive changes through the Netlify function rather than direct browser calls.
