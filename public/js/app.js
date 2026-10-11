/* Crafted by Vivek Nair (VN) — INBOX EXORCIST frontend */
"use strict";

/* ---------------- tiny helpers ---------------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const state = { vendors: [], selected: new Set(), catFilter: "all", demo: false, report: null, breach: null };

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------------- SFX — all synthesized with WebAudio, zero assets ---------------- */
const SFX = (() => {
  let ctx = null;
  let muted = localStorage.getItem("ix_muted") === "1";
  const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());
  const now = () => ac().currentTime;
  const env = (g, t0, a, peak, d) => {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  };
  const tone = (freq, type, a, d, peak = 0.18, slideTo = null) => {
    if (muted) return;
    const t0 = now(), o = ac().createOscillator(), g = ac().createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + a + d);
    env(g, t0, a, peak, d);
    o.connect(g).connect(ac().destination);
    o.start(t0); o.stop(t0 + a + d + 0.05);
  };
  const noise = (a, d, peak = 0.22, filterFreq = 1200, slideTo = null) => {
    if (muted) return;
    const t0 = now(), len = Math.floor(ac().sampleRate * (a + d + 0.05));
    const buf = ac().createBuffer(1, len, ac().sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const src = ac().createBufferSource(); src.buffer = buf;
    const f = ac().createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(filterFreq, t0);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + a + d);
    const g = ac().createGain(); env(g, t0, a, peak, d);
    src.connect(f).connect(g).connect(ac().destination);
    src.start(t0); src.stop(t0 + a + d + 0.05);
  };
  return {
    get muted() { return muted; },
    toggle() { muted = !muted; localStorage.setItem("ix_muted", muted ? "1" : "0"); return muted; },
    unlock() { try { ac().resume(); } catch {} },
    blip()   { tone(660, "square", 0.01, 0.06, 0.06); },                       // hover
    tick()   { tone(880, "square", 0.005, 0.05, 0.1); tone(1320, "sine", 0.005, 0.07, 0.08); }, // checkbox
    riser()  { noise(0.55, 0.15, 0.14, 400, 5200); tone(110, "sawtooth", 0.5, 0.2, 0.1, 880); }, // NUKE charge
    zap()    { noise(0.02, 0.28, 0.3, 6000, 300); tone(1800, "sawtooth", 0.01, 0.25, 0.14, 120); }, // per-vendor kill
    sting()  { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, "triangle", 0.25, 1.1, 0.16), i * 160)); noise(0.4, 1.2, 0.06, 8000); }, // completion
    buzz()   { tone(140, "sawtooth", 0.02, 0.3, 0.16, 90); },                   // error
    alarm()  { [0, 1, 2].forEach((i) => setTimeout(() => { tone(520, "square", 0.02, 0.22, 0.14); setTimeout(() => tone(392, "square", 0.02, 0.22, 0.14), 260); }, i * 560)); }, // breached
    chime()  { tone(784, "sine", 0.05, 0.6, 0.14); setTimeout(() => tone(1174, "sine", 0.05, 0.8, 0.12), 180); }, // clean inbox
  };
})();

$("muteBtn").textContent = SFX.muted ? "🔇" : "🔊";
$("muteBtn").onclick = () => { SFX.unlock(); $("muteBtn").textContent = SFX.toggle() ? "🔇" : "🔊"; };
document.addEventListener("pointerdown", () => SFX.unlock(), { once: true });
document.addEventListener("mouseover", (e) => { if (e.target.closest(".btn,.chip,.nuke-btn")) SFX.blip(); });

