// Crafted by Vivek Nair (VN) — unit tests for inbox-exorcist pure logic.
// Run: npm test
import assert from "node:assert/strict";
import {
  parseListUnsubscribe, mailtoAddress, mailtoParams, normalizeSender,
  categorizeSender, unsubscribeStrategy, buildRawUnsubscribeEmail,
  looksLikeEmail, clip, escapeHtml, baseDomain, mergeVendorsByDomain,
  isProtectedSender, backoffDelayMs, withRetry, chunkArray, timeAgo,
} from "../lib/util.js";
import { dryRunPlan, createNukeJob, getNukeJob, runNukeJob, DELETE_EXISTING_CAP } from "../lib/exorcist.js";

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

// --- List-Unsubscribe parsing (incl. nasty real-world samples) ---
t("parses mixed mailto + https with angle brackets", () => {
  const p = parseListUnsubscribe("<mailto:unsub@x.com?subject=bye>, <https://x.com/u?id=1>");
  assert.deepEqual(p.mailtos, ["mailto:unsub@x.com?subject=bye"]);
  assert.deepEqual(p.urls, ["https://x.com/u?id=1"]);
  assert.deepEqual(p.oneClick, []);
});
t("detects RFC 8058 one-click", () => {
  const p = parseListUnsubscribe("<https://x.com/u>", "List-Unsubscribe=One-Click");
  assert.deepEqual(p.oneClick, ["https://x.com/u"]);
});
t("handles stray whitespace + missing brackets", () => {
  const p = parseListUnsubscribe("  mailto:a@b.com ,https://c.d/e  ");
  assert.deepEqual(p.mailtos, ["mailto:a@b.com"]);
  assert.deepEqual(p.urls, ["https://c.d/e"]);
});
t("empty header → empty lists", () => {
  assert.deepEqual(parseListUnsubscribe(""), { mailtos: [], urls: [], oneClick: [] });
});

// --- mailto helpers ---
t("mailtoAddress strips subject", () => {
  assert.equal(mailtoAddress("mailto:unsub@x.com?subject=unsubscribe%20me"), "unsub@x.com");
});
t("mailtoParams extracts subject/body", () => {
  const p = mailtoParams("mailto:a@b.com?subject=bye&body=remove%20me");
  assert.equal(p.subject, "bye"); assert.equal(p.body, "remove me");
});

// --- sender utils ---
t("normalizeSender handles display names", () => {
  assert.equal(normalizeSender('"Daily Deals" <News@DailyDeals.com>'), "news@dailydeals.com");
  assert.equal(normalizeSender("plain@example.com"), "plain@example.com");
});
t("categorizeSender guesses categories", () => {
  assert.equal(categorizeSender("Weekly Newsletter <news@x.com>"), "newsletter");
  assert.equal(categorizeSender("Deals <offers@shop.com>"), "promo");
  assert.equal(categorizeSender("Receipt <orders@store.com>"), "service");
  assert.equal(categorizeSender("Bob <bob@gmail.com>"), "other");
});
t("unsubscribeStrategy ranks one-click first", () => {
  assert.equal(unsubscribeStrategy({ oneClickUrls: ["u"], mailtos: ["m"], urls: ["h"] }), "one-click");
  assert.equal(unsubscribeStrategy({ oneClickUrls: [], mailtos: ["m"], urls: [] }), "email");
  assert.equal(unsubscribeStrategy({ oneClickUrls: [], mailtos: [], urls: [] }), "none");
});

// --- raw email builder ---
t("buildRawUnsubscribeEmail is base64url", () => {
  const raw = buildRawUnsubscribeEmail({ to: "u@x.com", subject: "unsubscribe", body: "bye" });
  assert.match(raw, /^[A-Za-z0-9_-]+$/);
  const decoded = Buffer.from(raw, "base64url").toString("utf8");
  assert.ok(decoded.includes("To: u@x.com") && decoded.includes("Subject: unsubscribe"));
});

