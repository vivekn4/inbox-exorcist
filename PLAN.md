# INBOX EXORCIST — Developer Plan

## 1. Architecture

```
Browser (static frontend, zero build)  →  Express backend (Node 20)  →  Gmail API + XposedOrNot API
```

- **Frontend:** plain HTML/CSS/JS in `public/`. No framework — keeps it fast, free, and easy to QC.
- **Backend:** Express. Thin routes; all Gmail logic isolated in `lib/gmail.js`, unsubscribe engine in `lib/exorcist.js`, breach check in `lib/breach.js`.
- **Auth:** Google OAuth2 (user supplies their own free `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` via env — documented 5-min setup). Tokens live in server memory sessions only. Never on disk, never in the repo.
- **Deploy:** Render free tier via `render.yaml`. Cold starts are expected — handled below.

### API surface

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/breach?email=` | XposedOrNot breach lookup (no auth needed) |
| GET | `/auth/google` | Start OAuth flow |
| GET | `/auth/callback` | OAuth callback, store tokens in session |
| GET | `/auth/status` | `{ connected, email, oauthConfigured }` |
| POST | `/auth/logout` | Disconnect — wipes tokens from server memory |
| POST | `/api/scan` | Start async inbox scan → `{ scanId }` (body: `{ demo, max }`) |
| GET | `/api/scan/status/:scanId` | Scan progress → `{ status, scanned, target, vendors? }` |
| POST | `/api/nuke` | Body: `{ vendorIds, filterAction: "archive"\|"delete", dryRun?, demo? }` → dry-run plan or `{ jobId }` |
| GET | `/api/nuke/progress/:jobId` | Poll per-vendor status during a nuke run |
| GET | `/api/demo/vendors` | Mock vendor data so the UI is tryable without Gmail |

> Implementation note (deviation from the first draft): the scan runs as a
> background job (`POST /api/scan` → poll `/api/scan/status/:scanId`) instead
> of a single blocking `GET /api/vendors`, so paging a 500-message inbox never
> hangs the request. Same for nukes. Demo mode is a first-class flag rather
> than a separate UI fork.

## 2. Build steps (in order)

1. **Scaffold** — `package.json`, `server.js`, `public/`, `.env.example`, `.gitignore`, `render.yaml`, MIT `LICENSE`, VN favicon/logo.
2. **Breach check** — `lib/breach.js` + frontend card. Works with zero auth: fastest visible win, testable immediately.
3. **Google OAuth** — `lib/gmail.js` auth flow, `/auth/*` routes, session handling, README setup guide with screenshots-described steps.
4. **Vendor scan** — `POST /api/scan` starts a background job (paginates with `pageToken` across two passes: recent mail + `category:promotions`), parses `From` + `List-Unsubscribe`, aggregates by sender, guesses category, groups siblings by registered domain (`lib/util.js` `baseDomain` heuristic), returns JSON via `/api/scan/status/:scanId`.
5. **Nuke engine** — `lib/exorcist.js`: parse List-Unsubscribe (mailto vs https), send/RFC-8058-POST, then `users.settings.filters.create`. Job tracking with per-vendor status.
6. **Frontend UI/UX** — the 4-screen flow (§4), particles, WebAudio SFX, VFX. Mobile-first (big touch targets).
7. **Demo mode** — mock data routes + toggle, so the whole UI is clickable without credentials.
8. **QC + docs** — README (honest "how it works", setup, limits), `QC_NOTES.md`, dry-run pass, secrets audit.

## 3. Possible bugs & problems (and mitigations)

**Breach API**
- XposedOrNot rate-limits (429) → debounce the email input, cache results per session, friendly "slow down" message instead of a stack trace.
- API response shape changes → defensive parsing with fallbacks; never assume fields exist.

**Gmail scan**
- Pagination: inboxes are huge → cap scan (default 500 msgs), page with `pageToken`, show a progress bar, not a hang.
- `List-Unsubscribe` parsing is gnarly: multiple URIs, angle brackets, stray whitespace → robust parser, unit-test it with nasty real-world samples.
- Duplicate vendors (`noreply@x.com` vs `news@x.com`) → group by registered domain.
- False positives (a personal email with an unsubscribe footer) → user explicitly checks boxes; nothing happens without selection + confirm. Dry-run preview lists exactly what will happen.

**Nuke engine**
- `mailto:` unsubscribes may need subject/body tokens → parse the full mailto URI, send via `gmail.users.messages.send` with base64url raw MIME.
- One-click HTTPS (RFC 8058) needs `POST` with body `List-Unsubscribe=One-Click` → do it server-side; on non-200, mark vendor "needs manual click" and show the URL to the user instead of failing silently.
- Gmail send quota (~500/day) → chunk large nukes, warn when selection > 400.
- Too many filters → don't create one filter per vendor; batch into grouped filters using `from:{a OR b OR c}` queries.
- Some vendors just ignore unsubscribes → the Gmail filter is the real guarantee; frame it that way in the UI ("even if they ignore you, their mail never reaches your inbox again").

**Auth & sessions**
- Access tokens die after 1h → use refresh tokens; on `invalid_grant` (user revoked), prompt re-auth cleanly.
- OAuth redirect URI must match exactly (localhost vs deployed URL) → env-driven, documented, with the exact strings to paste into Google Cloud console.
- Render free tier sleeps → cold-start warning in docs; keep the OAuth callback lightweight so it survives a wake-up.

**Security & privacy**
- Escape all vendor names/subjects before rendering (XSS).
- Never log email bodies; only headers/metadata. State this in the README — it's a trust feature.
- Tokens in memory only; sessions expire; "Disconnect" button wipes them.

**UX edge cases**
- User connects Gmail with 0 newsletters → celebrate it ("your inbox is already pure") instead of showing an empty table.
- Nuke partially fails → report shows exorcised / filtered / manual-attention buckets, never a generic "error".
- Mobile (primary device): responsive layout, checkboxes ≥44px targets, NUKE button thumb-reachable.

## 4. UI/UX — simple, with SFX + VFX

**Flow: 4 screens, one primary action each. No settings page — choices live inline.**

1. **Hero** — giant flickering neon "INBOX EXORCIST" title, tagline "Cast the newsletter demons out of your inbox." Email input + `SCAN FOR BREACHES`, plus `CONNECT GMAIL` button. VFX: drifting spirit-wisp particles on canvas, subtle CRT scan-line sweep.
2. **Breach report** — big shield icon, huge breach count number, expandable breach list (name, date, what leaked). Clean = calm chime + green glow. Breached = red pulse + alarm sting.
3. **Vendor dashboard** — card rows: vendor name/domain, email count badge, category tag (newsletter/promo/receipt), checkbox. "Select all" + category filter chips. Inline choice: `Archive future mail` / `Delete future mail` as two radio cards. Then the big red **NUKE** button (disabled until ≥1 selected). Clicking opens a dry-run modal: "This will unsubscribe from N vendors. Their future mail gets archived." Confirm / cancel.
4. **Exorcism progress** — progress bar, per-vendor tick list flipping to ✅/⚠️, counter "37 demons exorcised". Final report: three buckets (exorcised / filtered / needs your click), `DOWNLOAD REPORT` button, holy-light burst on completion.

**SFX (all synthesized with WebAudio, zero assets):** hover blip, checkbox tick, button charge riser, per-vendor zap, completion sting, error buzz. Mute toggle in the corner, persisted in `localStorage`.

**VFX:** ember/spirit particles, neon glow text, NUKE button charge-up animation (holds 0.6s — doubles as accidental-press protection), screen shake + flash per kill, scan-line sweep during breach check.

**Simplicity rules:** plain words ("Nuke selected", not "Execute batch unsubscribe"); every destructive action shows exactly what will happen first; demo mode toggle ("Try without Gmail") so anyone can play with it in 10 seconds.
