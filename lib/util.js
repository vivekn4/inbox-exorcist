// Crafted by Vivek Nair (VN) — https://github.com/vivekn4
/**
 * inbox-exorcist — pure utility functions (no I/O, fully unit-testable).
 */

/**
 * Parse a List-Unsubscribe header value into actionable methods.
 * Returns: { mailtos: string[], urls: string[], oneClick: string[] }
 * RFC 2369 (mailto:/http:) + RFC 8058 (List-Unsubscribe-Post one-click).
 */
export function parseListUnsubscribe(listUnsub = "", listUnsubPost = "") {
  const mailtos = [];
  const urls = [];
  const oneClick = [];
  const parts = String(listUnsub || "")
    .split(",")
    .map((p) => p.trim().replace(/^<|>$/g, ""));

  for (const part of parts) {
    if (/^mailto:/i.test(part)) mailtos.push(part);
    else if (/^https?:/i.test(part)) urls.push(part);
  }

  // RFC 8058 one-click: server POSTs to the URL(s) when the
  // List-Unsubscribe-Post header advertises "List-Unsubscribe=One-Click".
  const post = String(listUnsubPost || "").toLowerCase();
  if (post.includes("list-unsubscribe=one-click")) {
    for (const u of urls) oneClick.push(u);
  }
  return { mailtos, urls, oneClick };
}

/** Extract the address from a mailto: URI (drops subject= etc.). */
export function mailtoAddress(mailtoUri = "") {
  const m = String(mailtoUri)
    .replace(/^mailto:/i, "")
    .split("?")[0]
    .trim();
  return decodeURIComponent(m);
}

/** Extract subject/body overrides from a mailto: URI, if present. */
export function mailtoParams(mailtoUri = "") {
  const out = { subject: "", body: "" };
  try {
    const q = String(mailtoUri).split("?")[1];
    if (!q) return out;
    const params = new URLSearchParams(q);
    out.subject = params.get("subject") || "";
    out.body = params.get("body") || "";
  } catch {
    /* ignore malformed */
  }
  return out;
}

/** Normalize "Name <addr@x.com>" -> "addr@x.com". */
export function normalizeSender(fromHeader = "") {
  const m = String(fromHeader).match(/<([^<>@\s]+@[^<>\s]+)>/);
  if (m) return m[1].toLowerCase();
  const bare = String(fromHeader).trim().match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
  return bare ? bare[0].toLowerCase() : String(fromHeader).trim().toLowerCase();
}

/** Guess a vendor category from the sender address + display name. */
export function categorizeSender(fromHeader = "") {
  const s = String(fromHeader).toLowerCase();
  const has = (...words) => words.some((w) => s.includes(w));
  if (has("news", "newsletter", "digest", "bulletin", "weekly", "daily", "brief")) return "newsletter";
  if (has("receipt", "invoice", "billing", "order", "shipment", "tracking", "support", "notify", "alert", "security"))
    return "service";
  if (has("deal", "offer", "sale", "promo", "marketing", "shop", "store", "coupon", "discount", "clearance", "blackfriday"))
    return "promo";
  if (has("social", "update", "notification", "activity", "reminder")) return "social";
  return "other";
}

/** Decide the best automatic unsubscribe strategy for a vendor record. */
export function unsubscribeStrategy(vendor) {
  if (vendor.oneClickUrls && vendor.oneClickUrls.length) return "one-click";
  if (vendor.mailtos && vendor.mailtos.length) return "email";
  if (vendor.urls && vendor.urls.length) return "link";
  return "none";
}

