// Crafted by Vivek Nair (VN) — https://github.com/vivekn4
/**
 * Breach lookup via the free XposedOrNot API (no key required).
 *   GET https://api.xposedornot.com/v1/check-email/{email}
 *
 * Honest note: this checks the XposedOrNot breach corpus — a large public
 * aggregation — NOT "the entire internet". We say exactly that in the UI.
 */

const XON_BASE = "https://api.xposedornot.com/v1/check-email";
const TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 10 * 60 * 1000; // don't hammer the free API

const cache = new Map(); // email(lower) -> { ts, result }

export async function checkBreaches(email) {
  const key = String(email).trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return { ...hit.result, cached: true };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${XON_BASE}/${encodeURIComponent(key)}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "inbox-exorcist/1.0 (+https://github.com/vivekn4)" },
    });
    const data = await res.json().catch(() => ({}));

    let result;
    if (Array.isArray(data.breaches) && data.breaches.length > 0) {
      // XON shape: breaches: [[name, ...details], ...]
      const names = data.breaches.map((b) => (Array.isArray(b) ? b[0] : String(b)));
      result = {
        email: key,
        breached: true,
        count: names.length,
        breaches: names,
        source: "XposedOrNot public breach corpus",
      };
    } else {
      result = {
        email: key,
        breached: false,
        count: 0,
        breaches: [],
        source: "XposedOrNot public breach corpus",
        note: data.Error || "No breaches found for this email in the XposedOrNot corpus.",
      };
    }
    cache.set(key, { ts: Date.now(), result });
    return { ...result, cached: false };
  } catch (err) {
    return {
      email: key,
      breached: null,
      count: 0,
      breaches: [],
      error: err.name === "AbortError" ? "Breach lookup timed out — try again." : "Breach service unreachable — try again.",
    };
  } finally {
    clearTimeout(timer);
  }
}
