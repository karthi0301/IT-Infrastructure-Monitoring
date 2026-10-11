// Small SVG chart builders. They are rendered to PNG (resvg) and placed inside the Excel workbook.
const FONT = 'font-family="Segoe UI, Arial, Helvetica, sans-serif"';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const NICE = [1, 2, 3, 5, 8, 10, 15, 20, 30, 50, 80, 100, 150, 200, 300, 500, 800, 1000];
const niceMax = (v) => { let k = 1; while (v > NICE[NICE.length - 1] * k) k *= 10; return NICE.find((n) => n * k >= v) * k; };
const p2 = (n) => String(n).padStart(2, "0");
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ${FONT}><rect width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`;
const heading = (t, sub) => `<text x="16" y="26" font-size="15" font-weight="700" fill="#0b1440">${esc(t)}</text>${sub ? `<text x="16" y="42" font-size="11" fill="#5b6591">${esc(sub)}</text>` : ""}`;

/** Horizontal bar chart. items: [{ label, value|null, color }] */
export function hbars({ items, max, fmt, title, sub, w = 620 }) {
  const rowH = 22, top = 56, labW = 170, right = 76, bw = w - labW - right, h = top + items.length * rowH + 12;
  const rows = items.map((it, i) => {
    const y = top + i * rowH;
    const len = it.value == null ? 0 : Math.max(3, Math.min(1, it.value / max) * bw);
    return `<text x="${labW - 10}" y="${y + 13}" text-anchor="end" font-size="11.5" fill="#2b3563">${esc(clip(it.label, 26))}</text>
<rect x="${labW}" y="${y + 2}" width="${bw}" height="14" rx="7" fill="#eef0f8"/>
${len ? `<rect x="${labW}" y="${y + 2}" width="${len.toFixed(1)}" height="14" rx="7" fill="${it.color}"/>` : ""}
<text x="${labW + bw + 8}" y="${y + 13}" font-size="11.5" font-weight="700" fill="#0b1440">${it.value == null ? "no data" : esc(fmt(it.value))}</text>`;
  }).join("");
  return { svg: svg(w, h, heading(title, sub) + rows), w, h };
}

/** Latency over time. pts: [{ t, avg|null, lo|null, hi|null, down }]; shaded red where the device was offline. */
export function lineChart({ pts, title, sub, warn, w = 900, h = 270 }) {
  const L = 54, R = 18, T = 56, B = 34, pw = w - L - R, ph = h - T - B, n = pts.length;
  const vals = pts.flatMap((p) => [p.hi, p.avg]).filter((v) => v != null);
  if (!vals.length) return { svg: svg(w, h, heading(title, sub) + `<text x="${w / 2}" y="${h / 2 + 20}" text-anchor="middle" font-size="13" fill="#5b6591">No successful replies in this period</text>`), w, h };
  const yMax = niceMax(Math.max(Math.max(...vals), 2) * 1.15);
  const x = (i) => L + (n > 1 ? (i / (n - 1)) * pw : pw / 2), y = (v) => T + ph - (Math.min(v, yMax) / yMax) * ph;
  const cw = n > 1 ? pw / (n - 1) : pw;
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const v = (yMax * k) / 4, yy = y(v);
    g += `<line x1="${L}" x2="${L + pw}" y1="${yy}" y2="${yy}" stroke="#e6e9f5"/><text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="10.5" fill="#5b6591">${Math.round(v * 10) / 10}</text>`;
  }
  g += `<text x="${L - 8}" y="${T - 10}" text-anchor="end" font-size="10.5" fill="#5b6591">ms</text>`;
  const ticks = Math.min(6, n);
  for (let k = 0; k < ticks; k++) {
    const i = ticks > 1 ? Math.round((k * (n - 1)) / (ticks - 1)) : 0, d = new Date(pts[i].t);
    g += `<text x="${x(i)}" y="${h - 12}" text-anchor="middle" font-size="10.5" fill="#5b6591">${p2(d.getHours())}:${p2(d.getMinutes())}</text>`;
  }
  const down = pts.map((p, i) => (p.down ? `<rect x="${(x(i) - cw / 2).toFixed(1)}" y="${T}" width="${cw.toFixed(1)}" height="${ph}" fill="#e5384f" opacity=".16"/>` : "")).join("");
  const segs = []; let cur = [];
  pts.forEach((p, i) => { if (p.avg == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(i); });
  if (cur.length) segs.push(cur);
  const band = segs.map((s) => s.length < 2 ? "" : `<polygon fill="#2f55e0" opacity=".13" points="${s.map((i) => `${x(i).toFixed(1)},${y(pts[i].hi).toFixed(1)}`).concat([...s].reverse().map((i) => `${x(i).toFixed(1)},${y(pts[i].lo).toFixed(1)}`)).join(" ")}"/>`).join("");
  const line = segs.map((s) => s.length < 2
    ? `<circle cx="${x(s[0]).toFixed(1)}" cy="${y(pts[s[0]].avg).toFixed(1)}" r="2.5" fill="#1533b8"/>`
    : `<polyline fill="none" stroke="#1533b8" stroke-width="2" stroke-linejoin="round" points="${s.map((i) => `${x(i).toFixed(1)},${y(pts[i].avg).toFixed(1)}`).join(" ")}"/>`).join("");
  const wl = warn && warn < yMax ? `<line x1="${L}" x2="${L + pw}" y1="${y(warn)}" y2="${y(warn)}" stroke="#f2a30f" stroke-dasharray="5 4"/><text x="${L + pw}" y="${y(warn) - 4}" text-anchor="end" font-size="10" fill="#b57a00">slow above ${warn} ms</text>` : "";
  const lx = w - 300;
  const legend = `<line x1="${lx}" x2="${lx + 18}" y1="22" y2="22" stroke="#1533b8" stroke-width="2"/><text x="${lx + 24}" y="26" font-size="10.5" fill="#2b3563">Average</text>
<rect x="${lx + 84}" y="16" width="16" height="10" fill="#2f55e0" opacity=".25"/><text x="${lx + 106}" y="26" font-size="10.5" fill="#2b3563">Min – max</text>
<rect x="${lx + 176}" y="16" width="16" height="10" fill="#e5384f" opacity=".3"/><text x="${lx + 198}" y="26" font-size="10.5" fill="#2b3563">Offline</text>`;
  return { svg: svg(w, h, heading(title, sub) + legend + g + down + wl + band + line), w, h };
}