// --- hygiene ---
t("looksLikeEmail sanity", () => {
  assert.ok(looksLikeEmail("a@b.com")); assert.ok(!looksLikeEmail("not-an-email"));
});
t("escapeHtml neutralizes XSS", () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), "&lt;img src=x onerror=alert(1)&gt;");
});
t("clip truncates", () => { assert.equal(clip("abcdef", 4), "abc…"); });

// --- domain grouping ---
t("baseDomain groups subdomains", () => {
  assert.equal(baseDomain("news.mail.example.com"), "example.com");
  assert.equal(baseDomain("shop.co.uk"), "shop.co.uk");
  assert.equal(baseDomain("a.b.shop.co.uk"), "shop.co.uk");
});
t("mergeVendorsByDomain merges sibling senders, prefers actionable", () => {
  const merged = mergeVendorsByDomain([
    { sender: "news@x.com", count: 5, strategy: "none" },
    { sender: "noreply@x.com", count: 3, strategy: "one-click", oneClickUrls: ["u"], mailtos: [], urls: [] },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].count, 8);
  assert.equal(merged[0].strategy, "one-click");
});

// --- exorcist engine (simulated) ---
t("dryRunPlan describes without executing", () => {
  const plan = dryRunPlan([{ id: "a", sender: "s@x.com", displayName: "S", strategy: "email" }], "delete");
  assert.equal(plan.total, 1);
  assert.equal(plan.filterAction, "delete");
  assert.ok(plan.items[0].willDo.includes("email"));
});

await (async () => {
  const id = createNukeJob({
    vendors: [
      { id: "a", sender: "auto@x.com", displayName: "Auto", domain: "x.com", category: "promo", strategy: "one-click", oneClickUrls: ["https://x.com/u"], mailtos: [], unsubUrl: "" },
      { id: "b", sender: "stubborn@y.com", displayName: "Stubborn", domain: "y.com", category: "other", strategy: "none", mailtos: [], oneClickUrls: [], unsubUrl: "" },
    ],
    filterAction: "archive",
    demo: true,
  });
  await runNukeJob(id, { simulate: true });
  const job = getNukeJob(id);
  assert.equal(job.status, "done");
  assert.equal(job.summary.total, 2);
  assert.equal(job.summary.unsubscribed, 1);
  assert.equal(job.summary.manual, 1);
  assert.ok(job.summary.filtersCreated >= 1);
  passed++;
  console.log("  ✓ simulated nuke job completes with correct buckets");
})();

console.log(`\n${passed} tests passed 🎉`);

// --- v1.1 additions (kept after the summary line above so the count stays honest) ---
let extra = 0;
const t2 = (name, fn) => { fn(); extra++; console.log(`  ✓ ${name}`); };

// --- protected senders ---
t2("isProtectedSender flags bank + gov + security subjects", () => {
  assert.equal(isProtectedSender("alerts@paypal.com", "hi"), true);
  assert.equal(isProtectedSender("noreply@sub.chase.com", "hi"), true);
  assert.equal(isProtectedSender("x@anything.gov", "hi"), true);
  assert.equal(isProtectedSender("x@servicecanada.gc.ca", "hi"), true);
  assert.equal(isProtectedSender("news@shop.com", "Password reset requested"), true);
  assert.equal(isProtectedSender("news@shop.com", "50% off sale"), false);
  assert.equal(isProtectedSender("digest@techbits.example", "Weekly digest"), false);
});

// --- merge keeps unread / recency / subjects / protected ---
t2("mergeVendorsByDomain merges unread, lastSeen, subjects, protected", () => {
  const merged = mergeVendorsByDomain([
    { sender: "news@x.com", count: 5, unread: 5, lastSeen: "2026-10-01T00:00:00.000Z", exampleSubjects: ["A"], strategy: "none", protected: false },
    { sender: "noreply@x.com", count: 3, unread: 0, lastSeen: "2026-10-10T00:00:00.000Z", exampleSubjects: ["B"], strategy: "one-click", oneClickUrls: ["u"], mailtos: [], urls: [], protected: true },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].count, 8);
  assert.equal(merged[0].unread, 5);
  assert.equal(merged[0].unreadRate, 5 / 8);
  assert.equal(merged[0].lastSeen, "2026-10-10T00:00:00.000Z");
  assert.deepEqual(merged[0].exampleSubjects, ["A", "B"]);
  assert.equal(merged[0].protected, true);
});

