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
import { mailtoAddress, mailtoParams, chunkArray } from "./util.js";

const jobs = new Map();
const FILTER_CHUNK = 15; // vendors per grouped Gmail filter
export const DELETE_EXISTING_CAP = 5000; // refuse to bulk-delete more than this per vendor

export function createNukeJob({ vendors, filterAction, demo = false, deleteExisting = false }) {
  const id = crypto.randomUUID();
  jobs.set(id, {
    id,
    status: "queued",
    filterAction: filterAction === "delete" ? "delete" : "archive",
    demo,
    deleteExisting: deleteExisting === true,
    vendors: vendors.map((v) => ({
      id: v.id, sender: v.sender, displayName: v.displayName,
      domain: v.domain, category: v.category, strategy: v.strategy,
      mailtos: v.mailtos || [], oneClickUrls: v.oneClickUrls || [],
      unsubUrl: v.unsubUrl || "",
      mailboxEstimate: v.mailboxEstimate ?? null,
      protected: Boolean(v.protected),
      status: "pending", // pending → working → done:*
      detail: "",
      deletedExisting: 0,
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
export function dryRunPlan(vendors, filterAction, { deleteExisting = false } = {}) {
  return {
    filterAction: filterAction === "delete" ? "delete" : "archive",
    deleteExisting: deleteExisting === true,
    total: vendors.length,
    items: vendors.map((v) => ({
      id: v.id, sender: v.sender, displayName: v.displayName,
      strategy: v.strategy,
      protected: Boolean(v.protected),
      mailboxEstimate: v.mailboxEstimate ?? null,
      willDo: (v.strategy === "none"
        ? "No automatic unsubscribe link found — will only filter future mail."
        : v.strategy === "one-click"
          ? "Will POST one-click unsubscribe, then filter future mail."
          : v.strategy === "email"
            ? "Will email the unsubscribe address, then filter future mail."
            : "Will open the unsubscribe link server-side, then filter future mail.")
        + (deleteExisting
          ? (v.mailboxEstimate != null
            ? ` Will ALSO permanently delete ~${v.mailboxEstimate} existing messages from this sender.`
            : " Will ALSO permanently delete this sender's existing messages.")
          : ""),
    })),
    filterNote: `Future mail from these senders will be ${filterAction === "delete" ? "deleted" : "archived (skipped from inbox)"} via grouped Gmail filters.`
      + (deleteExisting ? " Existing mail from them will be permanently deleted (Gmail batchDelete, 1000 per call)." : ""),
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
      if (job.deleteExisting) {
        v.deletedExisting = v.mailboxEstimate ?? 0;
        v.detail += ` Demo: deleted ${v.deletedExisting} existing messages.`;
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

  // Delete-existing-mail pass (opt-in only): remove the sender's mail that
  // is ALREADY in the mailbox, not just filter future mail. Per-vendor list
  // + Gmail batchDelete in 1000-message chunks. Skipped past the safety cap.
  let deletedExisting = 0;
  if (job.deleteExisting) {
    for (const v of job.vendors) {
      try {
        if (sim) {
          // Already accounted in the demo loop above.
          deletedExisting += v.deletedExisting || 0;
          continue;
        }
        if (!deps.listMessageIds || !deps.batchDelete) {
          v.detail += " Delete-existing requested but not supported by this server.";
          continue;
        }
        const ids = await deps.listMessageIds(v.sender);
        if (ids.length > DELETE_EXISTING_CAP) {
          v.detail += ` Skipped deleting existing mail: ${ids.length} messages exceeds the ${DELETE_EXISTING_CAP} safety cap.`;
          continue;
        }
        let n = 0;
        for (const chunk of chunkArray(ids, 1000)) {
          n += await deps.batchDelete(chunk);
        }
        v.deletedExisting = n;
        deletedExisting += n;
        v.detail += ` Deleted ${n} existing messages from this sender.`;
      } catch (e) {
        v.detail += ` Delete-existing failed: ${e.message}`;
      }
    }
  }

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
    deleteExisting: job.deleteExisting,
    deletedExisting,
    message: `${buckets.unsubscribed} exorcised outright, ${buckets.manual} need one manual click, ${buckets.failed} failed — but ${filtersCreated} grouped filter(s) now block ALL of their future mail.`
      + (job.deleteExisting ? ` ${deletedExisting} existing messages deleted.` : ""),
  };
}

// Housekeeping: drop finished jobs after an hour (memory hygiene).
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.finishedAt && job.finishedAt < cutoff) jobs.delete(id);
  }
}, 15 * 60 * 1000).unref();
