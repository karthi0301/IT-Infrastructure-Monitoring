// Renders the Overall Report from window.__REPORT__ (compact stats built by report/build.js).
// Everything is drawn as inline SVG/CSS so the downloaded file works offline, with no libraries.
(() => {
"use strict";
const R = window.__REPORT__, LOGO = window.__LOGOS__ || {};
const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- helpers ---------- */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n) => String(n).padStart(2, "0");
const clock = (t) => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const day = (t) => { const d = new Date(t); return `${d.getDate()} ${MON[d.getMonth()]}`; };
const stamp = (t) => `${day(t)}, ${clock(t)}`;
const dur = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return sec ? `${m}m ${sec}s` : `${m}m`;
  return `${sec}s`;
};
const ms = (v) => (v == null ? "—" : v < 1 ? "<1 ms" : `${v < 10 ? (Math.round(v * 10) / 10).toFixed(1) : Math.round(v)} ms`);
const pct = (v) => (v == null ? "—" : v >= 100 ? "100%" : `${(Math.round(v * 100) / 100).toFixed(2)}%`);
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const NICE = [12, 16, 20, 24, 32, 40, 48, 60, 80, 100, 120, 160, 200, 240, 320, 400, 600, 800, 1000];
const niceMax = (v) => { let k = 1; while (v > NICE[NICE.length - 1] * k) k *= 10; return NICE.find((n) => n * k >= v) * k; };

const TYPES = {
  server: { label: "Servers", one: "Server", color: "#a78bfa" },
  switch: { label: "Switches", one: "Switch", color: "#fbbf24" },
  ap: { label: "Access Points", one: "Access Point", color: "#67e8f9" },
  face: { label: "Face Devices", one: "Face Device", color: "#86efac" },
  printer: { label: "Printers", one: "Printer", color: "#fda4af" },
  wan: { label: "ISP Links", one: "ISP Link", color: "#38bdf8" },
};
const ORDER = ["server", "switch", "ap", "face", "printer", "wan"];
const ST = { up: ["Online", "#34d399"], warn: ["Degraded", "#f5a524"], down: ["Offline", "#f43f5e"], unknown: ["No data", "#8a97a8"] };
const RANK = { down: 0, warn: 1, unknown: 2, up: 3 };
const okColor = (a) => (a == null ? "#8a97a8" : a >= 99.5 ? "#34d399" : a >= 97 ? "#f5a524" : "#f43f5e");