/* ---------------- spirit-wisp particles ---------------- */
(() => {
  const cv = $("wisps"), cx = cv.getContext("2d");
  let W, H, wisps = [];
  const resize = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; };
  resize(); addEventListener("resize", resize);
  const spawn = () => ({
    x: Math.random() * W, y: H + 20, r: 1 + Math.random() * 3.2,
    vy: 0.25 + Math.random() * 0.7, vx: (Math.random() - 0.5) * 0.4,
    hue: Math.random() < 0.6 ? 145 : 275, life: 1, decay: 0.0015 + Math.random() * 0.003,
  });
  for (let i = 0; i < 70; i++) { const w = spawn(); w.y = Math.random() * H; wisps.push(w); }
  (function tick() {
    cx.clearRect(0, 0, W, H);
    for (const w of wisps) {
      w.x += w.vx + Math.sin(w.y * 0.02) * 0.3; w.y -= w.vy; w.life -= w.decay;
      if (w.y < -20 || w.life <= 0) Object.assign(w, spawn());
      cx.beginPath(); cx.arc(w.x, w.y, w.r, 0, 7);
      cx.fillStyle = `hsla(${w.hue},95%,62%,${Math.max(0, w.life) * 0.7})`;
      cx.shadowColor = `hsl(${w.hue},95%,62%)`; cx.shadowBlur = 12; cx.fill(); cx.shadowBlur = 0;
    }
    requestAnimationFrame(tick);
  })();
})();

/* ---------------- VFX helpers ---------------- */
function screenFlashShake() {
  $("flash").classList.add("on");
  document.body.classList.add("shake");
  setTimeout(() => { $("flash").classList.remove("on"); document.body.classList.remove("shake"); }, 180);
}

/* ---------------- breach check ---------------- */
let breachTimer = null;
$("emailInput").addEventListener("input", () => {
  clearTimeout(breachTimer);
  breachTimer = setTimeout(() => { if ($("emailInput").value.includes("@")) runBreach(); }, 1200); // debounced
});
$("breachBtn").onclick = runBreach;

