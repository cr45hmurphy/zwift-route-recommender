# Repository Guidelines

## Project Structure & Module Organization
This repository is a small browser-based route recommender for Zwift. Core UI logic lives in `app.js`, scoring logic in `scorer.js`, API/auth helpers in `xert.js`, and route metadata helpers in `routes.js`. Generated route data is stored in `routes-data.js`; treat it as build output, not hand-edited source. Static assets are at the repo root (`index.html`, `style.css`). Netlify serverless code lives in `netlify/functions/xert-proxy.js`. Planning notes such as `planning.md` and `parkinglot.md` are reference docs, not runtime code.

## Build, Test, and Development Commands
- `npm install` installs dependencies, including `zwift-data`.
- `npm run build-routes` regenerates `routes-data.js` from the latest `zwift-data` package.
- `npm run serve` starts a local static server for manual testing.
- `npx netlify dev` is the best local option when validating the Xert proxy function end-to-end.

Run `npm run build-routes` after updating route-source dependencies or changing the bundling script.

## Coding Style & Naming Conventions
Use ES modules and keep files browser-friendly. Follow the existing style: 2-space indentation, semicolons, single quotes, and small focused functions. Use `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for tuning constants, and descriptive filenames like `xert.js` or `bundle-routes.mjs`. Keep generated-file warnings intact in `routes-data.js`, and prefer extending existing modules over adding new top-level files unless responsibilities clearly diverge.

## Testing Guidelines
There is no formal test runner configured yet. Validate behavior by serving the app locally and using the HTML harnesses `scorer-test.html`, `xert-test.html`, and `cors-test.html`. For logic changes, test both the happy path and obvious edge cases such as missing tokens, zero-distance routes, and metric/imperial toggling. If you add automated tests later, keep them close to the module they cover and document the command in `package.json`.

## Commit & Pull Request Guidelines
Recent commits use short, imperative summaries such as `Add time feature, Netlify deployment, label + scoring fixes` and `Fix proxy.js: convert require to ESM imports`. Keep commits focused and descriptive. Pull requests should explain the user-visible change, call out any regenerated data files, link related issues, and include screenshots when UI output changes. Mention any manual test steps you ran so reviewers can reproduce them quickly.

## Configuration & Security Tips
Do not commit live Xert credentials or tokens. Prefer local environment configuration when working with proxy/auth flows, and verify CORS-sensitive changes through the Netlify function rather than direct browser calls.
