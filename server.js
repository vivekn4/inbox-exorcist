// Crafted by Vivek Nair (VN) — https://github.com/vivekn4
/**
 * inbox-exorcist — API server
 * --------------------------------------------
 * Zero-build static frontend (public/) + hardened Express backend.
 *
 * Honest architecture (see README "How it actually works"):
 *  - Breach check  → free XposedOrNot API (their public breach corpus,
 *                     NOT "the entire internet" — we say so in the UI).
 *  - Vendor scan   → the user's OWN Gmail via OAuth2 (their own free
 *                     Google Cloud client id/secret). Only message
 *                     METADATA headers are read; bodies never fetched.
 *  - NUKE          → RFC 2369 mailto: / RFC 8058 one-click unsubscribe
 *                     + grouped Gmail filters as the real guarantee.
 *
 * Tokens live in server-memory sessions only — never on disk, never logged.
 */
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkBreaches } from "./lib/breach.js";
import {
  oauthConfigured, getAuthUrl, exchangeCode, gmailFor,
  getProfileEmail, scanVendors, demoVendors, reauthError,
} from "./lib/gmail.js";
import { createNukeJob, getNukeJob, runNukeJob, dryRunPlan } from "./lib/exorcist.js";
import { looksLikeEmail, buildRawUnsubscribeEmail, clip } from "./lib/util.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const FRONTEND_URL = (process.env.FRONTEND_URL || "").trim();
const TRUST_PROXY = process.env.TRUST_PROXY ?? "1";
const DEMO_MODE = process.env.DEMO_MODE === "1"; // force demo data even with OAuth set
const VERSION = "1.0.0";
const SERVICE = "inbox-exorcist";

const log = (level, fields = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, service: SERVICE, version: VERSION, ...fields }));

/* ------------------------------------------------------------------ */
/* In-memory sessions (tokens NEVER touch disk)                        */
/* ------------------------------------------------------------------ */
const sessions = new Map(); // sid -> { tokens, email, vendors, createdAt }
const COOKIE = "ix_session";

function newSession() {
  const sid = crypto.randomBytes(32).toString("hex");
  sessions.set(sid, { tokens: null, email: "", vendors: [], createdAt: Date.now() });
  return sid;
}
function getSession(req) {
  const raw = req.headers.cookie || "";
  const m = raw.match(new RegExp(`${COOKIE}=([a-f0-9]{64})`));
  const sid = m && m[1];
  if (sid && sessions.has(sid)) return { sid, data: sessions.get(sid) };
  const fresh = newSession();
  return { sid: fresh, data: sessions.get(fresh), fresh: true };
}
function setSessionCookie(res, sid, req) {
  const secure = process.env.NODE_ENV === "production" && (req.secure || req.headers["x-forwarded-proto"] === "https");
  res.setHeader("Set-Cookie", `${COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure ? "; Secure" : ""}`);
}
setInterval(() => {
  const cut = Date.now() - 24 * 60 * 60 * 1000;
  for (const [sid, s] of sessions) if (s.createdAt < cut) sessions.delete(sid);
}, 60 * 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/* Scan jobs (async: page inbox without hanging the request)           */
/* ------------------------------------------------------------------ */
const scans = new Map(); // scanId -> { status, scanned, target, vendors, error }

async function runScan(scanId, tokens, max) {
  const job = scans.get(scanId);
  try {
    const vendors = await scanVendors(tokens, max, (p) => {
      job.scanned = p.scanned; job.target = p.target; job.phase = p.phase;
    });
    job.status = "done"; job.vendors = vendors; job.scanned = vendors.length;
  } catch (e) {
    job.status = "error";
    job.error = e.code === "REAUTH_REQUIRED"
      ? "Gmail authorization expired — please reconnect."
      : `Scan failed: ${clip(e.message, 160)}`;
  }
}
setInterval(() => {
  const cut = Date.now() - 60 * 60 * 1000;
  for (const [id, j] of scans) if (j.finishedAt < cut) scans.delete(id);
}, 15 * 60 * 1000).unref();

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */
const app = express();
app.set("trust proxy", TRUST_PROXY);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: FRONTEND_URL ? FRONTEND_URL.split(",").map((s) => s.trim()) : true }));
app.use(express.json({ limit: "256kb" }));