const P = {
  server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  switch: '<rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3M12 12V8"/>',
  ap: '<path d="M5 13a10 10 0 0 1 14 0M8.5 16.5a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 20 0M12 20h.01"/>',
  face: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
  wan: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
  boxes: '<path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/><path d="m7 16.5-4.74-2.85M7 16.5l5-3M7 16.5v5.17"/><path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/><path d="m17 16.5-5-3M17 16.5l4.74-2.85M17 16.5v5.17"/><path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/><path d="M12 8 7.26 5.15M12 8l4.74-2.85M12 13.5V8"/>',
  ok: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
  x: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  bolt: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect width="12" height="8" x="6" y="14"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
};
const ico = (k, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k] || ""}</svg>`;
const typeIco = (t, size) => ico(t in P ? t : "server", size);

/* ---------- data ---------- */
const devs = R.devices;
// Headline device counts exclude ISP links (same as the live dashboard's "Total devices");
// ISP links are reported separately in their own section.
const coreDevs = devs.filter((d) => d.type !== "wan");
const ispCount = devs.length - coreDevs.length;
const N = coreDevs.length;
const cnt = (s) => coreDevs.filter((d) => d.status === s).length;
const span = R.end - R.start;
const totalChecks = sum(devs, (d) => d.total), failedChecks = sum(devs, (d) => d.failed);
const avail = totalChecks ? Math.round((10000 * (totalChecks - failedChecks)) / totalChecks) / 100 : null;
const downTotal = sum(devs, (d) => d.downMs);
const affected = devs.filter((d) => d.outageCount > 0);
const notHealthy = devs.filter((d) => d.status === "down" || d.status === "warn").sort((a, b) => RANK[a.status] - RANK[b.status]);
const xs = Array.from({ length: R.nb }, (_, i) => R.b0 + i * R.bucketMs);
const bucketLabel = (i) => `${clock(xs[i])} – ${clock(xs[i] + R.bucketMs)}`;

const byType = ORDER.map((t) => {
  const list = devs.filter((d) => d.type === t);
  if (!list.length) return null;
  const tot = sum(list, (d) => d.total), fl = sum(list, (d) => d.failed);
  const withAvg = list.filter((d) => d.avg != null);
  return { t, list, up: list.filter((d) => d.status === "up").length,
    avail: tot ? Math.round((10000 * (tot - fl)) / tot) / 100 : null,
    avg: withAvg.length ? sum(withAvg, (d) => d.avg) / withAvg.length : null };
}).filter(Boolean);

/* ---------- charts ---------- */
let cid = 0;
const CH = {};
function lineChart(o) {
  const id = `c${++cid}`;
  const w = o.w, h = o.h, pl = o.pl ?? 46, pr = o.pr ?? 12, pt = o.pt ?? 12, pb = o.pb ?? 24;
  const pw = w - pl - pr, ph = h - pt - pb, n = o.xs.length;
  const X = (i) => pl + (n > 1 ? (i / (n - 1)) * pw : pw / 2);
  const Y = (v) => pt + ph * (1 - Math.min(1, Math.max(0, (v - o.yMin) / (o.yMax - o.yMin))));
  const f = (v) => v.toFixed(1);
  let s = `<svg class="ch" data-c="${id}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(o.label || "chart")}"><defs>`;
  o.series.forEach((se, k) => { s += `<linearGradient id="${id}g${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${se.color}" stop-opacity=".4"/><stop offset="1" stop-color="${se.color}" stop-opacity="0"/></linearGradient>`; });
  s += "</defs>";
  for (let g = 0; g <= o.guides; g++) {
    const v = o.yMin + ((o.yMax - o.yMin) * g) / o.guides, y = Y(v);
    s += `<line class="gl" x1="${pl}" x2="${w - pr}" y1="${f(y)}" y2="${f(y)}"/><text class="ax" x="${pl - 8}" y="${f(y + 3.5)}" text-anchor="end">${o.yFmt(v)}</text>`;
  }
  const nt = Math.min(o.xTicks ?? 6, n);
  for (let k = 0; k < nt; k++) {
    const i = nt > 1 ? Math.round((k * (n - 1)) / (nt - 1)) : 0;
    s += `<text class="ax" x="${f(X(i))}" y="${h - 6}" text-anchor="${k === 0 && nt > 1 ? "start" : k === nt - 1 && nt > 1 ? "end" : "middle"}">${clock(o.xs[i])}</text>`;
  }
  if (o.bands) {
    const bw = n > 1 ? pw / (n - 1) : pw;
    o.bands.forEach((c, i) => {
      if (!c) return;
      const x0 = Math.max(pl, X(i) - bw / 2), x1 = Math.min(pl + pw, X(i) + bw / 2);
      s += `<rect class="band" x="${f(x0)}" y="${pt}" width="${f(x1 - x0)}" height="${ph}" fill="${c}"/>`;
    });
  }
  (o.thresholds || []).forEach((t) => {
    if (t.v < o.yMin || t.v > o.yMax) return;
    s += `<line class="th" x1="${pl}" x2="${w - pr}" y1="${f(Y(t.v))}" y2="${f(Y(t.v))}"/><text class="thl" x="${w - pr - 2}" y="${f(Y(t.v) - 4)}" text-anchor="end">${esc(t.label)}</text>`;
  });
  o.series.forEach((se, k) => {
    const segs = []; let cur = [];
    se.data.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([X(i), Y(v)]); });
    if (cur.length) segs.push(cur);
    const multi = segs.filter((sg) => sg.length > 1);
    const pts = (sg) => sg.map((p) => `${f(p[0])} ${f(p[1])}`).join("L");
    if (se.area && multi.length) {
      const base = pt + ph;
      s += `<path class="area" fill="url(#${id}g${k})" d="${multi.map((sg) => `M${f(sg[0][0])} ${base}L${pts(sg)}L${f(sg[sg.length - 1][0])} ${base}Z`).join("")}"/>`;
    }
    if (multi.length) s += `<path class="draw" pathLength="1" fill="none" stroke="${se.color}" stroke-width="${se.width || 2}" stroke-linecap="round" stroke-linejoin="round" ${se.opacity ? `opacity="${se.opacity}"` : ""} d="${multi.map((sg) => `M${pts(sg)}`).join("")}"/>`;
    segs.filter((sg) => sg.length === 1).forEach((sg) => { s += `<circle class="pt" cx="${f(sg[0][0])}" cy="${f(sg[0][1])}" r="3" fill="${se.color}"/>`; });
  });
  s += `<line class="guide" x1="0" x2="0" y1="${pt}" y2="${pt + ph}"/>`;
  o.series.forEach((se) => { if (!se.hideDot) s += `<circle class="dot" r="4" fill="${se.color}" cx="0" cy="0"/>`; });
  s += `<rect class="hit" x="${pl}" y="${pt}" width="${pw}" height="${ph}"/></svg>`;
  CH[id] = { w, pl, pr, pw, n, X, Y, o };
  return s;
}

const tipEl = document.createElement("div");
tipEl.className = "tip";
document.body.appendChild(tipEl);
let activeSvg = null;
const hideTip = () => { tipEl.classList.remove("on"); if (activeSvg) { activeSvg.classList.remove("on"); activeSvg = null; } };
document.addEventListener("pointermove", (e) => {
  const svg = e.target.closest && e.target.closest("svg.ch");
  if (!svg) return hideTip();
  const c = CH[svg.dataset.c];
  if (!c) return hideTip();
  const r = svg.getBoundingClientRect(), vx = ((e.clientX - r.left) * c.w) / r.width;
  if (vx < c.pl - 4 || vx > c.w - c.pr + 4) return hideTip();
  const i = c.n > 1 ? Math.max(0, Math.min(c.n - 1, Math.round(((vx - c.pl) / c.pw) * (c.n - 1)))) : 0;
  if (activeSvg && activeSvg !== svg) activeSvg.classList.remove("on");
  activeSvg = svg; svg.classList.add("on");
  const x = c.X(i), g = svg.querySelector(".guide");
  g.setAttribute("x1", x); g.setAttribute("x2", x);
  const dots = svg.querySelectorAll(".dot"); let k = 0;
  c.o.series.forEach((se) => { if (se.hideDot) return; const v = se.data[i], d = dots[k++]; if (!d) return; if (v == null) d.setAttribute("opacity", 0); else { d.setAttribute("opacity", 1); d.setAttribute("cx", x); d.setAttribute("cy", c.Y(v)); } });
  tipEl.innerHTML = c.o.tip(i);
  tipEl.classList.add("on");
  const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
  tipEl.style.left = `${e.clientX + 16 + tw > innerWidth ? e.clientX - tw - 14 : e.clientX + 16}px`;
  tipEl.style.top = `${Math.max(8, Math.min(innerHeight - th - 8, e.clientY - th / 2))}px`;
});
document.addEventListener("pointerleave", hideTip);
window.addEventListener("scroll", hideTip, { passive: true });

/* ---------- section builders ---------- */
const reveal = (d = 0) => `class="reveal" style="--d:${d}s"`;
const badge = (st, extra = "") => `<span class="badge" style="--c:${ST[st][1]}">${ST[st][0]}${extra}</span>`;

function heroHtml() {
  const ok = !notHealthy.length && !devs.some((d) => d.outageCount && d.status !== "up");
  const c = !N || !totalChecks ? "#8a97a8" : notHealthy.some((d) => d.status === "down") ? "#f43f5e" : notHealthy.length ? "#f5a524" : "#34d399";
  const verdict = !N ? "No devices monitored yet"
    : !totalChecks ? "Waiting for ping data"
    : notHealthy.length ? `${notHealthy.length} device${notHealthy.length > 1 ? "s" : ""} need attention right now`
    : "All systems operational";
  const parts = [];
  if (N && totalChecks) {
    parts.push(`Across <b>${N}</b> monitored devices${ispCount ? ` and <b>${ispCount}</b> ISP link${ispCount > 1 ? "s" : ""}` : ""}, overall availability was <b>${pct(avail)}</b> over the last <b>${dur(span)}</b>.`);
    parts.push(R.incidentTotal
      ? `<b>${R.incidentTotal}</b> outage${R.incidentTotal > 1 ? "s were" : " was"} recorded on <b>${affected.length}</b> device${affected.length > 1 ? "s" : ""}, with <b>${dur(downTotal)}</b> of total downtime.`
      : "No outages were recorded in this period.");
    const worst = devs.filter((d) => d.uptime != null && d.uptime < 100).sort((a, b) => a.uptime - b.uptime)[0];
    if (worst) parts.push(`Lowest availability: <b>${esc(worst.name)}</b> (${pct(worst.uptime)}).`);
    const slow = devs.filter((d) => d.avg != null).sort((a, b) => b.avg - a.avg)[0];
    if (slow) parts.push(`Highest average latency: <b>${esc(slow.name)}</b> (${ms(slow.avg)}).`);
  } else if (N) parts.push("Monitoring has just started, so there is not enough ping history to summarise yet.");
  return `<header class="hero reveal">
    <div class="hero-top">
      <div class="logos">${LOGO.iljin ? `<img src="${LOGO.iljin}" alt="ILJIN">` : ""}${LOGO.iljin && LOGO.amber ? '<span class="sep"></span>' : ""}${LOGO.amber ? `<img class="amber" src="${LOGO.amber}" alt="Amber">` : ""}</div>
      <div class="noprint"><button class="btn" id="btnPrint">${ico("print", 15)} Print / Save as PDF</button></div>
    </div>
    <div class="eyebrow"><span class="dot"></span>Overall network report</div>
    <h1>ILJIN IT Network Operations</h1>
    <p class="period"><b>${stamp(R.start)}</b> → <b>${stamp(R.end)}</b> &nbsp;·&nbsp; ${dur(span)} of ping data &nbsp;·&nbsp; Generated ${stamp(R.generated)}</p>
    <div class="verdict" style="--c:${c}">${ico(ok && N && totalChecks ? "ok" : "warn", 17)}${verdict}</div>
    ${parts.length ? `<p class="summary">${parts.join(" ")}</p>` : ""}
  </header>`;
}

function overviewHtml() {
  const C = 2 * Math.PI * 78, gc = okColor(avail), off = C * (1 - (avail ?? 0) / 100);
  const kpi = (l, v, c, icon, sub, attr = "data-count", sm = "") =>
    `<div class="kpi reveal" style="--c:${c};--d:${sub[1]}s"><span class="ic">${ico(icon, 20)}</span><div class="l">${l}</div><div class="v ${sm}" ${attr}="${v[0]}">${v[1]}</div><div class="s">${sub[0]}</div></div>`;
  return `<div class="row overview">
    <div class="card gauge-card reveal" style="--d:.05s;--c:${gc}">
      <h2 style="align-self:flex-start">Overall availability</h2>
      <div class="gauge"><svg viewBox="0 0 200 200"><circle class="bg" cx="100" cy="100" r="78"/><circle class="fg" cx="100" cy="100" r="78" style="--C:${C.toFixed(2)};--off:${off.toFixed(2)}"/></svg>
        <div class="val"><b ${avail == null ? "" : `data-count="${avail}" data-dec="2" data-suffix="%"`}>${avail == null ? "—" : `${avail.toFixed(2)}%`}</b><span>uptime</span></div></div>
      <div class="sub">${totalChecks.toLocaleString("en-IN")} checks · ${failedChecks.toLocaleString("en-IN")} missed</div>
    </div>
    <div class="kpis">
      ${kpi("Monitored", [N, N], "#38bdf8", "boxes", [`${byType.filter((g) => g.t !== "wan").length} categories${ispCount ? ` · +${ispCount} ISP link${ispCount > 1 ? "s" : ""}` : ""}`, 0.1])}
      ${kpi("Online", [cnt("up"), cnt("up")], "#34d399", "ok", ["right now", 0.16])}
      ${kpi("Degraded", [cnt("warn"), cnt("warn")], "#f5a524", "warn", ["slow response", 0.22])}
      ${kpi("Offline", [cnt("down"), cnt("down")], "#f43f5e", "x", ["not responding", 0.28])}
      ${kpi("Total downtime", [downTotal, dur(downTotal)], downTotal ? "#f43f5e" : "#34d399", "clock", ["all devices combined", 0.34], "data-dur", "sm")}
      ${kpi("Outages", [R.incidentTotal, R.incidentTotal], R.incidentTotal ? "#f5a524" : "#34d399", "bolt", [`${affected.length} device${affected.length === 1 ? "" : "s"} affected`, 0.4])}
    </div>
  </div>`;
}

function chartsRowHtml() {
  const C = 2 * Math.PI * 52;
  const segs = ["up", "warn", "down", "unknown"].map((s) => [s, cnt(s)]).filter(([, n]) => n);
  let acc = 0;
  const donut = segs.map(([s, n], i) => {
    const len = (n / N) * C, o = -acc; acc += len;
    return `<circle class="seg" cx="85" cy="85" r="52" stroke="${ST[s][1]}" style="--C:${C.toFixed(2)};--len:${Math.max(0, len - (segs.length > 1 ? 2 : 0)).toFixed(2)};--gap:${(C - len + (segs.length > 1 ? 2 : 0)).toFixed(2)};--d:${(0.2 + i * 0.25).toFixed(2)}s" stroke-dashoffset="${o.toFixed(2)}"/>`;
  }).join("");
  const legend = ["up", "warn", "down", "unknown"].map((s) => `<div style="--c:${ST[s][1]}"><i></i>${ST[s][0]}<b>${cnt(s)}</b></div>`).join("");
  const cats = byType.map((g, i) => `<div class="cat" style="--c:${TYPES[g.t].color}">
      <span class="ico">${typeIco(g.t, 17)}</span>
      <div><div class="cat-top"><b>${TYPES[g.t].label}</b><span class="mono dim" style="font-size:11.5px">${g.up}/${g.list.length} online</span></div>
        <div class="bar"><i style="--w:${g.avail ?? 0}%;--c:${okColor(g.avail)};--d:${(0.15 + i * 0.08).toFixed(2)}s"></i></div></div>
      <div class="cat-r mono">${pct(g.avail)}<small>avg ${ms(g.avg)}</small></div></div>`).join("");
  return `<div class="row charts">
    <div class="card reveal" style="--d:.05s"><h2>Status right now</h2>
      <div class="donut-wrap"><div class="donut"><svg viewBox="0 0 170 170"><circle class="track" cx="85" cy="85" r="52"/>${donut}</svg><div class="mid"><b>${N}</b><span>devices</span></div></div><div class="legend">${legend}</div></div></div>
    <div class="card reveal" style="--d:.12s"><h2>Availability by category</h2><div class="cats">${cats || '<div class="dim">No devices.</div>'}</div></div>
  </div>`;
}

function fleetHtml() {
  const vals = R.fleet.filter((v) => v != null);
  if (!vals.length) return "";
  const minV = Math.min(...vals), lo = Math.min(95, Math.max(0, Math.floor((minV - 2) / 5) * 5));
  const minI = R.fleet.indexOf(minV);
  const chart = lineChart({
    w: 1130, h: 250, xs, yMin: lo, yMax: 100, guides: 4, yFmt: (v) => `${Math.round(v * 10) / 10}%`, label: "Network availability over time",
    series: [{ color: "#34d399", data: R.fleet, area: true, width: 2.4 }],
    bands: R.fleet.map((v) => (v == null ? null : v < 98 ? "#f43f5e3a" : v < 99.5 ? "#f5a52428" : null)),
    tip: (i) => `<div class="t">${bucketLabel(i)}</div><div class="l" style="--c:#34d399"><i></i>Availability<b>${pct(R.fleet[i])}</b></div>`,
  });
  return `<section id="overview"><div class="card reveal"><h2>Network availability over time<span class="r">${minV < 100 ? `Lowest: <b style="color:var(--text)">${pct(minV)}</b> at ${clock(xs[minI])}` : "No dips recorded"} · each point = ${dur(R.bucketMs)}</span></h2>
    <div class="chart wide">${chart}</div></div></section>`;
}

const WCOL = ["#38bdf8", "#a78bfa", "#34d399", "#f5a524"];
function ispHtml() {
  const wans = devs.filter((d) => d.type === "wan");
  if (!wans.length) return "";
  const series = wans.map((d, k) => ({ name: d.name, color: WCOL[k % WCOL.length], data: d.b.map((b) => b[0]), area: k === 0, width: 2.2 }));
  const maxV = Math.max(20, ...series.flatMap((s) => s.data.filter((v) => v != null)));
  const yMax = niceMax(maxV * 1.2);
  const hasData = series.some((s) => s.data.some((v) => v != null));
  const chart = !hasData ? "" : lineChart({
    w: 1130, h: 230, xs, yMin: 0, yMax, guides: 4, yFmt: (v) => `${Math.round(v)} ms`, label: "ISP latency comparison",
    series, thresholds: [{ v: wans[0].warn, label: `slow above ${wans[0].warn} ms` }],
    tip: (i) => `<div class="t">${bucketLabel(i)}</div>${wans.map((d, k) => `<div class="l" style="--c:${WCOL[k % WCOL.length]}"><i></i>${esc(d.name)}<b>${d.b[i][3] ? (d.b[i][0] == null ? "down" : ms(d.b[i][0])) : "—"}</b></div>`).join("")}`,
  });
  const cards = wans.map((d, k) => {
    const met = d.slaTarget == null || d.uptime == null ? null : d.uptime >= d.slaTarget;
    return `<div class="card isp-card reveal" style="--c:${WCOL[k % WCOL.length]};--d:${0.05 + k * 0.08}s">
      <div class="isp-top"><span class="ico" style="--c:${WCOL[k % WCOL.length]}">${ico("wan", 18)}</span><div><b>${esc(d.name)}</b><small class="mono">${esc(d.ip)}</small></div>${badge(d.status)}</div>
      <div class="mini"><div><small>Availability</small><b style="color:${okColor(d.uptime)}">${pct(d.uptime)}</b></div><div><small>Avg latency</small><b>${ms(d.avg)}</b></div><div><small>Downtime</small><b>${d.downMs ? dur(d.downMs) : "None"}</b></div></div>
      ${met == null ? "" : `<div class="sla-row"><small>SLA target ${d.slaTarget}%</small><span class="sla-badge ${met ? "met" : "breach"}">${met ? "Met" : "Breached"}</span></div>`}</div>`;
  }).join("");
  return `<section id="isp"><div class="sec-head"><h2>Internet / ISP links</h2><a class="btn sla-dl noprint" href="/api/report/isp-sla.csv" download>${ico("download", 14)} ISP SLA report (.csv)</a></div>
    <div class="isp">${cards}</div>
    ${hasData ? `<div class="card reveal"><h2>ISP latency comparison</h2>
      <div class="chart-legend">${series.map((s) => `<span style="--c:${s.color}"><i></i>${esc(s.name)}</span>`).join("")}</div>
      <div class="chart wide">${chart}</div></div>` : ""}</section>`;
}

function rankHtml() {
  const dt = devs.filter((d) => d.downMs > 0).sort((a, b) => b.downMs - a.downMs).slice(0, 8);
  const lat = devs.filter((d) => d.avg != null).sort((a, b) => b.avg - a.avg).slice(0, 8);
  const maxD = dt[0]?.downMs || 1, maxL = lat[0]?.avg || 1;
  const rows = (list, val, fmt, color) => list.map((d, i) => `<div class="rank-row"><span class="n">${i + 1}</span>
      <div><div class="nm"><span>${esc(d.name)}</span><small>${esc(d.detail || TYPES[d.type]?.one || "")}</small></div><div class="bar"><i style="--w:${Math.max(3, (val(d) / (val(list[0]) || 1)) * 100).toFixed(1)}%;--c:${color(d)};--d:${(0.1 + i * 0.07).toFixed(2)}s"></i></div></div>
      <span class="v">${fmt(d)}</span></div>`).join("");
  return `<div class="row two" style="margin-top:16px">
    <div class="card reveal" style="--d:.05s"><h2>Most downtime</h2>${dt.length
      ? `<div class="rank">${rows(dt, (d) => d.downMs, (d) => dur(d.downMs), () => "#f43f5e")}</div>`
      : `<div class="clear"><span class="tick"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></span><div><b>No downtime recorded</b>Every device stayed reachable for the whole period.</div></div>`}</div>
    <div class="card reveal" style="--d:.12s"><h2>Highest average latency</h2>${lat.length
      ? `<div class="rank">${rows(lat, (d) => d.avg, (d) => ms(d.avg), (d) => (d.avg > d.warn ? "#f5a524" : "#38bdf8"))}</div>`
      : '<div class="dim">No latency data yet.</div>'}</div>
  </div>`;
}

function incidentsHtml() {
  const now = notHealthy.length
    ? `<div class="now">${notHealthy.map((d) => `<span class="badge" style="--c:${ST[d.status][1]}">${esc(d.name)} · ${ST[d.status][0]}</span>`).join("")}</div>` : "";
  const table = R.incidents.length
    ? `<div class="tbl"><table><thead><tr><th>Started</th><th>Device</th><th>Type</th><th>Duration</th><th>Missed checks</th><th>State</th></tr></thead><tbody>${R.incidents.slice(0, 30).map((o) => `<tr>
        <td class="mono">${stamp(o.s)}</td><td class="who">${esc(o.name)}</td><td class="dim">${esc(TYPES[o.type]?.one || o.type)}</td><td class="mono">${dur(o.e - o.s)}</td><td class="mono">${o.n}</td>
        <td>${o.ongoing ? '<span class="badge" style="--c:#f43f5e">Ongoing</span>' : '<span class="badge" style="--c:#34d399">Recovered</span>'}</td></tr>`).join("")}</tbody></table></div>
      ${R.incidentTotal > 30 ? `<p class="dim" style="font-size:12px;margin-top:10px">Showing the 30 most recent of ${R.incidentTotal} outages.</p>` : ""}`
    : `<div class="clear"><span class="tick"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></span><div><b>No outages in this period</b>A device is logged as an outage after 2 missed checks in a row.</div></div>`;
  return `<section id="incidents"><div class="sec-head"><h2>Incidents</h2></div><div class="card reveal">${now}${table}</div></section>`;
}

function deviceCard(d, i) {
  const [stLabel, stColor] = ST[d.status];
  const since = d.status !== "unknown" && d.since ? ` · ${dur(R.generated - d.since)}` : "";
  const tint = TYPES[d.type]?.color || "#38bdf8";
  const sub = [d.detail || (d.type === "face" ? { attendance: "Attendance", door: "Door Access" }[d.subtype] : TYPES[d.type]?.one), `${d.ip}${d.port ? `:${d.port}` : ""}`].filter(Boolean).join(" · ");
  let body;
  if (!d.total) body = '<div class="nodata">No ping data collected yet</div>';
  else {
    const lossy = (b) => b[3] && b[2] / b[3] >= 0.5;               // half or more of the checks in this slot failed = outage
    const avgs = d.b.map((b) => (lossy(b) ? null : b[0]));
    const maxAvg = Math.max(5, ...avgs.filter((v) => v != null));
    const yMax = niceMax(maxAvg * 1.3);
    const chart = lineChart({
      w: 344, h: 128, pl: 34, pr: 6, pt: 8, pb: 20, xs, yMin: 0, yMax, guides: 2, xTicks: 4, yFmt: (v) => `${Math.round(v)}`, label: `${d.name} latency`,
      series: [{ color: "#38bdf8", data: avgs, area: true, width: 2 }],
      thresholds: [{ v: d.warn, label: `${d.warn} ms` }],
      bands: d.b.map((b) => (!b[3] || !b[2] ? null : lossy(b) ? "#f43f5e59" : b[2] / b[3] >= 0.02 ? "#f5a5243d" : null)),
      tip: (k) => { const b = d.b[k]; return `<div class="t">${bucketLabel(k)}</div>${b[3] ? `<div class="l" style="--c:#38bdf8"><i></i>Avg<b>${b[0] == null ? "down" : ms(b[0])}</b></div><div class="l" style="--c:#a78bfa"><i></i>Peak<b>${ms(b[1])}</b></div><div class="l" style="--c:#f43f5e"><i></i>Missed<b>${b[2]}/${b[3]}</b></div>` : '<div class="l">No data</div>'}`; },
    });
    const tick = (b, k) => {
      const [a, , fail, n] = b;
      const c = !n ? "nd" : fail / n >= 0.5 ? "dn" : fail / n >= 0.02 || (a != null && a > d.warn) ? "wn" : "";
      return `<i class="${c}" style="--d:${(0.25 + k * 0.006).toFixed(3)}s" title="${bucketLabel(k)}${n ? ` · ${a == null ? "down" : `avg ${ms(a)}`} · ${fail} missed` : " · no data"}"></i>`;
    };
    body = `<div class="stats">
        <div><small>Uptime</small><b style="color:${okColor(d.uptime)}">${pct(d.uptime)}</b><em>${d.failed} missed · ${d.loss == null ? "—" : d.loss}% pkt loss</em></div>
        <div><small>Avg</small><b>${ms(d.avg)}</b><em>p95 ${ms(d.p95)}</em></div>
        <div><small>Peak</small><b style="${d.max > d.warn ? "color:var(--warn)" : ""}">${ms(d.max)}</b><em>min ${ms(d.min)}</em></div>
        <div><small>Downtime</small><b style="${d.downMs ? "color:var(--crit)" : ""}">${d.downMs ? dur(d.downMs) : "None"}</b><em>${d.outageCount} outage${d.outageCount === 1 ? "" : "s"}</em></div></div>
      <div class="chart">${chart}</div>
      <div class="strip">${d.b.map(tick).join("")}</div>
      <div class="strip-lab"><span>${clock(xs[0])}</span><span>health per ${dur(R.bucketMs)}</span><span>${clock(R.end)}</span></div>`;
  }
  return `<article class="card dev reveal ${d.status}" style="--c:${stColor};--d:${((i % 3) * 0.07).toFixed(2)}s" data-type="${d.type}" data-q="${esc(`${d.name} ${d.ip} ${d.detail}`.toLowerCase())}">
    <div class="dev-top"><span class="ico" style="--c:${tint}">${typeIco(d.type, 17)}</span><div class="nm"><b>${esc(d.name)}</b><small>${esc(sub)}</small></div>${badge(d.status, since)}</div>${body}</article>`;
}

function devicesHtml() {
  if (!N) return "";
  const groups = byType.map((g) => {
    const list = [...g.list].sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name));
    return `<div class="group" data-type="${g.t}"><div class="group-title"><span class="ico" style="--c:${TYPES[g.t].color};width:28px;height:28px;border-radius:8px">${typeIco(g.t, 15)}</span>${TYPES[g.t].label}<small>${g.up}/${g.list.length} online · ${pct(g.avail)} availability</small></div>
      <div class="dev-grid">${list.map(deviceCard).join("")}</div></div>`;
  }).join("");
  const chips = [["all", "All", devs.length], ...byType.map((g) => [g.t, TYPES[g.t].label, g.list.length])]
    .map(([k, l, n], i) => `<button class="chip ${i ? "" : "active"}" data-f="${k}">${l} <b>${n}</b></button>`).join("");
  return `<section id="devices"><div class="sec-head"><h2>Device reports</h2><div class="key"><span><i></i>Healthy</span><span><i class="wn"></i>Slow / packet loss</span><span><i class="dn"></i>Outage</span></div></div>
    <div class="tools noprint"><div class="chips">${chips}</div><label class="search">${ico("search", 14)}<input id="q" placeholder="Search name or IP" autocomplete="off"></label></div>
    <div id="groups">${groups}</div></section>`;
}

/* ---------- assemble ---------- */
document.getElementById("app").innerHTML = `<div class="wrap">
  <nav class="nav noprint"><a href="#top">Summary</a><a href="#overview">Availability</a>${devs.some((d) => d.type === "wan") ? '<a href="#isp">ISP</a>' : ""}<a href="#incidents">Incidents</a><a href="#devices">Devices</a></nav>
  <div id="top"></div>
  ${heroHtml()}${overviewHtml()}${chartsRowHtml()}${fleetHtml()}${ispHtml()}${rankHtml()}${incidentsHtml()}${devicesHtml()}
  <footer class="foot"><b>How to read this report.</b> Each device is pinged (or its TCP port checked) about every 5 seconds and the last 24 hours are kept. <b>Availability</b> = successful checks ÷ all checks.
  A device is <b>Offline</b> after 2 missed checks in a row and <b>Degraded</b> when latency exceeds its threshold (100 ms, ISP links 150 ms). Charts average ${dur(R.bucketMs)} per point.<br>
  Generated by the ILJIN NOC Dashboard · ${stamp(R.generated)}</footer></div>`;

/* ---------- interactions & animation ---------- */
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
document.getElementById("btnPrint")?.addEventListener("click", () => window.print());

function count(el) {
  if (el._done) return; el._done = true;
  const isDur = el.dataset.dur != null, target = +(isDur ? el.dataset.dur : el.dataset.count), dec = +(el.dataset.dec || 0), suf = el.dataset.suffix || "";
  const fmt = (v) => (isDur ? dur(v) : v.toFixed(dec) + suf);
  if (REDUCED || !target) { el.textContent = fmt(target); return; }
  const t0 = performance.now(), T = 1500;
  const step = (t) => { const k = Math.min(1, (t - t0) / T); el.textContent = fmt(target * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function finalize() { $$(".reveal").forEach((e) => e.classList.add("in")); $$("[data-count],[data-dur]").forEach((e) => { e._done = true; const isDur = e.dataset.dur != null, t = +(isDur ? e.dataset.dur : e.dataset.count); e.textContent = isDur ? dur(t) : t.toFixed(+(e.dataset.dec || 0)) + (e.dataset.suffix || ""); }); }
window.addEventListener("beforeprint", finalize);
if (REDUCED || !("IntersectionObserver" in window)) finalize();
else {
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    en.target.classList.add("in");
    $$("[data-count],[data-dur]", en.target).forEach(count);
    io.unobserve(en.target);
  }), { threshold: 0.12 });
  $$(".reveal").forEach((e) => io.observe(e));
}

let filter = "all", query = "";
function applyFilter() {
  $$(".group").forEach((g) => {
    let shown = 0;
    $$(".dev", g).forEach((c) => { const ok = (filter === "all" || c.dataset.type === filter) && c.dataset.q.includes(query); c.hidden = !ok; if (ok) shown++; });
    g.hidden = !shown;
  });
}
$$(".chip").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; $$(".chip").forEach((x) => x.classList.toggle("active", x === b)); applyFilter(); }));
document.getElementById("q")?.addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); applyFilter(); });
})();