/** Build a raw RFC 2822 message for Gmail API send (base64url). */
export function buildRawUnsubscribeEmail({ to, subject, body, from }) {
  const headers = [
    `To: ${to}`,
    `Subject: ${subject || "unsubscribe"}`,
    `From: ${from || to}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body || "Please unsubscribe this address from all mailing lists.",
  ].join("\r\n");
  return Buffer.from(headers, "utf8").toString("base64url");
}

/** Very small email sanity check (not a validator, just input hygiene). */
export function looksLikeEmail(v = "") {
  return /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(String(v).trim());
}

/** Clamp a string for safe display. */
export function clip(s = "", n = 120) {
  const t = String(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

/** Escape HTML special chars — vendor names/subjects must never be raw HTML. */
export function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Heuristic "registered domain" for grouping sibling senders
 * (news@x.com + noreply@x.com → one vendor card).
 * Takes the last two labels, unless the TLD pair looks like a
 * two-level public suffix (co.uk, com.au, …), in which case take three.
 * Documented heuristic — not a full public-suffix list.
 */
const TWO_LEVEL_SUFFIX = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "ltd.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "co.in", "co.jp", "co.za", "com.br", "co.kr",
  "com.mx", "co.id", "com.sg", "co.th",
]);

export function baseDomain(host = "") {
  const h = String(host).toLowerCase().trim().replace(/\.$/, "");
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return h;
  const lastTwo = parts.slice(-2).join(".");
  if (TWO_LEVEL_SUFFIX.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

/** Group vendor records by base domain, merging counts. */
export function mergeVendorsByDomain(vendors = []) {
  const byDomain = new Map();
  for (const v of vendors) {
    const domain = baseDomain((v.sender || "").split("@")[1] || "");
    if (!byDomain.has(domain)) {
      byDomain.set(domain, {
        ...v,
        domain,
        senders: [v.sender],
        count: v.count || 1,
        unread: v.unread || 0,
        exampleSubjects: [...(v.exampleSubjects || [])],
        protected: Boolean(v.protected),
      });
    } else {
      const g = byDomain.get(domain);
      g.count += v.count || 1;
      g.unread += v.unread || 0;
      if (!g.senders.includes(v.sender)) g.senders.push(v.sender);
      // Merge example subjects (up to 3 distinct), newest last-seen wins.
      for (const s of v.exampleSubjects || []) {
        if (s && !g.exampleSubjects.includes(s) && g.exampleSubjects.length < 3) g.exampleSubjects.push(s);
      }
      if (v.lastSeen && (!g.lastSeen || v.lastSeen > g.lastSeen)) g.lastSeen = v.lastSeen;
      if (v.protected) g.protected = true;
      if (v.sampleSubject && !g.sampleSubject) g.sampleSubject = v.sampleSubject;
      // Prefer the record with an actionable unsubscribe strategy.
      const rank = { "one-click": 0, email: 1, link: 2, none: 3 };
      if ((rank[v.strategy] ?? 3) < (rank[g.strategy] ?? 3)) {
        g.strategy = v.strategy;
        g.mailtos = v.mailtos; g.urls = v.urls; g.oneClickUrls = v.oneClickUrls;
        g.unsubUrl = v.unsubUrl;
      }
    }
  }
  const out = [...byDomain.values()];
  for (const g of out) g.unreadRate = g.count ? g.unread / g.count : 0;
  return out.sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------------ */
/* Protected senders — never bulk-nuked without an explicit opt-in.     */
/* Mechanism (re-implemented from the general idea used by peer tools): */
/* financial / government senders and security-subject mail are too    */
/* important to lose to one careless click. The check is a small       */
/* factual list + suffix rules + subject keywords — original code.     */
/* ------------------------------------------------------------------ */

/** Factual list of well-known financial/payment domains (exact or subdomain). */
const PROTECTED_DOMAINS = new Set([
  "paypal.com", "stripe.com", "venmo.com", "square.com", "cash.app",
  "coinbase.com", "chase.com", "bankofamerica.com", "wellsfargo.com",
  "americanexpress.com", "discover.com", "capitalone.com", "usbank.com",
  "pnc.com", "ally.com", "fidelity.com", "schwab.com", "vanguard.com",
  "irs.gov", "ssa.gov", "medicare.gov", "healthcare.gov", "usps.com",
  "canada.ca", "cra-arc.gc.ca", "servicecanada.gc.ca",
]);

/** Subject keywords that mark a message as security-sensitive. */
const SECURITY_SUBJECT_KEYWORDS = [
  "password reset", "security alert", "suspicious activity",
  "login attempt", "two-factor", "2fa", "one-time code", "otp",
  "verification code", "verify your", "authentication",
  "invoice", "receipt", "payment confirmation", "bank statement",
  "tax document", "account locked",
];

const PROTECTED_SUFFIXES = [".gov", ".mil", ".gc.ca", ".gov.uk", ".gov.au", ".gov.in"];

/**
 * Is this sender protected from bulk nuking?
 * @param {string} sender - full sender address
 * @param {string} subjectText - sample subject(s), for security-keyword checks
 */
export function isProtectedSender(sender = "", subjectText = "") {
  const host = (String(sender).split("@")[1] || "").toLowerCase();
  const domain = baseDomain(host);
  if (PROTECTED_DOMAINS.has(domain)) return true;
  // Suffixes must be tested against the FULL host: baseDomain() collapses
  // "servicecanada.gc.ca" to "gc.ca", which would miss a ".gc.ca" check.
  if (PROTECTED_SUFFIXES.some((s) => host.endsWith(s))) return true;
  const subj = String(subjectText || "").toLowerCase();
  return SECURITY_SUBJECT_KEYWORDS.some((k) => subj.includes(k));
}

/* ------------------------------------------------------------------ */
/* Retry + chunking helpers                                            */
/* ------------------------------------------------------------------ */

/** Exponential backoff delay (ms) for attempt N (1-based). jitter=0 for tests. */
export function backoffDelayMs(attempt = 1, baseMs = 500, jitter = 0.5) {
  const base = baseMs * 2 ** Math.max(0, attempt - 1);
  return Math.round(base * (1 + (Math.random() * 2 - 1) * jitter));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run fn() with retries on rate-limit / transient errors (HTTP 403/429,
 * or errors whose message mentions rate limiting). Non-retryable errors
 * throw immediately. Original helper — same idea as every API client,
 * implemented here for the Gmail metadata fetch.
 */
export async function withRetry(fn, { retries = 3, baseMs = 500 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e?.code ?? e?.response?.status ?? e?.status;
      const msg = String(e?.message || "").toLowerCase();
      const retryable = status === 403 || status === 429 ||
        msg.includes("rate") || msg.includes("quota") || msg.includes("too many") ||
        msg.includes("econnreset") || msg.includes("socket hang up");
      if (!retryable || attempt > retries) throw e;
      await sleep(backoffDelayMs(attempt, baseMs));
    }
  }
  throw lastErr;
}

/** Split an array into chunks of at most `size`. */
export function chunkArray(arr = [], size = 1000) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Human "time ago" for a last-seen ISO date (e.g. "3d ago", "2h ago"). */
export function timeAgo(iso = "") {
  const t = Date.parse(iso);
  if (!t) return "";
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
