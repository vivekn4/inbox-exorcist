// Crafted by Vivek Nair (VN) — unit tests for inbox-exorcist pure logic.
// Run: npm test
import assert from "node:assert/strict";
import {
  parseListUnsubscribe, mailtoAddress, mailtoParams, normalizeSender,
  categorizeSender, unsubscribeStrategy, buildRawUnsubscribeEmail,
  looksLikeEmail, clip, escapeHtml, baseDomain, mergeVendorsByDomain,
} from "../lib/util.js";
import { dryRunPlan, createNukeJob, getNukeJob, runNukeJob } from "../lib/exorcist.js";

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
