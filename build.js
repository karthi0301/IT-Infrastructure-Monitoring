// Builds the "Overall report" — one animated, self-contained HTML file covering every device —
// plus a combined CSV of the raw 24h ping logs. Reads the same in-memory state that server.js keeps.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_WARN_MS = 100, WAN_WARN_MS = 150; // same defaults as server.js
const BUCKET_CHOICES = [1, 2, 5, 10, 15, 30].map((m) => m * 60000);

/** Offline periods = 2+ missed checks in a row (same rule the live monitor uses). Shared by the HTML report and the Excel workbook. */
export function outagesOf(log, now = Date.now()) {
  const out = [];
  let runN = 0, runStart = 0;
  for (const e of log) {
    if (e.ms == null) { if (!runN) runStart = e.t; runN++; }
    else { if (runN >= 2) out.push({ s: runStart, e: e.t, n: runN, ongoing: false }); runN = 0; }
  }
  if (runN >= 2) out.push({ s: runStart, e: now, n: runN, ongoing: true });
  return out;
}

const read = (f) => fs.readFileSync(path.join(HERE, f), "utf8");
const dataUri = (rel, mime) => {
  try { return `data:${mime};base64,${fs.readFileSync(path.join(ROOT, rel)).toString("base64")}`; }
  catch { return ""; }
};
const warnOf = (d) => d.warnMs || (d.type === "wan" ? WAN_WARN_MS : DEFAULT_WARN_MS);

/**
 * Turns the raw per-device logs (one entry every ~5s) into a compact summary the report page draws
 * its charts from: per-device stats, ~96 time buckets per device, outages, and a fleet-wide series.
 */
export function buildReportData(devices, state, now = Date.now()) {
  const logs = devices.map((d) => state[d.id]?.log || []);
  const firsts = logs.filter((l) => l.length).map((l) => l[0].t);
  const start = firsts.length ? Math.max(now - DAY, Math.min(...firsts)) : now - 60000;
  const span = Math.max(now - start, 60000);
  const bucketMs = BUCKET_CHOICES.find((b) => span / b <= 96) || BUCKET_CHOICES[BUCKET_CHOICES.length - 1];
  const b0 = Math.floor(start / bucketMs) * bucketMs;
  const nb = Math.max(1, Math.ceil((now - b0) / bucketMs));

  const fleetN = new Array(nb).fill(0), fleetFail = new Array(nb).fill(0);
  const incidents = [];

  const rows = devices.map((d, i) => {
    const log = logs[i], s = state[d.id] || {};
    const B = Array.from({ length: nb }, () => ({ sum: 0, rc: 0, ok: 0, max: 0, fail: 0, n: 0 }));
    const avgs = [];
    let failed = 0, sent = 0, recv = 0, sumMs = 0, lo = Infinity, hi = -Infinity;

    for (const e of log) {
      // every check keeps: average / min / max of ALL its replies, pings sent (n) and replies received (k)
      const a = e.a ?? e.ms, l = e.lo ?? e.ms, h = e.hi ?? e.ms, n = e.n ?? 1, k = e.k ?? (e.ms == null ? 0 : 1);
      const bi = Math.min(nb - 1, Math.max(0, Math.floor((e.t - b0) / bucketMs)));
      const bk = B[bi];
      bk.n++; fleetN[bi]++; sent += n; recv += k;
      if (e.ms == null) { failed++; bk.fail++; fleetFail[bi]++; continue; }
      bk.ok++; bk.sum += a * k; bk.rc += k; if (h > bk.max) bk.max = h;
      sumMs += a * k; if (l < lo) lo = l; if (h > hi) hi = h; avgs.push(a);
    }

    const outages = outagesOf(log, now);
    avgs.sort((x, y) => x - y);
    const total = log.length, ok = total - failed;
    const avg = recv ? sumMs / recv : null;
    const downMs = outages.reduce((t, o) => t + (o.e - o.s), 0);
    for (const o of outages) incidents.push({ ...o, id: d.id, name: d.name, type: d.type });

    const uptime = total ? +((100 * ok) / total).toFixed(2) : null;
    return {
      id: d.id, name: d.name, detail: d.detail || "", ip: d.ip, port: d.port || null,
      type: d.type, subtype: d.subtype || null,
      status: s.status || "unknown", since: s.since || null, warn: warnOf(d),
      total, failed, uptime,
      slaTarget: d.type === "wan" ? (d.slaTarget || 99.5) : null,
      slaBreach: d.type === "wan" && uptime != null ? uptime < (d.slaTarget || 99.5) : null,
      sent, recv, loss: sent ? +((100 * (sent - recv)) / sent).toFixed(2) : null, // packet loss over every single ping
      avg: avg == null ? null : +avg.toFixed(2), min: recv ? lo : null, max: recv ? hi : null,
      p95: avgs.length ? avgs[Math.floor(0.95 * (avgs.length - 1))] : null, // 95th percentile of per-check averages
      downMs, outageCount: outages.length,
      b: B.map((x) => [x.rc ? +(x.sum / x.rc).toFixed(2) : null, x.max || null, x.fail, x.n]),
    };
  });

  incidents.sort((a, b) => b.s - a.s);
  return {
    generated: now, start, end: now, b0, bucketMs, nb,
    devices: rows,
    fleet: fleetN.map((n, i) => (n ? +((100 * (n - fleetFail[i])) / n).toFixed(2) : null)),
    incidents: incidents.slice(0, 60), incidentTotal: incidents.length,
  };
}