const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200 });
const breachLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: { error: "Slow down, exorcist — too many breach checks. Try again in a bit." } });
const nukeLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { error: "Nuke limit reached for this hour. The demons can wait." } });
app.use("/api/", generalLimiter);

app.use((req, res, next) => {
  const { sid, data, fresh } = getSession(req);
  req.sessionId = sid; req.session = data;
  if (fresh) setSessionCookie(res, sid, req);
  next();
});

app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

/* ---------------- health ---------------- */
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, service: SERVICE, version: VERSION, oauth: oauthConfigured(), demo: DEMO_MODE }));

/* ---------------- breach check (no auth needed) ---------------- */
app.get("/api/breach", breachLimiter, async (req, res) => {
  const email = String(req.query.email || "").trim();
  if (!looksLikeEmail(email)) return res.status(400).json({ error: "Give me a real email address to check." });
  const result = await checkBreaches(email);
  if (result.error) return res.status(502).json({ error: result.error });
  res.json(result);
});

/* ---------------- Gmail OAuth ---------------- */
app.get("/auth/google", (req, res) => {
  if (!oauthConfigured()) {
    return res.status(501).json({
      error: "Gmail is not configured on this server.",
      setup: "The server owner must set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (free from Google Cloud Console). See README for the 5-minute setup.",
    });
  }
  res.redirect(getAuthUrl(req.sessionId));
});

app.get("/auth/callback", async (req, res) => {
  const { code, error, state } = req.query;
  if (error) return res.redirect("/?auth=denied");
  if (!code) return res.redirect("/?auth=error");
  try {
    const tokens = await exchangeCode(String(code));
    const sid = typeof state === "string" && sessions.has(state) ? state : req.sessionId;
    const sess = sessions.get(sid);
    sess.tokens = tokens;
    try { sess.email = await getProfileEmail(tokens); } catch { sess.email = ""; }
    setSessionCookie(res, sid, req);
    log("info", { event: "oauth_connected", email: sess.email ? "***@***" : "unknown" });
    res.redirect("/?auth=ok");
  } catch (e) {
    log("warn", { event: "oauth_failed", message: clip(e.message, 120) });
    res.redirect("/?auth=error");
  }
});

app.get("/auth/status", (req, res) => {
  res.json({
    connected: Boolean(req.session.tokens),
    email: req.session.email || "",
    demoAvailable: true,
    oauthConfigured: oauthConfigured(),
  });
});

app.post("/auth/logout", (req, res) => {
  req.session.tokens = null; req.session.email = ""; req.session.vendors = [];
  res.json({ ok: true, message: "Disconnected. Tokens wiped from server memory." });
});

/* ---------------- vendor scan ---------------- */
app.post("/api/scan", async (req, res) => {
  const max = Math.min(Math.max(Number(req.query.max) || Number(req.body?.max) || 300, 1), 500);
  if (DEMO_MODE || req.body?.demo === true || !oauthConfigured()) {
    // Demo / unconfigured: instant mock scan so the UI is fully tryable.
    const scanId = crypto.randomUUID();
    scans.set(scanId, { status: "done", scanned: 9, target: 9, phase: "demo", vendors: demoVendors(), finishedAt: Date.now(), demo: true });
    req.session.vendors = demoVendors();
    return res.json({ scanId, demo: true });
  }
  if (!req.session.tokens) return res.status(401).json({ error: "Connect Gmail first.", code: "AUTH_REQUIRED" });
  const scanId = crypto.randomUUID();
  scans.set(scanId, { status: "running", scanned: 0, target: max, phase: "listing", vendors: [], finishedAt: Date.now() });
  runScan(scanId, req.session.tokens, max).then(() => {
    const j = scans.get(scanId);
    j.finishedAt = Date.now();
    if (j.status === "done") req.session.vendors = j.vendors;
  });
  res.json({ scanId });
});

