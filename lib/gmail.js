// Crafted by Vivek Nair (VN) — https://github.com/vivekn4
/**
 * Gmail layer for inbox-exorcist.
 * - OAuth2 (user's own free Google Cloud client id/secret via env)
 * - Vendor scan: page inbox, read ONLY metadata headers
 *   (From / Subject / List-Unsubscribe / List-Unsubscribe-Post).
 *   Message BODIES are never fetched and never logged — a trust feature.
 * - Vendors are grouped by registered domain (see lib/util.js baseDomain).
 */
import { google } from "googleapis";
import crypto from "node:crypto";
import {
  normalizeSender, categorizeSender, parseListUnsubscribe,
  unsubscribeStrategy, mergeVendorsByDomain, clip,
} from "./util.js";

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

export function oauthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri() {
  return (process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/auth/callback").trim();
}

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri()
  );
}

export function getAuthUrl(state) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: state || "",
  });
}

export async function exchangeCode(code) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

/** Build an authenticated gmail client from a session's stored tokens. */
export function gmailFor(tokens) {
  const client = oauthClient();
  client.setCredentials(tokens);
  return { client, gmail: google.gmail({ version: "v1", auth: client }) };
}

export async function getProfileEmail(tokens) {
  const { gmail } = gmailFor(tokens);
  const { data } = await gmail.users.getProfile({ userId: "me" });
  return data.emailAddress || "";
}

/** Small concurrency limiter for metadata fetches. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch { results[idx] = null; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results.filter(Boolean);
}

/** Collect up to `max` message ids across two passes (recent + promotions). */
async function collectMessageIds(gmail, max, onProgress) {
  const seen = new Set();
  const ids = [];
  // Pass 1: most recent mail (biases toward active senders).
  // Pass 2: category:promotions (Gmail's own bulk-mail bucket).
  const passes = ["", "category:promotions"];
  const perPass = Math.ceil(max / passes.length);

  for (const q of passes) {
    let pageToken;
    let got = 0;
    while (got < perPass) {
      const { data } = await gmail.users.messages.list({
        userId: "me",
        q,
        maxResults: Math.min(100, perPass - got),
        pageToken,
        includeSpamTrash: false,
      });
      const msgs = data.messages || [];
      for (const m of msgs) {
        if (!seen.has(m.id) && ids.length < max) { seen.add(m.id); ids.push(m.id); }
      }
      got += msgs.length;
      onProgress && onProgress({ phase: "listing", scanned: ids.length, target: max });
      pageToken = data.nextPageToken;
      if (!pageToken || msgs.length === 0) break;
    }
  }
  return ids;
}

const META_HEADERS = ["From", "Subject", "List-Unsubscribe", "List-Unsubscribe-Post"];