/** The full report page: template + CSS + client script + data, all inlined so it opens offline anywhere. */
export function buildOverallReport(devices, state, now = Date.now()) {
  const data = buildReportData(devices, state, now);
  const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return read("template.html")
    .replace("/*%%CSS%%*/", () => read("report.css"))
    .replace("/*%%JS%%*/", () => read("report.client.js"))
    .replace("%%DATA%%", () => json)
    .replace("%%LOGO_ILJIN%%", () => dataUri("src/assets/iljin-logo.jpg", "image/jpeg"))
    .replace("%%LOGO_AMBER%%", () => dataUri("src/assets/amber-logo.webp", "image/webp"));
}

const pad = (n) => String(n).padStart(2, "0");
const cell = (v) => (/[",\r\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** Per-check ping log as CSV (opens in Excel). Dates are ISO (2026-09-22) so Excel reads them the same in every regional setting. */
export function* overallCsvChunks(devices, state) {
  yield "\uFEFFDevice,Type,IP,Date,Time,Status,Latest reply (ms),Average of replies (ms),Min (ms),Max (ms),Pings sent,Replies,Packet loss (%)\r\n";
  for (const d of devices) {
    const log = state[d.id]?.log || [];
    if (!log.length) continue;
    const head = [cell(d.name), cell(d.type), cell(d.ip + (d.port ? `:${d.port}` : ""))].join(",");
    const out = new Array(log.length);
    for (let i = 0; i < log.length; i++) {
      const e = log[i], t = new Date(e.t);
      const n = e.n ?? 1, k = e.k ?? (e.ms == null ? 0 : 1);
      out[i] = `${head},${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())},${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())},${e.ms == null ? "Offline" : "Online"},${e.ms ?? ""},${e.a ?? e.ms ?? ""},${e.lo ?? e.ms ?? ""},${e.hi ?? e.ms ?? ""},${n},${k},${Math.round((1000 * (n - k)) / n) / 10}`;
    }
    yield out.join("\r\n") + "\r\n";
  }
}

export const deviceCsv = (d, state) => [...overallCsvChunks([d], state)].join("");

/** ISP SLA report: for every ISP link, uptime over the last 24h vs its contracted SLA target, with a Met/Breached verdict — proof for a complaint or credit claim. */
export function buildIspSlaCsv(devices, state, now = Date.now()) {
  const wans = devices.filter((d) => d.type === "wan");
  const rows = ["\uFEFFISP Link,IP,SLA target (%),Actual uptime (%),Total downtime,Outages,Verdict\r\n"];
  for (const d of wans) {
    const log = state[d.id]?.log || [];
    const total = log.length, failed = log.filter((e) => e.ms == null).length;
    const uptime = total ? +((100 * (total - failed)) / total).toFixed(2) : null;
    const target = d.slaTarget || 99.5;
    const outs = outagesOf(log, now);
    const downMin = Math.round(outs.reduce((t, o) => t + (o.e - o.s), 0) / MinMs());
    const verdict = uptime == null ? "No data yet" : uptime >= target ? "Met" : "Breached";
    rows.push([cell(d.name), cell(d.ip), target, uptime ?? "", `${downMin} min`, outs.length, verdict].join(",") + "\r\n");
  }
  return rows.join("");
}
const MinMs = () => 60000;
