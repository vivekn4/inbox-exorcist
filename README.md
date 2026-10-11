![INBOX EXORCIST banner](assets/banner.jpg)

# 👻 INBOX EXORCIST

### *Cast the newsletter demons out of your inbox. One button. Zero mercy.*

A maximalist neon exorcism for your Gmail: check if your email leaked in data breaches, hunt down every vendor spamming you, then **NUKE** them — automatic unsubscribes plus Gmail filters so their future mail never reaches you again. With screen-shake, synthesized SFX, and spirit-wisp particles, because inbox cleaning should feel like a boss fight.

**Crafted by Vivek Nair (VN)** — [github.com/vivekn4](https://github.com/vivekn4)

---

## ✨ What it does

1. **👻 Breach check** — type any email, get told which public data breaches it appeared in (via the free XposedOrNot API, no key needed).
2. **📥 Vendor hunt** — connect your Gmail (OAuth2, your own free Google credentials) and it scans your inbox for every sender advertising an unsubscribe link: newsletters, promos, social updates. Cards show sender, email count, category, and unsubscribe method.
3. **☠️ NUKE** — pick your demons, hold the big red button for 0.6s, review the dry-run ritual, confirm — and the exorcist unsubscribes each one (one-click POST / unsubscribe email / link visit) then creates **grouped Gmail filters** so their future mail is archived or deleted. Per-vendor progress, screen shake + zap per kill, holy-light burst on completion, downloadable report.

**Demo mode:** no Gmail? Hit **TRY WITHOUT GMAIL** — the whole UI runs on mock demons with simulated exorcisms. The full experience in 10 seconds, zero setup.

---

## 🔍 How it actually works (honest version)

Anyone claiming to "scan the entire internet" for your accounts is lying. Here's what this really does:

| Claim | Reality |
|---|---|
| "Breach check" | Queries the **XposedOrNot public breach corpus** — a large aggregation of known public breaches. Big, but not literally everything. |
| "Finds all vendors" | Scans **your own Gmail's recent messages** (metadata headers only: `From`, `Subject`, `List-Unsubscribe`). Only senders with a `List-Unsubscribe` header are listed — personal mail never appears. |
| "Unsubscribes everywhere" | Uses the unsubscribe mechanism the vendor itself advertised: **RFC 8058 one-click POST**, **RFC 2369 `mailto:`** (sends the unsub email via Gmail API), or a server-side visit of their link. |
| "They'll never email again" | The **Gmail filter** is the real guarantee: one filter per batch of vendors (`from:{a OR b OR c}`) archives/deletes future mail even if a vendor ignores your unsubscribe. |

**Privacy:** only message *headers* are ever read — bodies are never fetched and never logged. OAuth tokens live in server memory only (never disk, never the repo). Hit **Disconnect** anytime to wipe them.

---

## 🚀 Quick start

```bash
git clone https://github.com/vivekn4/inbox-exorcist.git
cd inbox-exorcist
npm install
npm start
# → http://localhost:3000 — breach check + demo mode work immediately
```

Demo mode needs **zero configuration**. For real Gmail scanning, do the 5-minute OAuth setup below.

## 🔑 Gmail setup (5 minutes, free)

1. Go to [Google Cloud Console](https://console.cloud.google.com) → create a project → **APIs & Services → Library** → enable **Gmail API**.
2. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → type **Web application**.
3. Under **Authorized redirect URIs**, add exactly:
   - Local: `http://localhost:3000/auth/callback`
   - Deployed: `https://YOUR-SERVICE.onrender.com/auth/callback`
4. Copy the **Client ID** and **Client secret** into your `.env` (see `.env.example`):
   ```
   GOOGLE_CLIENT_ID=....
   GOOGLE_CLIENT_SECRET=....
   GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
   ```
5. Restart, hit **CONNECT GMAIL**, approve — done.

> ⚠️ Google may show an "unverified app" warning for your own client ID in testing mode — that's normal; click through (it's *your* app accessing *your* mail). For personal use, keep the OAuth consent screen in **Testing** mode.

## ☁️ Deploy on Render (free)

1. Push this repo to GitHub.
2. Render → **New → Web Service** → connect the repo (or use `render.yaml` — it's included).
3. Build: `npm install` · Start: `npm start` · Node 20.
4. Add env vars in the Render dashboard: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI=https://YOUR-SERVICE.onrender.com/auth/callback`.
5. Add that same URI to your Google Cloud OAuth client. 🔥

---

## 🖥️ Screens

| | |
|---|---|
| **1 · Hero** | Flickering neon title, breach-check card, Gmail connect / demo buttons, drifting spirit wisps |
| **2 · Breach report** | Giant breach count, expandable breach list, alarm sting if pwned / calm chime if clean |
| **3 · Vendor dashboard** | Demon cards with counts + category tags, select-all, archive/delete choice, hold-to-charge NUKE button, dry-run confirmation modal |
| **4 · Exorcism** | Progress bar, per-demon kill feed (zap + screen shake each), final report in 3 buckets: ✅ exorcised / ⚠️ needs one click / ❌ failed, downloadable report |

### 🔊 SFX (100% synthesized WebAudio, zero audio files)
Hover blip · checkbox tick · NUKE charge riser · per-kill zap · completion choir-ish sting · error buzz · breach alarm · clean chime. Mute toggle top-right, persisted.

---

## 🧪 API

| Method | Route | Notes |
|---|---|---|
| `GET` | `/api/health` | `{ ok, service, version, oauth, demo }` |
| `GET` | `/api/breach?email=` | XposedOrNot lookup (rate-limited, 10-min cache) |
| `GET` | `/auth/google` | Start OAuth (501 + setup help if unconfigured) |
| `GET` | `/auth/callback` | OAuth callback |
| `GET` | `/auth/status` | Connection state |
| `POST` | `/auth/logout` | Wipe tokens |
| `POST` | `/api/scan` | Start async scan → `{ scanId }` (`{ demo, max }`) |
| `GET` | `/api/scan/status/:scanId` | Progress + vendor list when done |
| `POST` | `/api/nuke` | `{ vendorIds, filterAction, dryRun?, demo? }` → plan or `{ jobId }` |
| `GET` | `/api/nuke/progress/:jobId` | Per-vendor status + final summary |
| `GET` | `/api/demo/vendors` | Mock vendors |

**Safety rules enforced server-side:** only vendors from your last scan (IDs validated against the scan catalog — forged IDs are rejected); only senders with `List-Unsubscribe` signals are ever listed; nukes over 400 are refused (Gmail send quotas); dry-run preview before anything executes.

---

## 📁 Project structure

```
inbox-exorcist/
├── server.js            # hardened Express backend (helmet, CORS, rate limits, sessions)
├── lib/
│   ├── breach.js        # XposedOrNot client + 10-min cache
│   ├── gmail.js         # OAuth2, vendor scan (headers only), demo data
│   ├── exorcist.js      # nuke engine: unsubscribe + grouped filters, job tracking
│   └── util.js          # List-Unsubscribe parser, categorizer, domain grouping
├── public/              # zero-build frontend
│   ├── index.html       # 4-screen flow
│   ├── css/exorcist.css # neon exorcism theme
│   └── js/app.js        # screens, WebAudio SFX, particles, VFX
├── test/logic.test.mjs  # 17 unit tests (node --test style, zero deps)
├── assets/banner.jpg
├── PLAN.md              # developer plan (architecture, bugs+mitigations, UI/UX)
├── QC_NOTES.md          # what was tested and the results
└── render.yaml          # Render free-tier deploy
```

## 🛠️ Tech

Node 20 · Express 5 · `googleapis` (Gmail) · XposedOrNot (breaches) · zero-build HTML/CSS/JS frontend · WebAudio synthesized SFX · Canvas particles.

## 📜 License

MIT — see [LICENSE](LICENSE). Copyright © 2026 Vivek Nair (VN).

---

<p align="center"><strong>VN</strong> · built loud, shipped free, demons exorcised 😈</p>
