// Excel workbook (.xlsx): Summary + Outages + one sheet per device + Notes.
// Every number a person reads is a live formula over the data table on that sheet, so it can be checked (and recalculates if edited).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { outagesOf } from "./build.js";
import { hbars, lineChart } from "./charts.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN = 60000, DAY = 86400000;
const C = { navy: "FF061E8E", ink: "FF0B1440", orange: "FFFF5500", mute: "FF5B6591", line: "FFDDE1F0", tile: "FFF3F5FC", ok: "FF12A879", warn: "FFF2A30F", crit: "FFE5384F", white: "FFFFFFFF" };
const font = (o = {}) => ({ name: "Arial", size: 10, color: { argb: C.ink }, ...o });
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const xl = (t) => new Date(t - new Date(t).getTimezoneOffset() * MIN); // Excel has no time zones: shift so it shows the local clock time
const TYPE = { wan: "ISP link", server: "Server", switch: "Switch", ap: "Access point", face: "Face device", printer: "Printer" };
const ORDER = ["wan", "server", "switch", "ap", "face", "printer"];
const STATUS = { up: "Online", warn: "Degraded", down: "Offline", unknown: "Checking" };
const SCOL = { up: C.ok, warn: C.warn, down: C.crit, unknown: C.mute };
const fmtDT = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, "0"); return `${p(d.getDate())}-${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const warnOf = (d) => d.warnMs || (d.type === "wan" ? 150 : 100);

let Resvg;
async function png(svg, width) {
  if (Resvg === undefined) { try { Resvg = (await import("@resvg/resvg-js")).Resvg; } catch { Resvg = null; } }
  if (!Resvg) return null;
  try { return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: width * 2 }, font: { loadSystemFonts: true, defaultFontFamily: "Arial" } }).render().asPng()); }
  catch { return null; }
}

// one row per minute: checks, checks that got a reply, pings sent, replies, and the sum / min / max of reply times
function minuteRows(log) {
  const m = new Map();
  for (const e of log) {
    const t = Math.floor(e.t / MIN) * MIN;
    const r = m.get(t) || { t, n: 0, up: 0, sent: 0, recv: 0, sum: 0, lo: null, hi: null };
    const a = e.a ?? e.ms, l = e.lo ?? e.ms, h = e.hi ?? e.ms, sent = e.n ?? 1, k = e.k ?? (e.ms == null ? 0 : 1);
    r.n++; r.sent += sent; r.recv += k;
    if (e.ms != null) { r.up++; r.sum += a * k; r.lo = r.lo == null ? l : Math.min(r.lo, l); r.hi = r.hi == null ? h : Math.max(r.hi, h); }
    m.set(t, r);
  }
  return [...m.values()].sort((x, y) => x.t - y.t);
}

function statsOf(rows, outs) {
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  const checks = sum((r) => r.n), up = sum((r) => r.up), sent = sum((r) => r.sent), recv = sum((r) => r.recv);
  const los = rows.filter((r) => r.lo != null).map((r) => r.lo), his = rows.filter((r) => r.hi != null).map((r) => r.hi);
  return {
    checks, up, sent, recv, avail: checks ? up / checks : null, loss: sent ? 1 - recv / sent : null,
    avg: recv ? sum((r) => r.sum) / recv : null, min: los.length ? Math.min(...los) : null, max: his.length ? Math.max(...his) : null,
    outages: outs.length, downMin: outs.reduce((a, o) => a + (o.e - o.s) / MIN, 0),
  };
}

// ~96 points for the line chart
function chartPoints(rows, from, to) {
  const spanMin = Math.max(1, Math.round((to - from) / MIN)), step = Math.max(1, Math.ceil(spanMin / 96)) * MIN;
  const map = new Map();
  for (const r of rows) {
    const k = Math.floor(r.t / step) * step, p = map.get(k) || { t: k, sum: 0, recv: 0, lo: null, hi: null, n: 0, up: 0 };
    p.sum += r.sum; p.recv += r.recv; p.n += r.n; p.up += r.up;
    if (r.lo != null) { p.lo = p.lo == null ? r.lo : Math.min(p.lo, r.lo); p.hi = p.hi == null ? r.hi : Math.max(p.hi, r.hi); }
    map.set(k, p);
  }
  return [...map.values()].sort((a, b) => a.t - b.t).map((p) => ({ t: p.t, avg: p.recv ? p.sum / p.recv : null, lo: p.lo, hi: p.hi, down: p.n > 0 && p.up === 0 }));
}

function tile(ws, row, col, label, value, fmt, valColor) {
  ws.mergeCells(row, col, row, col + 1); ws.mergeCells(row + 1, col, row + 1, col + 1);
  const l = ws.getCell(row, col), v = ws.getCell(row + 1, col);
  l.value = label; l.font = font({ size: 9, color: { argb: C.mute } }); l.fill = fill(C.tile); l.alignment = { vertical: "bottom", indent: 1 };
  v.value = value; v.numFmt = fmt; v.font = font({ size: 16, bold: true, color: { argb: valColor || C.ink } }); v.fill = fill(C.tile); v.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  for (const c of [col, col + 1]) { ws.getCell(row, c).fill = fill(C.tile); ws.getCell(row + 1, c).fill = fill(C.tile); ws.getCell(row, c).border = { top: { style: "medium", color: { argb: C.orange } } }; }
}
const headerRow = (ws, r, labels, c0 = 1) => labels.forEach((t, i) => {
  const c = ws.getCell(r, c0 + i);
  c.value = t; c.font = font({ bold: true, color: { argb: C.white } }); c.fill = fill(C.navy); c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
});
const CF = (bg, fg) => ({ fill: { type: "pattern", pattern: "solid", bgColor: { argb: bg } }, font: { color: { argb: fg }, bold: true } });

export async function buildWorkbook(devices, state, now = Date.now()) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ILJIN IT Network Operations"; wb.created = new Date(now);
  wb.calcProperties.fullCalcOnLoad = true;

  const used = new Set(["summary", "outages", "notes"]);
  const items = devices.map((d) => {
    const log = state[d.id]?.log || [], rows = minuteRows(log), outs = outagesOf(log, now);
    const base = d.name.replace(/[\\/?*[\]:'"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Device";
    let name = base, k = 2;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 26)} ${k++}`;
    used.add(name.toLowerCase());
    return { d, log, rows, outs, name, s: statsOf(rows, outs), status: state[d.id]?.status || "unknown" };
  }).sort((a, b) => ORDER.indexOf(a.d.type) - ORDER.indexOf(b.d.type) || a.d.name.localeCompare(b.d.name));
  const firsts = items.map((i) => i.log[0]?.t).filter(Boolean);
  const from = firsts.length ? Math.max(now - DAY, Math.min(...firsts)) : now - MIN;
  const single = items.length === 1;

  // ---------------- Summary ----------------
  const ws = wb.addWorksheet("Summary", { views: [{ showGridLines: false }], properties: { tabColor: { argb: C.orange } }, pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [5, 26, 14, 18, 12, 13, 12, 11, 11, 11, 10, 14, 12].map((width) => ({ width }));
  ws.getRow(1).height = 24; ws.getRow(2).height = 30; ws.getRow(3).height = 18;
  try {
    const logo = fs.readFileSync(path.join(ROOT, "src/assets/iljin-logo.jpg"));
    ws.addImage(wb.addImage({ buffer: logo, extension: "jpeg" }), { tl: { col: 0.1, row: 0.1 }, ext: { width: 62, height: 62 } });
  } catch { /* logo is optional */ }
  ws.mergeCells("C1:M1"); ws.mergeCells("C2:M2"); ws.mergeCells("C3:M3");
  ws.getCell("C1").value = "ILJIN IT Network Operations"; ws.getCell("C1").font = font({ size: 10, color: { argb: C.mute } });
  ws.getCell("C2").value = single ? `Ping report · ${items[0].d.name}` : "Ping & availability report · all devices"; ws.getCell("C2").font = font({ size: 20, bold: true, color: { argb: C.navy } });
  ws.getCell("C3").value = `Last 24 hours · data from ${fmtDT(from)} to ${fmtDT(now)}${from > now - DAY + 5 * MIN ? " (monitoring has run for less than 24 h)" : ""} · generated ${fmtDT(now)}`;
  ws.getCell("C3").font = font({ size: 9, color: { argb: C.mute } });

  const n = items.length;
  const chartW = 620, avail = items.map((i) => ({ label: i.d.name, value: i.s.avail == null ? null : i.s.avail * 100, color: i.s.avail == null ? "#bbb" : i.s.avail >= 0.999 ? "#12a879" : i.s.avail >= 0.99 ? "#8fbf2f" : i.s.avail >= 0.95 ? "#f2a30f" : "#e5384f" }));
  const lat = items.map((i) => ({ label: i.d.name, value: i.s.avg, color: i.s.avg == null ? "#bbb" : i.s.avg > warnOf(i.d) ? "#f2a30f" : "#2f55e0" }));
  const c1 = await png(hbars({ items: avail, max: 100, fmt: (v) => `${v.toFixed(2)}%`, title: "Availability by device", sub: "Share of checks that got a reply (last 24 h)", w: chartW }).svg, chartW);
  const c2 = await png(hbars({ items: lat, max: Math.max(2, ...lat.map((x) => x.value || 0)) * 1.1, fmt: (v) => (v < 1 ? "<1 ms" : `${v.toFixed(1)} ms`), title: "Average latency by device", sub: "Mean of every ping reply, in ms", w: chartW }).svg, chartW);
  const chartH = 56 + n * 22 + 12, chartRows = Math.ceil(chartH / 20) + 2;
  const t1 = 10 + (single ? 0 : chartRows) + 3, tEnd = t1 + n - 1; // table rows on Summary
  if (!single) {
    if (c1) ws.addImage(wb.addImage({ buffer: c1, extension: "png" }), { tl: { col: 0.1, row: 9 }, ext: { width: chartW, height: chartH } });
    if (c2) ws.addImage(wb.addImage({ buffer: c2, extension: "png" }), { tl: { col: 6.6, row: 9 }, ext: { width: chartW, height: chartH } });
    if (!c1) { ws.mergeCells("A10:M10"); ws.getCell("A10").value = "Charts need the '@resvg/resvg-js' package — run npm install, then download again."; ws.getCell("A10").font = font({ color: { argb: C.crit } }); }
  }
  // KPI tiles (formulas over the table below)
  const rng = (col) => `${col}${t1}:${col}${tEnd}`;
  const okAvail = items.filter((i) => i.s.avail != null), okAvg = items.filter((i) => i.s.avg != null);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : "n/a");
  ws.getRow(5).height = 18; ws.getRow(6).height = 30;
  const kp = [
    ["Devices monitored", `COUNTA(${rng("B")})`, n, "0"],
    ["Availability (mean of devices)", `IFERROR(AVERAGE(${rng("F")}),"n/a")`, mean(okAvail.map((i) => i.s.avail)), "0.00%"],
    ["Average latency (ms)", `IFERROR(AVERAGE(${rng("H")}),"n/a")`, mean(okAvg.map((i) => i.s.avg)), "0.0"],
    ["Devices ≥ 99.9% available", `COUNTIF(${rng("F")},">=0.999")`, okAvail.filter((i) => i.s.avail >= 0.999).length, "0"],
    ["Outages", `SUM(${rng("K")})`, items.reduce((a, i) => a + i.s.outages, 0), "0"],
    ["Total downtime (min)", `SUM(${rng("L")})`, items.reduce((a, i) => a + i.s.downMin, 0), "0.0"],
  ];
  kp.forEach(([label, f, res, fmt], i) => tile(ws, 5, 1 + i * 2, label, { formula: f, result: res }, fmt));

  // device table
  const hr = t1 - 1;
  ws.getRow(hr).height = 30;
  headerRow(ws, hr, ["#", "Device", "Type", "IP address", "Status now", "Availability", "Packet loss", "Avg (ms)", "Min (ms)", "Max (ms)", "Outages", "Downtime (min)", "Details"]);
  items.forEach((it, i) => {
    const r = t1 + i, q = `'${it.name}'!`, cells = [
      i + 1, it.d.name, TYPE[it.d.type] || it.d.type, it.d.ip + (it.d.port ? `:${it.d.port}` : ""), STATUS[it.status] || it.status,
      { formula: `${q}A6`, result: it.s.avail ?? "n/a" }, { formula: `${q}C6`, result: it.s.loss ?? "n/a" },
      { formula: `${q}E6`, result: it.s.avg ?? "n/a" }, { formula: `${q}G6`, result: it.s.min ?? "n/a" }, { formula: `${q}I6`, result: it.s.max ?? "n/a" },
      { formula: `${q}G9`, result: it.s.outages }, { formula: `${q}I9`, result: it.s.downMin }, { text: "Open ›", hyperlink: `#'${it.name}'!A1` },
    ];
    cells.forEach((v, c) => { const cell = ws.getCell(r, c + 1); cell.value = v; cell.font = font(); cell.border = { bottom: { style: "thin", color: { argb: C.line } } }; cell.alignment = { vertical: "middle", horizontal: c >= 5 ? "right" : c === 0 ? "center" : "left" }; });
    ws.getCell(r, 5).font = font({ bold: true, color: { argb: SCOL[it.status] } });
    ws.getCell(r, 13).font = font({ color: { argb: "FF1533B8" }, underline: true }); ws.getCell(r, 13).alignment = { horizontal: "center" };
    Object.entries({ 6: "0.00%", 7: "0.00%", 8: "0.0", 9: "0.0", 10: "0.0", 11: "0", 12: "0.0" }).forEach(([c, f]) => { ws.getCell(r, +c).numFmt = f; });
  });
  ws.addConditionalFormatting({ ref: rng("F"), rules: [
    { type: "cellIs", operator: "lessThan", formulae: [0.95], style: CF("FFFDE2E4", "FF9B1C31") },
    { type: "cellIs", operator: "between", formulae: [0.95, 0.99899], style: CF("FFFFF1CC", "FF8A5A00") },
    { type: "cellIs", operator: "greaterThanOrEqual", formulae: [0.999], style: { font: { color: { argb: "FF0B7A58" }, bold: true } } }] });
  ws.addConditionalFormatting({ ref: rng("H"), rules: [{ type: "cellIs", operator: "greaterThan", formulae: [100], style: CF("FFFFF1CC", "FF8A5A00") }] });
  ws.getCell(tEnd + 2, 2).value = "Availability = checks that got at least one reply ÷ all checks. Packet loss counts every single ping. See the Notes sheet for exact definitions.";
  ws.getCell(tEnd + 2, 2).font = font({ size: 9, color: { argb: C.mute } });

  // ---------------- Outages ----------------
  const wo = wb.addWorksheet("Outages", { views: [{ showGridLines: false, state: "frozen", ySplit: 1 }], properties: { tabColor: { argb: C.crit } }, pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  wo.columns = [28, 16, 20, 20, 16, 12].map((width) => ({ width }));
  headerRow(wo, 1, ["Device", "Type", "Went offline", "Back online", "Duration (min)", "State"]);
  const all = items.flatMap((i) => i.outs.map((o) => ({ ...o, d: i.d }))).sort((a, b) => b.s - a.s);
  all.forEach((o, i) => {
    const r = i + 2;
    [o.d.name, TYPE[o.d.type] || o.d.type, xl(o.s), xl(o.e), { formula: `(D${r}-C${r})*1440`, result: (o.e - o.s) / MIN }, o.ongoing ? "Still offline" : "Recovered"].forEach((v, c) => {
      const cell = wo.getCell(r, c + 1); cell.value = v; cell.font = font({ color: { argb: o.ongoing && c === 5 ? C.crit : C.ink }, bold: o.ongoing && c === 5 });
      if (c === 2 || c === 3) cell.numFmt = "dd-mmm-yy hh:mm"; if (c === 4) cell.numFmt = "0.0";
    });
  });
  if (!all.length) { wo.mergeCells("A2:F2"); wo.getCell("A2").value = "No outages in the last 24 hours — every device kept answering."; wo.getCell("A2").font = font({ color: { argb: C.ok }, bold: true }); }
  else {
    const tr = all.length + 3;
    wo.getCell(tr, 4).value = "Total downtime"; wo.getCell(tr, 4).font = font({ bold: true });
    wo.getCell(tr, 5).value = { formula: `SUM(E2:E${all.length + 1})`, result: all.reduce((a, o) => a + (o.e - o.s) / MIN, 0) }; wo.getCell(tr, 5).numFmt = "0.0"; wo.getCell(tr, 5).font = font({ bold: true });
    wo.autoFilter = `A1:F${all.length + 1}`;
  }

  // ---------------- one sheet per device ----------------
  for (const it of items) {
    const { d, rows, outs, s, name } = it;
    const tab = s.avail == null ? C.mute : s.avail >= 0.999 ? C.ok : s.avail >= 0.95 ? C.warn : C.crit;
    const w = wb.addWorksheet(name, { views: [{ showGridLines: false }], properties: { tabColor: { argb: tab } }, pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    w.columns = [20, 17, 14, 13, 13, 13, 13, 13, 13, 13].map((width) => ({ width })); // B/C wide enough for 'dd-mmm-yy hh:mm'
    w.mergeCells("A1:H1"); w.getCell("A1").value = d.name; w.getCell("A1").font = font({ size: 18, bold: true, color: { argb: C.navy } }); w.getRow(1).height = 28;
    w.mergeCells("I1:J1"); const sc = w.getCell("I1"); sc.value = STATUS[it.status] || it.status; sc.font = font({ bold: true, color: { argb: C.white } }); sc.fill = fill(SCOL[it.status]); sc.alignment = { horizontal: "center", vertical: "middle" };
    w.mergeCells("A2:J2"); w.getCell("A2").value = [TYPE[d.type] || d.type, d.ip + (d.port ? `:${d.port}` : ""), d.detail].filter(Boolean).join("  ·  "); w.getCell("A2").font = font({ color: { argb: C.mute } });
    w.mergeCells("A3:J3"); w.getCell("A3").value = { text: "‹ Back to summary", hyperlink: "#'Summary'!A1" }; w.getCell("A3").font = font({ size: 9, color: { argb: "FF1533B8" }, underline: true });

    // layout: tiles rows 5-6 and 8-9 · chart rows 11-24 · outages from row 26 · minute-by-minute table below
    const oN = Math.max(outs.length, 1), o1 = 28, o2 = o1 + oN - 1, dh = o2 + 3, d1 = dh + 1, d2 = d1 + Math.max(rows.length, 1) - 1;
    const R = (c) => `${c}${d1}:${c}${d2}`;
    w.getRow(6).height = 30; w.getRow(9).height = 30;
    tile(w, 5, 1, "Availability", { formula: `IFERROR(SUM(${R("C")})/SUM(${R("B")}),"n/a")`, result: s.avail ?? "n/a" }, "0.00%", tab);
    tile(w, 5, 3, "Packet loss", { formula: `IFERROR(1-SUM(${R("E")})/SUM(${R("D")}),"n/a")`, result: s.loss ?? "n/a" }, "0.00%");
    tile(w, 5, 5, "Average latency (ms)", { formula: `IFERROR(SUMPRODUCT(${R("F")},${R("E")})/SUM(${R("E")}),"n/a")`, result: s.avg ?? "n/a" }, "0.0");
    tile(w, 5, 7, "Fastest reply (ms)", { formula: `IF(COUNT(${R("G")})=0,"n/a",MIN(${R("G")}))`, result: s.min ?? "n/a" }, "0.0");
    tile(w, 5, 9, "Slowest reply (ms)", { formula: `IF(COUNT(${R("H")})=0,"n/a",MAX(${R("H")}))`, result: s.max ?? "n/a" }, "0.0");
    tile(w, 8, 1, "Checks made", { formula: `SUM(${R("B")})`, result: s.checks }, "#,##0");
    tile(w, 8, 3, "Pings sent", { formula: `SUM(${R("D")})`, result: s.sent }, "#,##0");
    tile(w, 8, 5, "Replies received", { formula: `SUM(${R("E")})`, result: s.recv }, "#,##0");
    tile(w, 8, 7, "Outages", { formula: `COUNT(A${o1}:A${o2})`, result: s.outages }, "0", s.outages ? C.crit : C.ok);
    tile(w, 8, 9, "Downtime (min)", { formula: `SUM(C${o1}:C${o2})`, result: s.downMin }, "0.0", s.outages ? C.crit : C.ok);

    const pts = chartPoints(rows, from, now);
    const img = await png(lineChart({ pts, title: "Latency over the last 24 hours", sub: `${d.name} · every ping reply, in ms`, warn: warnOf(d) }).svg, 900);
    if (img) w.addImage(wb.addImage({ buffer: img, extension: "png" }), { tl: { col: 0.1, row: 10 }, ext: { width: 900, height: 270 } });

    w.getCell("A26").value = "Outages (2 or more missed checks in a row)"; w.getCell("A26").font = font({ bold: true, size: 11, color: { argb: C.navy } });
    headerRow(w, 27, ["Went offline", "Back online", "Duration (min)", "State"]);
    if (outs.length) outs.forEach((o, i) => {
      const r = o1 + i;
      [xl(o.s), xl(o.e), { formula: `(B${r}-A${r})*1440`, result: (o.e - o.s) / MIN }, o.ongoing ? "Still offline" : "Recovered"].forEach((v, c) => {
        const cell = w.getCell(r, c + 1); cell.value = v; cell.font = font(); if (c < 2) cell.numFmt = "dd-mmm-yy hh:mm"; if (c === 2) cell.numFmt = "0.0";
      });
    });
    else { w.mergeCells(o1, 1, o1, 4); w.getCell(o1, 1).value = "None — this device answered every check."; w.getCell(o1, 1).font = font({ color: { argb: C.ok }, bold: true }); }

    w.getCell(dh - 1, 1).value = "Minute-by-minute data (every figure above is calculated from these rows)"; w.getCell(dh - 1, 1).font = font({ bold: true, size: 11, color: { argb: C.navy } });
    w.getRow(dh).height = 32;
    headerRow(w, dh, ["Minute", "Checks", "Checks answered", "Pings sent", "Replies", "Avg (ms)", "Fastest (ms)", "Slowest (ms)", "Packet loss", "Availability"]);
    rows.forEach((r0, i) => {
      const r = d1 + i;
      const vals = [xl(r0.t), r0.n, r0.up, r0.sent, r0.recv, r0.recv ? r0.sum / r0.recv : null, r0.lo, r0.hi,
        { formula: `IF(D${r}=0,"",1-E${r}/D${r})`, result: r0.sent ? 1 - r0.recv / r0.sent : "" }, { formula: `IF(B${r}=0,"",C${r}/B${r})`, result: r0.n ? r0.up / r0.n : "" }];
      vals.forEach((v, c) => { const cell = w.getCell(r, c + 1); cell.value = v; cell.font = font({ size: 9 }); if (c === 0) cell.numFmt = "dd-mmm-yy hh:mm"; if (c >= 5 && c <= 7) cell.numFmt = "0.0#"; if (c >= 8) cell.numFmt = "0.0%"; });
    });
    if (!rows.length) { w.mergeCells(d1, 1, d1, 10); w.getCell(d1, 1).value = "No ping data collected yet for this device."; w.getCell(d1, 1).font = font({ color: { argb: C.mute } }); }
    else w.autoFilter = `A${dh}:J${d2}`;
    w.addConditionalFormatting({ ref: `J${d1}:J${d2}`, rules: [{ type: "cellIs", operator: "lessThan", formulae: [0.95], style: CF("FFFDE2E4", "FF9B1C31") }, { type: "cellIs", operator: "lessThan", formulae: [0.999], style: CF("FFFFF1CC", "FF8A5A00") }] });
  }

  // ---------------- Notes ----------------
  const wn = wb.addWorksheet("Notes", { views: [{ showGridLines: false }] });
  wn.columns = [{ width: 28 }, { width: 110 }];
  wn.getCell("A1").value = "How these numbers are measured"; wn.getCell("A1").font = font({ size: 16, bold: true, color: { argb: C.navy } });
  [
    ["Check", "Every ~5 seconds the monitor sends 3 pings to each device (or opens a TCP connection if a port is set) and keeps every reply."],
    ["Latency (ms)", "Round-trip time of each reply as reported by the operating system's ping. Average = mean of ALL replies (not one per check). The dashboard tile shows the most recent reply, exactly like a live \"ping -t\"."],
    ["Resolution", "Windows ping reports whole milliseconds and prints \"<1ms\" for anything faster. Those readings are counted as 0.5 ms and shown as \"<1 ms\" on the dashboard. Linux/macOS report decimals."],
    ["Availability", "Checks that received at least one reply ÷ all checks."],
    ["Packet loss", "1 − (replies received ÷ pings sent), counting every single ping — so a check where 1 of 3 pings is lost still shows as 33% loss for that check."],
    ["Outage", "2 or more failed checks in a row (the same rule that turns a tile red on the dashboard). Duration = first failed check to the first successful one."],
    ["Coverage", "Data comes from the monitor's rolling 24-hour log, which is saved to disk. If the monitor was stopped, that gap simply has no rows."],
    ["Formulas", "Tiles and summary numbers are Excel formulas over the minute-by-minute table on each device sheet — change or filter the data and they recalculate."],
  ].forEach(([k, t], i) => { const r = i + 3; wn.getCell(r, 1).value = k; wn.getCell(r, 1).font = font({ bold: true }); wn.getCell(r, 2).value = t; wn.getCell(r, 2).font = font(); wn.getCell(r, 2).alignment = { wrapText: true, vertical: "top" }; wn.getCell(r, 1).alignment = { vertical: "top" }; wn.getRow(r).height = 32; });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