function header(payload, name) {
  const h = (payload.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

/**
 * Scan the inbox and return vendor records.
 * ONLY senders advertising a List-Unsubscribe header are included —
 * personal mail never appears in the list.
 */
export async function scanVendors(tokens, max = 300, onProgress) {
  const { client, gmail } = gmailFor(tokens);
  await client.getAccessToken().catch((e) => { throw reauthError(e); });

  const ids = await collectMessageIds(gmail, Math.min(Math.max(max, 1), 500), onProgress);

  const perSender = new Map();
  let fetched = 0;
  await mapLimit(ids, 10, async (id) => {
    const { data } = await gmail.users.messages.get({
      userId: "me", id, format: "metadata", metadataHeaders: META_HEADERS,
    });
    const listUnsub = header(data.payload || {}, "List-Unsubscribe");
    if (!listUnsub) return; // safety rule: no unsubscribe signal → not a vendor
    const from = header(data.payload || {}, "From");
    const sender = normalizeSender(from);
    if (!sender.includes("@")) return;

    const parsed = parseListUnsubscribe(listUnsub, header(data.payload || {}, "List-Unsubscribe-Post"));
    const entry = perSender.get(sender) || {
      sender,
      displayName: clip(from.split("<")[0].trim().replace(/^"|"$/g, "") || sender, 60),
      count: 0,
      mailtos: [], urls: [], oneClickUrls: [],
      sampleSubject: clip(header(data.payload || {}, "Subject"), 100),
    };
    entry.count += 1;
    for (const m of parsed.mailtos) if (!entry.mailtos.includes(m)) entry.mailtos.push(m);
    for (const u of parsed.urls) if (!entry.urls.includes(u)) entry.urls.push(u);
    for (const o of parsed.oneClickUrls) if (!entry.oneClickUrls.includes(o)) entry.oneClickUrls.push(o);
    perSender.set(sender, entry);

    fetched += 1;
    if (fetched % 10 === 0) onProgress && onProgress({ phase: "reading", scanned: fetched, target: ids.length });
  });

  const vendors = [...perSender.values()].map((v) => ({
    id: crypto.createHash("sha1").update(v.sender).digest("hex").slice(0, 12),
    sender: v.sender,
    domain: v.sender.split("@")[1] || "",
    displayName: v.displayName,
    count: v.count,
    category: categorizeSender(`${v.displayName} ${v.sender}`),
    strategy: unsubscribeStrategy(v),
    mailtos: v.mailtos.slice(0, 3),
    urls: v.urls.slice(0, 3),
    oneClickUrls: v.oneClickUrls.slice(0, 3),
    unsubUrl: v.oneClickUrls[0] || v.urls[0] || "",
    sampleSubject: v.sampleSubject,
  }));

  return mergeVendorsByDomain(vendors);
}

export function reauthError(cause) {
  const err = new Error("Gmail authorization expired or was revoked — please reconnect.");
  err.code = "REAUTH_REQUIRED";
  err.cause = cause;
  return err;
}

/** Mock vendors for demo mode (GET /api/demo/vendors + simulated nukes). */
export function demoVendors() {
  const mk = (sender, displayName, count, category, strategy, extra = {}) => ({
    id: crypto.createHash("sha1").update(sender).digest("hex").slice(0, 12),
    sender, domain: sender.split("@")[1], displayName, count, category, strategy,
    mailtos: [], urls: [], oneClickUrls: [],
    unsubUrl: "",
    sampleSubject: "Your weekly update is here",
    ...extra,
  });
  return [
    mk("news@dailydeals.example", "Daily Deals", 48, "promo", "one-click", { oneClickUrls: ["https://dailydeals.example/unsub?one-click=1"], unsubUrl: "https://dailydeals.example/unsub?one-click=1" }),
    mk("noreply@shopmart.example", "ShopMart", 31, "promo", "email", { mailtos: ["mailto:unsubscribe@shopmart.example?subject=unsubscribe"] }),
    mk("digest@techbits.example", "TechBits Digest", 26, "newsletter", "one-click", { oneClickUrls: ["https://techbits.example/api/unsub"], unsubUrl: "https://techbits.example/api/unsub" }),
    mk("offers@flycheap.example", "FlyCheap Airlines", 19, "promo", "link", { urls: ["https://flycheap.example/email/unsubscribe"], unsubUrl: "https://flycheap.example/email/unsubscribe" }),
    mk("hello@morningbrew.example", "Morning Brew-ish", 15, "newsletter", "one-click", { oneClickUrls: ["https://morningbrew.example/unsubscribe"], unsubUrl: "https://morningbrew.example/unsubscribe" }),
    mk("deals@couponhunter.example", "Coupon Hunter", 12, "promo", "email", { mailtos: ["mailto:remove@couponhunter.example"] }),
    mk("updates@socialzap.example", "SocialZap", 9, "social", "link", { urls: ["https://socialzap.example/settings/email"], unsubUrl: "https://socialzap.example/settings/email" }),
    mk("newsletter@gamedev.example", "GameDev Weekly", 7, "newsletter", "none"),
    mk("noreply@stubborn.example", "Stubborn Corp", 5, "other", "none"),
  ];
}