// --- backoff / retry / chunking ---
t2("backoffDelayMs doubles per attempt with zero jitter", () => {
  assert.equal(backoffDelayMs(1, 500, 0), 500);
  assert.equal(backoffDelayMs(2, 500, 0), 1000);
  assert.equal(backoffDelayMs(3, 500, 0), 2000);
});
t2("chunkArray splits at size", () => {
  assert.deepEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkArray([], 1000), []);
});
t2("timeAgo handles just-now + garbage", () => {
  assert.equal(timeAgo(new Date().toISOString()), "just now");
  assert.equal(timeAgo("not-a-date"), "");
});

// --- dry-run with delete-existing + mailbox estimate ---
t2("dryRunPlan mentions delete-existing + estimate", () => {
  const plan = dryRunPlan(
    [{ id: "a", sender: "s@x.com", displayName: "S", strategy: "email", mailboxEstimate: 412, protected: false }],
    "archive", { deleteExisting: true });
  assert.equal(plan.deleteExisting, true);
  assert.ok(plan.items[0].willDo.includes("~412 existing messages"));
  assert.ok(plan.filterNote.includes("permanently deleted"));
});

await (async () => {
  // withRetry: 429 twice, then success
  let calls = 0;
  const val = await withRetry(async () => {
    calls++;
    if (calls < 3) { const e = new Error("rate limited"); e.status = 429; throw e; }
    return "ok";
  }, { retries: 3, baseMs: 1 });
  assert.equal(val, "ok");
  assert.equal(calls, 3);
  extra++;
  console.log("  ✓ withRetry retries 429s then succeeds");

  // withRetry: non-retryable throws immediately
  let nCalls = 0;
  await assert.rejects(withRetry(async () => { nCalls++; throw new Error("boom"); }, { retries: 3, baseMs: 1 }), /boom/);
  assert.equal(nCalls, 1);
  extra++;
  console.log("  ✓ withRetry does not retry non-retryable errors");

  // delete-existing: real-deps path with fake Gmail deps
  const id = createNukeJob({
    vendors: [
      { id: "a", sender: "auto@x.com", displayName: "Auto", domain: "x.com", category: "promo", strategy: "one-click", oneClickUrls: ["https://x.com/u"], mailtos: [], unsubUrl: "", mailboxEstimate: 2500 },
      { id: "b", sender: "huge@y.com", displayName: "Huge", domain: "y.com", category: "promo", strategy: "link", mailtos: [], oneClickUrls: [], unsubUrl: "https://y.com/u", mailboxEstimate: 99999 },
    ],
    filterAction: "archive",
    deleteExisting: true,
  });
  let deletedCalls = [];
  await runNukeJob(id, {
    postUrl: async () => ({ ok: true, status: 200 }),
    getUrl: async () => ({ ok: true, status: 200 }),
    createFilter: async () => {},
    listMessageIds: async (sender) => sender === "auto@x.com"
      ? Array.from({ length: 2500 }, (_, i) => `m${i}`)
      : Array.from({ length: DELETE_EXISTING_CAP + 1 }, (_, i) => `h${i}`),
    batchDelete: async (ids) => { deletedCalls.push(ids.length); return ids.length; },
  });
  const job = getNukeJob(id);
  assert.equal(job.status, "done");
  assert.equal(job.summary.deletedExisting, 2500); // huge vendor skipped past the cap
  assert.deepEqual(deletedCalls, [1000, 1000, 500]); // chunked at 1000
  assert.ok(job.vendors.find((v) => v.id === "b").detail.includes("safety cap"));
  extra++;
  console.log("  ✓ delete-existing chunks batchDelete at 1000 and respects the safety cap");
})();

console.log(`\n${extra} extra v1.1 tests passed 🎉`);