async function runBreach() {
  const email = $("emailInput").value.trim();
  if (!/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(email)) { SFX.buzz(); $("breachResult").innerHTML = `<p style="color:var(--blood)">👆 Type a real email address first.</p>`; $("breachResult").classList.remove("hidden"); return; }
  $("breachBtn").disabled = true; $("breachBtn").textContent = "SCANNING…";
  $("breachResult").classList.remove("hidden");
  $("breachResult").innerHTML = `<p class="muted">👁️ Consulting the breach spirits…</p>`;
  try {
    const r = await fetch(`/api/breach?email=${encodeURIComponent(email)}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "lookup failed");
    state.breach = d;
    renderBreach(d);
    SFX[d.breached ? "alarm" : "chime"]();
    show("screen-breach");
  } catch (e) {
    SFX.buzz();
    $("breachResult").innerHTML = `<p style="color:var(--blood)">⚠️ ${esc(e.message)}</p>`;
  } finally {
    $("breachBtn").disabled = false; $("breachBtn").textContent = "SCAN FOR BREACHES";
  }
}

function renderBreach(d) {
  const shield = $("breachShield");
  if (d.breached) {
    shield.textContent = "💀"; shield.classList.add("bad");
    $("breachHeadline").innerHTML = `<span class="breach-big bad">${d.count}</span><br>BREACHES FOUND`;
    $("breachSub").textContent = `${d.email} appeared in ${d.count} known breach${d.count === 1 ? "" : "es"} in the XposedOrNot public corpus. Change those passwords, enable 2FA — then exorcise the spam below.`;
    $("breachList").classList.remove("hidden");
    $("breachList").innerHTML = "<h3>📜 Breach scroll</h3>" + d.breaches.map((b) => `<div class="breach-item">💀 <strong>${esc(b)}</strong></div>`).join("");
  } else {
    shield.textContent = "🛡️"; shield.classList.remove("bad");
    $("breachHeadline").innerHTML = `<span class="breach-big good">0</span><br>CLEAN`;
    $("breachSub").textContent = `${d.email} wasn't found in the XposedOrNot public breach corpus. Stay vigilant — now let's clean the inbox itself.`;
    $("breachList").classList.add("hidden");
  }
}
$("breachBack").onclick = () => show("screen-hero");
$("breachContinue").onclick = () => { show("screen-hero"); $("scanBtn")?.scrollIntoView({ behavior: "smooth", block: "center" }); };

/* ---------------- auth ---------------- */
async function refreshAuth() {
  try {
    const d = await (await fetch("/auth/status")).json();
    if (d.connected) {
      $("scanBtn").classList.remove("hidden");
      $("authNote").innerHTML = `✅ Connected as <strong>${esc(d.email)}</strong> — ready to hunt.`;
      $("connectBtn").textContent = "RECONNECT GMAIL";
      $("disconnectBtn").classList.remove("hidden");
    } else {
      $("authNote").textContent = d.oauthConfigured
        ? "Connect Gmail to scan your real inbox, or try demo mode."
        : "This server has no Gmail credentials configured — demo mode is the way.";
    }
  } catch { /* offline */ }
}
$("connectBtn").onclick = () => { SFX.tick(); location.href = "/auth/google"; };
$("demoBtn").onclick = () => { SFX.tick(); state.demo = true; startScan(true); };
$("disconnectBtn").onclick = async () => {
  await fetch("/auth/logout", { method: "POST" });
  $("disconnectBtn").classList.add("hidden");
  $("scanBtn").classList.add("hidden");
  $("authNote").textContent = "Disconnected. Tokens wiped from server memory.";
  SFX.tick();
};
$("scanBtn").onclick = () => { SFX.tick(); state.demo = false; startScan(false); };

/* ---------------- scan ---------------- */
async function startScan(demo) {
  show("screen-hero");
  $("scanProgress").classList.remove("hidden");
  $("scanBtn").disabled = true;
  try {
    const r = await fetch("/api/scan", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ demo, max: 300 }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "scan failed");
    pollScan(d.scanId);
  } catch (e) {
    SFX.buzz();
    $("scanLabel").textContent = "⚠️ " + e.message;
    $("scanBtn").disabled = false;
  }
}

async function pollScan(scanId) {
  const tickPoll = async () => {
    const d = await (await fetch(`/api/scan/status/${scanId}`)).json();
    if (d.status === "error") {
      SFX.buzz(); $("scanLabel").textContent = "⚠️ " + (d.error || "scan failed");
      $("scanBtn").disabled = false; return;
    }
    const pct = d.target ? Math.round((d.scanned / d.target) * 100) : 0;
    $("scanFill").style.width = Math.min(100, pct) + "%";
    $("scanLabel").textContent = d.demo ? "🎭 Conjuring demo demons…" : `🔍 ${d.phase === "reading" ? "Reading headers" : "Listing messages"}… ${d.scanned}/${d.target}`;
    if (d.status === "done") {
      state.vendors = d.vendors || [];
      state.demo = d.demo === true;
      state.selected = new Set(state.vendors.map((v) => v.id));
      $("scanBtn").disabled = false;
      $("scanProgress").classList.add("hidden");
      $("scanFill").style.width = "0%";
      if (!state.vendors.length) SFX.chime(); else SFX.zap();
      renderVendors();
      show("screen-vendors");
      return;
    }
    setTimeout(tickPoll, 1200);
  };
  tickPoll();
}

/* ---------------- vendor dashboard ---------------- */
const CATS = ["all", "newsletter", "promo", "social", "service", "other"];
const STRAT_LABEL = { "one-click": "⚡ 1-click", email: "✉️ email", link: "🔗 link", none: "🚫 manual" };

function renderVendors() {
  $("demonCount").textContent = state.vendors.length;
  $("pureMsg").classList.toggle("hidden", state.vendors.length > 0);
  $("vendorList").style.display = state.vendors.length ? "" : "none";

  $("catChips").innerHTML = CATS.map((c) =>
    `<button class="chip ${state.catFilter === c ? "on" : ""}" data-cat="${c}">${c === "all" ? "ALL" : c.toUpperCase()}</button>`).join("");
  $("catChips").querySelectorAll(".chip").forEach((ch) => {
    ch.onclick = () => { state.catFilter = ch.dataset.cat; SFX.tick(); renderVendors(); };
  });

  const list = state.vendors.filter((v) => state.catFilter === "all" || v.category === state.catFilter);
  $("vendorList").innerHTML = list.map((v) => `
    <label class="vendor-card" data-id="${esc(v.id)}">
      <input type="checkbox" ${state.selected.has(v.id) ? "checked" : ""} aria-label="Select ${esc(v.displayName)}">
      <span class="who"><strong>${esc(v.displayName)}</strong><small>${esc(v.sender)}${v.sampleSubject ? " · “" + esc(v.sampleSubject) + "”" : ""}</small></span>
      <span class="badge">${v.count}✉️</span>
      <span class="cattag ${esc(v.category)}">${esc(v.category)}</span>
      <span class="strategy">${STRAT_LABEL[v.strategy] || v.strategy}</span>
    </label>`).join("");
  $("vendorList").querySelectorAll(".vendor-card").forEach((card) => {
    const box = card.querySelector("input");
    box.addEventListener("change", () => {
      box.checked ? state.selected.add(card.dataset.id) : state.selected.delete(card.dataset.id);
      SFX.tick(); updateNukeBtn();
    });
  });
  updateNukeBtn();
}

function updateNukeBtn() {
  const n = state.selected.size;
  $("nukeCount").textContent = n;
  $("nukeBtn").disabled = n === 0;
}
$("selectAllBtn").onclick = () => { state.vendors.forEach((v) => state.selected.add(v.id)); SFX.tick(); renderVendors(); };
$("selectNoneBtn").onclick = () => { state.selected.clear(); SFX.tick(); renderVendors(); };

/* NUKE charge-up: hold 0.6s (accidental-press protection + drama) */
(() => {
  const btn = $("nukeBtn"), fill = btn.querySelector(".nuke-fill");
  let timer = null, start = 0;
  const cancel = () => { clearTimeout(timer); timer = null; fill.style.width = "0%"; };
  const frame = () => {
    if (!timer) return;
    const p = Math.min(1, (Date.now() - start) / 600);
    fill.style.width = (p * 100) + "%";
    if (p >= 1) { cancel(); openDryRun(); } else requestAnimationFrame(frame);
  };
  btn.addEventListener("pointerdown", (e) => {
    if (btn.disabled) return;
    e.preventDefault(); SFX.riser(); start = Date.now();
    timer = setTimeout(() => {}, 650); requestAnimationFrame(frame);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, cancel));
})();

/* ---------------- dry-run modal ---------------- */
async function openDryRun() {
  const ids = [...state.selected];
  const filterAction = document.querySelector('input[name="filterAction"]:checked').value;
  $("dryrunBody").innerHTML = `<p class="muted">🔮 Consulting the spirits…</p>`;
  $("dryrunModal").classList.remove("hidden");
  try {
    const r = await fetch("/api/nuke", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorIds: ids, filterAction, dryRun: true, demo: state.demo }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "dry run failed");
    const p = d.plan;
    $("dryrunBody").innerHTML = `
      <p><strong>${p.total} vendors</strong> will face the ritual:</p>
      ${p.items.map((i) => `<div class="dry-item">😈 <strong>${esc(i.displayName || i.sender)}</strong><br><span class="muted">${esc(i.willDo)}</span></div>`).join("")}
      <p class="muted" style="margin-top:12px">🛡️ ${esc(p.filterNote)}</p>
      ${ids.length > 400 ? `<p style="color:var(--blood)">⚠️ Over 400 at once hits Gmail sending limits — split into batches.</p>` : ""}`;
    $("dryrunConfirm").onclick = () => { $("dryrunModal").classList.add("hidden"); SFX.riser(); castNuke(ids, filterAction); };
  } catch (e) {
    SFX.buzz();
    $("dryrunBody").innerHTML = `<p style="color:var(--blood)">⚠️ ${esc(e.message)}</p>`;
  }
}
$("dryrunCancel").onclick = () => { $("dryrunModal").classList.add("hidden"); SFX.tick(); };

/* ---------------- exorcism ---------------- */
async function castNuke(ids, filterAction) {
  show("screen-nuke");
  $("nukeReport").classList.add("hidden");
  $("dlReportBtn").classList.add("hidden");
  $("nukeRestart").classList.add("hidden");
  $("nukeFeed").innerHTML = "";
  $("nukeFill").style.width = "0%";
  try {
    const r = await fetch("/api/nuke", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorIds: ids, filterAction, demo: state.demo }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "nuke failed");
    pollNuke(d.jobId, ids.length);
  } catch (e) {
    SFX.buzz();
    $("nukeFeed").innerHTML = `<li class="bad">⚠️ ${esc(e.message)}</li>`;
  }
}

async function pollNuke(jobId, total) {
  const seen = new Set();
  const tickPoll = async () => {
    const job = await (await fetch(`/api/nuke/progress/${jobId}`)).json();
    const done = job.vendors.filter((v) => v.status.startsWith("done")).length;
    $("nukeFill").style.width = Math.round((done / total) * 100) + "%";
    $("nukeCounter").textContent = `${done} / ${total} demons faced`;

    for (const v of job.vendors) {
      if (v.status.startsWith("done") && !seen.has(v.id)) {
        seen.add(v.id);
        const cls = v.status === "done:unsubscribed" ? "ok" : v.status === "done:manual" ? "warn" : "bad";
        const icon = v.status === "done:unsubscribed" ? "✅" : v.status === "done:manual" ? "⚠️" : "❌";
        const li = document.createElement("li");
        li.className = cls;
        li.innerHTML = `${icon} <strong>${esc(v.displayName)}</strong> — ${esc(v.detail)}`;
        $("nukeFeed").prepend(li);
        SFX.zap(); screenFlashShake();
      }
    }

    if (job.status === "done") { finishNuke(job); return; }
    setTimeout(tickPoll, 900);
  };
  tickPoll();
}

function finishNuke(job) {
  const s = job.summary;
  SFX.sting();
  $("holyburst").classList.remove("on");
  void $("holyburst").offsetWidth; // restart animation
  $("holyburst").classList.add("on");
  $("nukeCounter").textContent = `🎉 ${s.total} demons faced — inbox cleansed`;
  $("nukeReport").classList.remove("hidden");
  $("dlReportBtn").classList.remove("hidden");
  $("nukeRestart").classList.remove("hidden");

  const manual = job.vendors.filter((v) => v.status === "done:manual");
  $("nukeReport").innerHTML = `
    <h3>📜 EXORCISM REPORT</h3>
    <div>
      <span class="bucket ex">✅ ${s.unsubscribed} exorcised</span>
      <span class="bucket man">⚠️ ${s.manual} need 1 click</span>
      <span class="bucket fail">❌ ${s.failed} failed</span>
    </div>
    <p class="muted">${esc(s.message)}</p>
    ${s.filterErrors.length ? `<p style="color:var(--blood)">Filter errors: ${esc(s.filterErrors.join("; "))}</p>` : ""}
    ${manual.length ? `<h4>🔗 Finish these manually:</h4><ul>${manual.map((v) => {
      const url = (v.detail.match(/https?:\/\/[^\s)]+/) || [])[0];
      return `<li><strong>${esc(v.displayName)}</strong>${url ? ` — <a href="${esc(url)}" target="_blank" rel="noopener">unsubscribe link</a>` : ""}</li>`;
    }).join("")}</ul>` : ""}
    <p class="muted small">Even the stubborn ones can't reach you anymore — ${s.filtersCreated} grouped Gmail filter(s) ${s.filterAction === "delete" ? "delete" : "archive"} all their future mail.</p>`;

  state.report = job;
  // Remove nuked vendors from the dashboard so a re-scan feels fresh
  const gone = new Set(job.vendors.filter((v) => v.status === "done:unsubscribed").map((v) => v.id));
  state.vendors = state.vendors.filter((v) => !gone.has(v.id));
  state.selected.clear();
}
$("dlReportBtn").onclick = () => {
  const job = state.report; if (!job) return;
  const lines = [
    "INBOX EXORCIST — exorcism report", `Date: ${new Date().toISOString()}`, `Filter action: ${job.summary.filterAction}`,
    `Exorcised: ${job.summary.unsubscribed} | Need manual click: ${job.summary.manual} | Failed: ${job.summary.failed}`,
    `Grouped Gmail filters created: ${job.summary.filtersCreated}`, "",
    ...job.vendors.map((v) => `[${v.status.replace("done:", "").toUpperCase()}] ${v.displayName} <${v.sender}> — ${v.detail}`),
    "", "Crafted by Vivek Nair (VN) — https://github.com/vivekn4/inbox-exorcist",
  ];
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/plain" }));
  a.download = "inbox-exorcist-report.txt"; a.click();
  URL.revokeObjectURL(a.href); SFX.tick();
};
$("nukeRestart").onclick = () => { show("screen-hero"); SFX.tick(); };

/* ---------------- boot ---------------- */
refreshAuth();
if (new URLSearchParams(location.search).get("auth") === "ok") {
  setTimeout(() => { $("authNote").innerHTML = "✅ <strong>Gmail connected!</strong> Hit SCAN MY INBOX."; }, 400);
  history.replaceState(null, "", location.pathname);
}