app.get("/api/scan/status/:scanId", (req, res) => {
  const job = scans.get(req.params.scanId);
  if (!job) return res.status(404).json({ error: "Scan not found." });
  res.json({
    status: job.status,
    phase: job.phase, scanned: job.scanned, target: job.target,
    count: job.vendors.length, vendors: job.status === "done" ? job.vendors : undefined,
    error: job.error, demo: job.demo === true,
  });
});

/* ---------------- demo vendors ---------------- */
app.get("/api/demo/vendors", (_req, res) => res.json({ demo: true, vendors: demoVendors() }));

/* ---------------- NUKE ---------------- */
app.post("/api/nuke", nukeLimiter, async (req, res) => {
  const { vendorIds, filterAction = "archive", dryRun = false, demo = false } = req.body || {};
  if (!Array.isArray(vendorIds) || vendorIds.length === 0) {
    return res.status(400).json({ error: "Select at least one vendor to exorcise." });
  }
  if (vendorIds.length > 400) {
    return res.status(400).json({ error: "Whoa — 400+ at once will hit Gmail's sending limits. Nuke in smaller batches." });
  }

  const useDemo = DEMO_MODE || demo === true || !oauthConfigured();
  // SAFETY: only vendors from the last real scan (or the demo list) can be
  // nuked — the client can never inject arbitrary addresses.
  const catalog = useDemo ? demoVendors() : req.session.vendors;
  const byId = new Map(catalog.map((v) => [v.id, v]));
  const vendors = [...new Set(vendorIds)].map((id) => byId.get(id)).filter(Boolean);
  if (vendors.length === 0) {
    return res.status(400).json({ error: "Those vendors aren't from your last scan. Scan again first." });
  }

  if (dryRun) return res.json({ dryRun: true, plan: dryRunPlan(vendors, filterAction) });

  const jobId = createNukeJob({ vendors, filterAction, demo: useDemo });
  if (useDemo) {
    runNukeJob(jobId, { simulate: true }).catch((e) => log("warn", { event: "demo_nuke_failed", message: clip(e.message, 120) }));
    return res.json({ jobId, demo: true });
  }

  if (!req.session.tokens) return res.status(401).json({ error: "Connect Gmail first.", code: "AUTH_REQUIRED" });
  const { client, gmail } = gmailFor(req.session.tokens);

  const deps = {
    sendEmail: async ({ to, subject, body }) => {
      const raw = buildRawUnsubscribeEmail({ to, subject, body, from: req.session.email });
      await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    },
    postUrl: async (url, body) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      try {
        const r = await fetch(url, {
          method: "POST", signal: ctrl.signal, redirect: "follow",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "inbox-exorcist/1.0" },
          body,
        });
        return { ok: r.ok, status: r.status };
      } finally { clearTimeout(t); }
    },
    getUrl: async (url) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      try {
        const r = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "inbox-exorcist/1.0" } });
        return { ok: r.ok, status: r.status };
      } finally { clearTimeout(t); }
    },
    createFilter: async (fromQuery, action) => {
      try {
        await client.getAccessToken();
      } catch (e) { throw reauthError(e); }
      const act = action === "delete" ? { deleteIt: true } : { removeLabelIds: ["INBOX"] };
      await gmail.users.settings.filters.create({
        userId: "me",
        requestBody: { criteria: { from: fromQuery }, action: act },
      });
    },
  };

  runNukeJob(jobId, deps).catch((e) => log("warn", { event: "nuke_job_failed", message: clip(e.message, 120) }));
  res.json({ jobId });
});

app.get("/api/nuke/progress/:jobId", (req, res) => {
  const job = getNukeJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Nuke job not found." });
  res.json(job);
});

/* ---------------- fallthroughs ---------------- */
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.get(/.*/, (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

/* eslint-disable no-unused-vars */
app.use((err, _req, res, _next) => {
  log("warn", { event: "unhandled", message: clip(err?.message || "unknown", 120) });
  res.status(500).json({ error: "Something spooky happened. Try again." });
});

app.listen(PORT, () => log("info", { event: "listening", port: PORT, demo: DEMO_MODE }));
