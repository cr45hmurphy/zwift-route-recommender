# Xert API Reference

This repository uses the Xert Online API v1.4 through a local proxy in development (`proxy.js`) and a Netlify function in production (`netlify/functions/xert-proxy.js`).

## Auth
- Token endpoint: `POST /oauth/token`
- Public client credentials used by this app: `xert_public` / `xert_public`
- The browser stores `access_token` in `localStorage`; current app code also tracks a local token timestamp.

## Endpoints Relevant to This Repo
### `GET /oauth/training_info`
Current fitness/status snapshot used for:
- `status`
- `weight`
- `signature.ftp / ltp / hie / pp`
- `targetXSS.low / high / peak / total`
- `wotd`

Important: `training_info.tl.low/high/peak` are training-load values, not the same as Xert Daily Summary completed bucket totals.

### `GET /oauth/activity?from=<unix>&to=<unix>`
Lists activities in a date range. Used for gathering today's activities.

### `GET /oauth/activity/{path}`
Returns detail + `summary` for an activity. Most important fields for Daily Summary alignment:
- `summary.xss` → total completed
- `summary.xlss` → low completed
- `summary.xhss` → high completed
- `summary.xpss` → peak completed

These values closely match the Daily Summary "Completed" bucket view in Xert.

## Repo Usage Pattern
- `xert.js` should stay responsible for token-aware fetches to Xert.
- App logic in `app.js` should use:
  - `training_info` for freshness/signature/targets/WOTD
  - activity summaries for completed daily bucket totals

## Daily Summary Mapping
- `completed.low = sum(summary.xlss)`
- `completed.high = sum(summary.xhss)`
- `completed.peak = sum(summary.xpss)`
- `completed.total = sum(summary.xss)`
- `remaining.bucket = max(targetXSS.bucket - completed.bucket, 0)`

## Notes
- Query "today" using local-day timestamps, not UTC calendar strings.
- Activity response timestamps are UTC-formatted in payloads, but the query window can still represent local-day epochs.
- If Daily Summary behavior needs to match Xert exactly, validate with real user data after any rounding/display changes.

## Upstream Source
- Official API docs: https://www.xertonline.com/API.html
