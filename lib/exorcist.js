// Crafted by Vivek Nair (VN) — https://github.com/vivekn4
/**
 * The exorcism engine. Given a list of selected vendors it:
 *   1. unsubscribes each one (RFC 8058 one-click POST, mailto email,
 *      or server-side GET of the unsubscribe link),
 *   2. then creates GROUPED Gmail filters — one filter per chunk of
 *      vendors using `from:{a OR b OR c}` — so future mail is archived
 *      or deleted even if a vendor ignores the unsubscribe.
 *
 * Jobs run in the background; the frontend polls getNukeJob(jobId).
 * Dependencies (sendEmail, createFilter, postUrl, getUrl) are injected so
 * the engine is unit-testable and demo mode can simulate everything.
 */
import crypto from "node:crypto";
import { mailtoAddress, mailtoParams } from "./util.js";

const jobs = new Map();
const FILTER_CHUNK = 15; // vendors per grouped Gmail filter

export function createNukeJob({ vendors, filterAction, demo = false }) {
  const id = crypto.randomUUID();
  jobs.set(id, {
    id,
    status: "queued",
    filterAction: filterAction === "delete" ? "delete" : "archive",
    demo,
    vendors: vendors.map((v) => ({
      id: v.id, sender: v.sender, displayName: v.displayName,
      domain: v.domain, category: v.category, strategy: v.strategy,
      mailtos: v.mailtos || [], oneClickUrls: v.oneClickUrls || [],
      unsubUrl: v.unsubUrl || "",
      status: "pending", // pending → working → done:* 
      detail: "",
    })),
    startedAt: Date.now(),
    finishedAt: null,
    summary: null,
  });
  return id;
}

export function getNukeJob(id) {
  return jobs.get(id) || null;
}

/** Dry-run: describe exactly what WOULD happen, touch nothing. */
export function dryRunPlan(vendors, filterAction) {
  return {
    filterAction: filterAction === "delete" ? "delete" : "archive",
    total: vendors.length,
    items: vendors.map((v) => ({
      id: v.id, sender: v.sender, displayName: v.displayName,
      strategy: v.strategy,
      willDo: v.strategy === "none"
        ? "No automatic unsubscribe link found — will only filter future mail."
        : v.strategy === "one-click"
          ? "Will POST one-click unsubscribe, then filter future mail."
          : v.strategy === "email"
            ? "Will email the unsubscribe address, then filter future mail."
            : "Will open the unsubscribe link server-side, then filter future mail.",
    })),
    filterNote: `Future mail from these senders will be ${filterAction === "delete" ? "deleted" : "archived (skipped from inbox)"} via grouped Gmail filters.`,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attemptUnsubscribe(v, deps) {
  // Returns { outcome: "unsubscribed" | "manual" | "failed", detail }
  try {
    if (v.strategy === "one-click" && v.oneClickUrls.length) {
      const res = await deps.postUrl(v.oneClickUrls[0], "List-Unsubscribe=One-Click");
      if (res.ok) return { outcome: "unsubscribed", detail: "One-click unsubscribe accepted." };
      return { outcome: "manual", detail: `Vendor rejected the one-click request (HTTP ${res.status}). Click: ${v.oneClickUrls[0]}` };
    }
    if (v.strategy === "email" && v.mailtos.length) {
      const uri = v.mailtos[0];
      const to = mailtoAddress(uri);
      const p = mailtoParams(uri);
      await deps.sendEmail({ to, subject: p.subject || "unsubscribe", body: p.body || "Please unsubscribe this address from all mailing lists." });
      return { outcome: "unsubscribed", detail: `Unsubscribe email sent to ${to}.` };
    }
    if (v.strategy === "link" && v.unsubUrl) {
      const res = await deps.getUrl(v.unsubUrl);
      if (res.ok) return { outcome: "unsubscribed", detail: "Unsubscribe link visited successfully." };
      return { outcome: "manual", detail: `Link visit failed (HTTP ${res.status}). Click: ${v.unsubUrl}` };
    }
    return { outcome: "manual", detail: "No automatic unsubscribe method found — filter will still block future mail." };
  } catch (e) {
    return { outcome: "failed", detail: `Unsubscribe attempt errored: ${e.message}` };
  }
}

/**
 * Run a nuke job in the background. Resolves when finished.
 * deps: { sendEmail, postUrl, getUrl, createFilter, simulate }
 */
export async function runNukeJob(id, deps) {
  const job = jobs.get(id);
  if (!job || job.status !== "queued") return;
  job.status = "running";

  const sim = deps.simulate === true;

  for (const v of job.vendors) {
    v.status = "working";
    if (sim) {
      await sleep(350 + Math.random() * 400); // theatrical pacing for demo mode
      if (v.strategy === "none") {
        v.status = "done:manual";
        v.detail = "Demo: no auto-unsubscribe link — future mail would be filtered.";
      } else if (v.sender.includes("stubborn")) {
        v.status = "done:manual";
        v.detail = "Demo: vendor ignored the request — filter is your shield. Click: https://stubborn.example/unsub";
      } else {
        v.status = "done:unsubscribed";
        v.detail = `Demo: unsubscribed via ${v.strategy}.`;
      }
      continue;
    }
    const r = await attemptUnsubscribe(v, deps);
    v.status = `done:${r.outcome}`;
    v.detail = r.detail;
  }

  // Grouped filters: one Gmail filter per chunk, `from:{a OR b OR …}`.
  // This is the real guarantee — it works even when vendors ignore us.
  const chunks = [];
  for (let i = 0; i < job.vendors.length; i += FILTER_CHUNK) {
    chunks.push(job.vendors.slice(i, i + FILTER_CHUNK));
  }
  let filtersCreated = 0;
  const filterErrors = [];
  for (const chunk of chunks) {
    const query = `from:{${chunk.map((v) => v.sender).join(" OR ")}}`;
    try {
      if (!sim) await deps.createFilter(query, job.filterAction);
      filtersCreated += 1;
    } catch (e) {
      filterErrors.push(`Filter for ${chunk.length} senders failed: ${e.message}`);
    }
  }
  if (sim) filtersCreated = chunks.length;

  const buckets = { unsubscribed: 0, manual: 0, failed: 0 };
  for (const v of job.vendors) {
    if (v.status === "done:unsubscribed") buckets.unsubscribed += 1;
    else if (v.status === "done:manual") buckets.manual += 1;
    else buckets.failed += 1;
  }

  job.status = "done";
  job.finishedAt = Date.now();
  job.summary = {
    total: job.vendors.length,
    ...buckets,
    filtersCreated,
    filterAction: job.filterAction,
    filterErrors,
    message: `${buckets.unsubscribed} exorcised outright, ${buckets.manual} need one manual click, ${buckets.failed} failed — but ${filtersCreated} grouped filter(s) now block ALL of their future mail.`,
  };
}

// Housekeeping: drop finished jobs after an hour (memory hygiene).
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}, 15 * 60 * 1000).unref();
