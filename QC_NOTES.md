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

## v1.1 QA — 2026-10-14 (teardown + upgrade pass)

Peer apps analyzed (mechanisms only, all re-implemented in original code):
- **haris-cl/inbox-nuke** (MIT, GitHub `8e48e142…`) — safety guardrails,
  multi-signal recommendations, whitelist, run history. REA on its
  Next.js frontend: 66 files parsed, 990 findings.
- **nilaybarde/gmail-cleanup-tool** (GitHub `ecfb0d0a…`) — batch metadata
  fetch with 403 backoff, example subjects per sender, batchDelete.
  Built its Vite frontend locally; REA on the shipped bundle
  `dist/assets/index-He8wRsYm.js` (sha256 `ebc1afa4…847a0781`,
  586,139 bytes): AST parse complete, 196,959 nodes; semantic phase hit
  REA's worker heap limit (partial coverage, recorded in REA output).
- **niraj8/mailprune** (GitHub `304de51d…`) — sender stacks, read-rate %,
  "in view vs mailbox total" confirm honesty, action log. Docs/ADR-based
  (Rust TUI — no JS bundle / APK to REA).
- FairEmail APK: NOT analyzed — official GitHub Release + F-Droid
  downloads both truncated at exactly 16.5 MiB by the egress proxy;
  artifact unobtainable, moved on. No paid apps downloaded anywhere.

Unit tests: **26/26 pass** (`npm test`: 17 original + 9 new v1.1 —
protected senders, merge of unread/recency/subjects, backoff, retry,
chunking, dry-run delete-existing text, delete-existing chunking + cap).
A test caught a real bug pre-ship: `baseDomain("servicecanada.gc.ca")`
collapses to `gc.ca`, breaking the `.gc.ca` suffix check — fixed by
testing suffixes against the full host.

Live server tests (PORT 3125, demo mode, no OAuth creds):
| Test | Result |
|---|---|
| `GET /api/health` | 200, version 1.1.0 |
| `GET /api/demo/vendors` | 10 vendors incl. 1 protected (Maple Bank Alerts), all with unread/unreadRate/lastSeen/exampleSubjects |
| Dry-run `deleteExisting:true` (Daily Deals) | plan shows `mailboxEstimate: 151`, "Will ALSO permanently delete ~151 existing messages" |
| Dry-run protected WITHOUT opt-in | 400 `PROTECTED_REQUIRES_OPT_IN` |
| Dry-run protected WITH `allowProtected:true` | 200 |
| Demo nuke `deleteExisting:true` + protected opt-in (2 vendors) | `done`, `deletedExisting` 151 + 73, per-vendor detail lines |
| Forged vendor ID | 400 "Those vendors aren't from your last scan" |
| All 44 `$("…")` IDs in app.js exist in index.html (incl. 5 new v1.1 IDs) | pass |
| `/`, `/css/exorcist.css`, `/js/app.js`, `/favicon.svg` | all 200 |

Not live-tested (same as v1.0): real Gmail OAuth scan/nuke paths —
require the user's own Google Cloud credentials. Demo mode simulates them.
