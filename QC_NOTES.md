# QC_NOTES.md — inbox-exorcist

Tested 2026-10-10 by Squirt (agent) before handoff. **No real Gmail account was used** — all Gmail paths tested in demo/simulated mode. No user data touched.

## Unit tests — 17/17 pass (`npm test`)

`test/logic.test.mjs` covers the pure logic in `lib/util.js` + `lib/exorcist.js`:
- `List-Unsubscribe` parsing: mixed mailto+https with angle brackets, RFC 8058 one-click detection, stray whitespace, empty header
- `mailtoAddress` / `mailtoParams` (subject/body extraction)
- `normalizeSender` ("Name <a@b>" → address), `categorizeSender` (newsletter/promo/service/social/other)
- `unsubscribeStrategy` ranking (one-click > email > link > none)
- `buildRawUnsubscribeEmail` produces valid base64url RFC 2822
- `escapeHtml` XSS neutralization, `clip`, `looksLikeEmail`
- `baseDomain` grouping incl. two-level suffixes (`shop.co.uk`), `mergeVendorsByDomain` merges sibling senders preferring actionable strategy
- `dryRunPlan` describes without executing; simulated `runNukeJob` completes with correct buckets (1 unsubscribed, 1 manual, filters created)

## Live server tests (PORT 3123, `DEMO_MODE=0`, no OAuth creds)

| Test | Result |
|---|---|
| `npm install` | 96 packages, no errors |
| `node --check server.js` + `node --check public/js/app.js` | syntax OK |
| Server boots, `GET /api/health` | 200, `{ ok, service, version, oauth:false, demo:false }` |
| `GET /api/breach?email=test@example.com` (live XposedOrNot) | 200 — `breached:true, count:1, breaches:["Peatix"]` ✅ real API works |
| `GET /api/breach?email=notanemail` | 400 clean JSON error |
| `GET /api/demo/vendors` | 9 vendors, all 4 strategies represented |
| `POST /api/scan` `{demo:true}` → `GET /api/scan/status/:id` | `done`, 9 vendors, `demo:true` |
| `POST /api/nuke` `dryRun:true` (5 vendors) | plan with per-vendor `willDo` descriptions, filter action honored |
| `POST /api/nuke` (5 vendors, delete) → poll progress | `done`, 5× `done:unsubscribed`, 1 grouped filter, correct summary message |
| Forged vendor ID (`deadbeef1234`) | 400 "Those vendors aren't from your last scan" ✅ |
| Empty `vendorIds` | 400 "Select at least one vendor" ✅ |
| `GET /auth/google` without OAuth configured | 501 + setup instructions JSON ✅ |
| `GET /` → index.html, `/css/exorcist.css`, `/js/app.js`, `/favicon.svg` | all 200 |
| Unknown `/api/*` route | 404 JSON; unknown page → serves index.html (SPA fallback) |

## Frontend static checks

- All 39 `$("…")` IDs referenced in `app.js` exist in `index.html` (script-verified, none missing)
- No external assets: SFX 100% WebAudio-synthesized, fonts are system stack, particles are canvas — page works offline except API calls
- All vendor-provided strings rendered through `esc()` (XSS); server also ships `escapeHtml`

## Secrets audit

- `grep` for API keys / tokens / client secrets across `*.js,*.json,*.md,*.example,*.yaml,*.svg` (excluding node_modules): **clean**
- No `.env` file in the project; `.env.example` has empty placeholders; `.gitignore` covers `.env`, `.env.local`, `node_modules/`, logs

## Known limitations (documented in README)

- Breach check covers the XposedOrNot public corpus only — not "the entire internet"
- Vendor scan reads the N most recent messages (default 300, max 500) in two passes (recent + `category:promotions`); very old senders may be missed
- `baseDomain` grouping is a heuristic (small two-level-suffix list), not a full public-suffix list
- Real Gmail scan/nuke paths (OAuth, `users.messages.send`, `settings.filters.create`) are code-reviewed but **not live-tested** — they require the user's own Google Cloud credentials; demo mode simulates them
- Render free tier sleeps: in-memory sessions/jobs are lost on sleep (user re-connects; documented)
