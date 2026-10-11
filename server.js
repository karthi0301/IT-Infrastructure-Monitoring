// Monitor API: pings every device in devices.json and serves the results to the dashboard.
import http from "http";
import fs from "fs";
import net from "net";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { notifyCritical } from "./notify.js";
import { getServerHealth } from "./wmi.js";
import { buildOverallReport, overallCsvChunks, deviceCsv, buildReportData, buildIspSlaCsv } from "./report/build.js";
import { buildWorkbook } from "./report/xlsx.js";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "devices.json");
const PORT = 3001, INTERVAL = 5000, WARN_MS = 100;
const TYPES = ["server", "switch", "router", "firewall", "ap", "printer", "face", "wan"];
const FACE_KINDS = ["attendance", "door"]; // Face device purpose: Attendance / Door Access
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

// ---------- Login: only needed to add/remove devices. Anyone can VIEW the dashboard/TV wall/reports without one. ----------
const USERS_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "users.json");
const hashPassword = (pw, salt = crypto.randomBytes(16).toString("hex")) => ({ salt, hash: crypto.scryptSync(pw, salt, 64).toString("hex") });
const checkPassword = (pw, salt, hash) => { try { return crypto.timingSafeEqual(Buffer.from(hash, "hex"), crypto.scryptSync(pw, salt, 64)); } catch { return false; } };

let users;
try { users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); }
catch {
  users = [{ username: "admin", role: "admin", ...hashPassword("iljin@admin1") }];
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  console.warn(`\nCreated users.json with a default admin login — please change this password:\n  admin / iljin@admin1\n(Anyone can VIEW the dashboard without logging in; only adding/removing devices needs this.)\n`);
}

const SESSION_MS = 12 * 60 * 60 * 1000; // 12h, sliding
const sessions = new Map(); // token -> { username, role, exp }
setInterval(() => { const now = Date.now(); for (const [t, s] of sessions) if (s.exp < now) sessions.delete(t); }, 30 * 60 * 1000);

function parseCookies(req) {
  const out = {}, h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(";")) { const i = part.indexOf("="); if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
function getSession(req) {
  const token = parseCookies(req).noc_session;
  const s = token && sessions.get(token);
  if (!s || s.exp < Date.now()) return null;
  s.exp = Date.now() + SESSION_MS;
  return s;
}
function setSessionCookie(res, token, maxAgeSec) {
  res.setHeader("Set-Cookie", `noc_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}`);
}

const keyOf = (d) => `${String(d.ip).trim().toLowerCase()}:${d.port || ""}`;
const newId = (type) => `${type}-${Math.random().toString(36).slice(2, 8)}`;

// Cleans devices.json: unique ids, valid types, and no duplicate IP:port entries.
function normalize(list) {
  const ids = new Set(), keys = new Set();
  return list.flatMap((d) => {
    let type = String(d.type || "").trim().toLowerCase();
    if (!TYPES.includes(type)) { console.warn(`! "${d.name}": unknown type "${d.type}" -> using "server" (valid: ${TYPES.join(", ")})`); type = "server"; }
    const port = d.port ? Number(d.port) : undefined;
    const ip = String(d.ip).trim();
    const k = keyOf({ ip, port });
    if (keys.has(k)) { console.warn(`! Duplicate ignored: "${d.name}" (${k})`); return []; }
    keys.add(k);
    let id = String(d.id || "").trim();
    if (!/^[\w-]+$/.test(id) || ids.has(id)) id = newId(type);
    ids.add(id);
    let subtype;
    if (type === "face") {
      subtype = String(d.subtype || "").trim().toLowerCase();
      if (!FACE_KINDS.includes(subtype)) { console.warn(`! "${d.name}": face device needs "subtype": "attendance" or "door" -> using "attendance"`); subtype = "attendance"; }
    }
    // SLA target (%) for the "ISP SLA" report — only meaningful for ISP links; set per-link in devices.json ("slaTarget": 99.9), else 99.5.
    const slaTarget = type === "wan" ? (Number(d.slaTarget) > 0 && Number(d.slaTarget) <= 100 ? Number(d.slaTarget) : 99.5) : undefined;
    return [{ ...d, id, type, ip, port, subtype, slaTarget }];
  });
}

let devices;
const save = () => fs.writeFileSync(FILE, JSON.stringify(devices, null, 2));
try {
  const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
  devices = normalize(raw);
  if (JSON.stringify(devices) !== JSON.stringify(raw)) { save(); console.warn("devices.json was cleaned up (see warnings above)."); }
} catch (e) { console.error(`Cannot read devices.json: ${e.message}`); process.exit(1); }
const START_TIME = Date.now();
const STARTUP_GRACE_MS = 20000; // devices still "settling" right after boot get batched into one summary instead of one email each
let pendingStartup = []; // [{message, source}] collected during the grace window
let graceOver = false;
setTimeout(() => {
  graceOver = true;
  if (pendingStartup.length) {
    const names = pendingStartup.map((a) => a.message.replace(" stopped responding", ""));
    notifyCritical(`${pendingStartup.length} device(s) offline at startup: ${names.join(", ")}`, "STARTUP");
  }
  pendingStartup = [];
}, STARTUP_GRACE_MS);

const state = {};
let alerts = [], alertId = 1;
const addAlert = (severity, message, source) => {
  alerts = [{ id: alertId++, severity, message, source, time: Date.now() }, ...alerts].slice(0, 60);
  if (severity !== "critical") return;
  if (graceOver) notifyCritical(message, source);
  else pendingStartup.push({ message, source });
};

// Each check sends 3 pings and keeps EVERY reply (not just one), so reports show true min / average / max and packet loss.
// The dashboard tile shows the most recent reply = what a live "ping -t" prints right now.
// Windows prints "time<1ms" for sub-millisecond replies: counted as 0.5 ms everywhere and displayed as "<1 ms".
const parseMs = (line) => {
  const m = /([=<])\s*([\d.]+)\s*ms/i.exec(line);
  if (!m) return null;
  const x = parseFloat(m[2]);
  return Math.round((m[1] === "<" ? x / 2 : x) * 100) / 100;
};
const ping = (ip) => new Promise((resolve) => {
  const N = 3;
  const args = process.platform === "win32" ? ["-n", String(N), "-w", "1000", ip]
    : process.platform === "darwin" ? ["-c", String(N), "-W", "1000", ip] : ["-c", String(N), "-i", "0.3", "-W", "1", ip];
  const t = Date.now();
  execFile("ping", args, { timeout: 8000 }, (err, out) => {
    const replies = String(out || "").split("\n").filter((l) => /ttl=/i.test(l)); // only real replies
    const times = replies.map(parseMs).filter((x) => x !== null);
    if (replies.length && !times.length) times.push(Date.now() - t); // unreadable (non-English) output: fall back to elapsed time
    resolve({ sent: N, times });
  });
});

const tcp = (host, port) => new Promise((resolve) => {
  const t = performance.now();
  const s = net.connect({ host, port, timeout: 2000 });
  s.on("connect", () => { s.destroy(); resolve({ sent: 1, times: [Math.round((performance.now() - t) * 100) / 100] }); });
  s.on("timeout", () => { s.destroy(); resolve({ sent: 1, times: [] }); });
  s.on("error", () => resolve({ sent: 1, times: [] }));
});

const REPORT_MS = 24 * 60 * 60 * 1000; // how much ping history each device keeps for its report
const stampName = () => { const d = new Date(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`; };

const newState = () => ({ status: "unknown", latency: null, history: [], ok: 0, total: 0, fails: 0, since: Date.now(), log: [], logN: 0, logOk: 0 });
const round2 = (x) => Math.round(x * 100) / 100;
function pushLog(s, e) {
  s.log.push(e); s.logN++; if (e.ms !== null) s.logOk++;
  while (s.log.length && e.t - s.log[0].t > REPORT_MS) { const o = s.log.shift(); s.logN--; if (o.ms !== null) s.logOk--; }
}

// The 24h log is also written to data/ so a restart doesn't wipe the report (one line per check; files older than 3 days are deleted).
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const INCIDENTS_FILE = path.join(DATA_DIR, "incidents.json");
const MAX_INCIDENTS = 500;

let incidents = [];
try { incidents = JSON.parse(fs.readFileSync(INCIDENTS_FILE, "utf8")); } catch { incidents = []; }
let incidentsDirty = false;
function saveIncidentsSoon() {
  incidentsDirty = true;
  clearTimeout(saveIncidentsSoon._t);
  saveIncidentsSoon._t = setTimeout(() => {
    if (!incidentsDirty) return;
    incidentsDirty = false;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFile(INCIDENTS_FILE, JSON.stringify(incidents.slice(-MAX_INCIDENTS)), (e) => e && console.error("Could not save incidents.json:", e.message));
  }, 500);
}
function openIncident(d) {
  incidents.push({ id: crypto.randomBytes(6).toString("hex"), deviceId: d.id, deviceName: d.name, type: d.type, start: Date.now(), end: null, rootCause: "" });
  saveIncidentsSoon();
}
function closeIncident(d) {
  const inc = [...incidents].reverse().find((i) => i.deviceId === d.id && i.end === null);
  if (inc) { inc.end = Date.now(); saveIncidentsSoon(); }
}
const dayFile = (t) => path.join(DATA_DIR, `ping-${new Date(t).toISOString().slice(0, 10)}.ndjson`);
let pending = [];
function flushLog() {
  if (!pending.length) return;
  const byFile = {};
  for (const row of pending) (byFile[dayFile(row[0])] ??= []).push(JSON.stringify(row));
  pending = [];
  for (const [f, lines] of Object.entries(byFile)) fs.appendFile(f, lines.join("\n") + "\n", (e) => e && console.error("Could not save ping log:", e.message));
}
function loadLog() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const now = Date.now(), cutoff = now - REPORT_MS, ids = new Set(devices.map((d) => d.id));
  let n = 0;
  for (const f of fs.readdirSync(DATA_DIR).sort()) {
    const m = /^ping-(\d{4}-\d{2}-\d{2})\.ndjson$/.exec(f);
    if (!m) continue;
    if (Date.parse(m[1]) < now - 3 * 86400000) { fs.unlink(path.join(DATA_DIR, f), () => {}); continue; }
    for (const line of fs.readFileSync(path.join(DATA_DIR, f), "utf8").split("\n")) {
      if (!line) continue;
      try {
        const [t, id, ms, a, lo, hi, sent, k] = JSON.parse(line);
        if (t < cutoff || !ids.has(id)) continue;
        pushLog((state[id] ??= newState()), { t, ms, a, lo, hi, n: sent, k }); n++;
      } catch { /* skip a damaged line */ }
    }
  }
  if (n) console.log(`Restored ${n} ping results from the last 24h.`);
}

async function check(d) {
  const r = d.port ? await tcp(d.ip, d.port) : await ping(d.ip);
  const ms = r.times.length ? r.times[r.times.length - 1] : null; // latest reply = what the tile shows
  const s = (state[d.id] ??= newState());
  s.total++;
  if (ms === null) s.fails++; else { s.fails = 0; s.ok++; s.latency = ms; }
  s.history = [...s.history, ms ?? 0].slice(-40);

  // 24h rolling log for the reports: latest reply, average / min / max of all replies, pings sent, replies received.
  const now = Date.now(), k = r.times.length;
  const e = { t: now, ms, a: k ? round2(r.times.reduce((x, y) => x + y, 0) / k) : null, lo: k ? Math.min(...r.times) : null, hi: k ? Math.max(...r.times) : null, n: r.sent, k };
  pushLog(s, e);
  pending.push([e.t, d.id, e.ms, e.a, e.lo, e.hi, e.n, e.k]);

  let next = s.status;
  const warnThreshold = d.warnMs || (d.type === "wan" ? 150 : WARN_MS);
  if (ms !== null) next = ms > warnThreshold ? "warn" : "up";
  else if (s.fails >= 2 || s.status === "unknown") next = "down";
  if (next !== s.status) {
    const src = (d.type || "wan").toUpperCase();
    if (next === "down") { addAlert("critical", `${d.name} stopped responding`, src); openIncident(d); }
    else if (next === "warn") addAlert("warning", `${d.name} slow response (${ms} ms)`, src);
    else if (s.status !== "unknown") addAlert("resolved", `${d.name} back to normal`, src);
    if (s.status === "down" && next !== "down") closeIncident(d);
    s.status = next; s.since = Date.now();
  }
}

// ISP links are just regular devices with type "wan" (added via the "ISP Link" option
// in Add device, or directly in devices.json) — checked the same way as everything else.
const loop = async () => { await Promise.all(devices.map(check)); flushLog(); setTimeout(loop, INTERVAL); };

// Disk usage (servers only): heavier than a ping, so on its own slower loop.
// Two ways in, either is fine — a server can use either or both:
//  1. PUSH (preferred, no admin rights needed at all): tools/report-disk.ps1 runs locally
//     on that server via Task Scheduler and drops a JSON file here. Just needs write access
//     to this shared folder, nothing else.
//  2. PULL (fallback, used only when no file exists yet for that device): this monitor
//     reaches out over WMI/DCOM, which needs admin rights on that server.
const DISK_INTERVAL = 60 * 1000;
const DISK_REPORTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "disk-reports");
fs.mkdirSync(DISK_REPORTS_DIR, { recursive: true });
const DISK_FILE_STALE_MS = 20 * 60 * 1000; // pushed file older than this = the scheduled task probably stopped running

function readDiskReportFile(id) {
  try {
    const p = path.join(DISK_REPORTS_DIR, `${id}.json`);
    const stat = fs.statSync(p);
    const age = Date.now() - stat.mtimeMs;
    if (age > DISK_FILE_STALE_MS) return { ok: false, error: `Report file hasn't updated in ${Math.round(age / 60000)} min — check the scheduled task on that server.`, checkedAt: stat.mtimeMs };
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return { ...data, checkedAt: stat.mtimeMs };
  } catch { return null; } // no file pushed for this device (yet) — fall back to WMI pull
}

const diskState = {}; // deviceId -> latest result (from a pushed file, or a WMI pull)
const diskHistory = {}; // deviceId -> { [drive]: [{t, freeGB}, ...] } — sampled ~hourly, for the "days until full" estimate
const HISTORY_SAMPLE_MS = 60 * 60 * 1000, HISTORY_MAX_POINTS = 24 * 14; // ~14 days of hourly points

function recordDiskHistory(id, disks) {
  const h = (diskHistory[id] ||= {});
  const now = Date.now();
  for (const dsk of disks || []) {
    const arr = (h[dsk.drive] ||= []);
    if (!arr.length || now - arr[arr.length - 1].t >= HISTORY_SAMPLE_MS) {
      arr.push({ t: now, freeGB: dsk.freeGB });
      if (arr.length > HISTORY_MAX_POINTS) arr.shift();
    }
  }
}
// Simple linear regression of free space over time -> days left before that drive hits 0 (null if it isn't shrinking, or not enough history yet).
function daysToFull(id, drive) {
  const pts = diskHistory[id]?.[drive];
  if (!pts || pts.length < 4) return null;
  const t0 = pts[0].t, n = pts.length;
  const xs = pts.map((p) => (p.t - t0) / 86400000), ys = pts.map((p) => p.freeGB);
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slopePerDay = den ? num / den : 0; // GB/day, negative = shrinking
  if (slopePerDay >= -0.01) return null; // flat or growing — no forecast needed
  const latestFree = ys[ys.length - 1];
  const days = latestFree / -slopePerDay;
  return days > 0 && days < 3650 ? Math.round(days) : null;
}

const diskLoop = async () => {
  const servers = devices.filter((d) => d.type === "server");
  for (const d of servers) {
    const pushed = readDiskReportFile(d.id);
    const result = pushed || await getServerHealth(d.ip, { user: d.wmiUser, pass: d.wmiPass, services: d.services || [] }); // one at a time: several concurrent WMI/DCOM calls tend to time each other out
    if (result?.ok && result.disks) {
      recordDiskHistory(d.id, result.disks);
      result.disks = result.disks.map((dsk) => ({ ...dsk, daysToFull: daysToFull(d.id, dsk.drive) }));
    }
    diskState[d.id] = result;
  }
  setTimeout(diskLoop, DISK_INTERVAL);
};

const json = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok, no) => {
  let b = "";
  req.on("data", (c) => { b += c; if (b.length > 10000) req.destroy(); });
  req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch (e) { no(e); } });
});
const view = (d) => {
  const s = state[d.id] || {};
  return { ...d, status: s.status || "unknown", latency: s.latency ?? null, history: s.history || [], since: s.since,
    uptime: s.logN ? +((100 * s.logOk) / s.logN).toFixed(1) : null }; // 24h, same window as the reports
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");

    // ---- Login / logout / who-am-I: always open, never gated ----
    if (req.method === "POST" && url.pathname === "/api/login") {
      const b = await readBody(req);
      const u = users.find((x) => x.username === String(b.username || "").trim().toLowerCase());
      if (!u || !checkPassword(String(b.password || ""), u.salt, u.hash)) return json(res, 401, { error: "Wrong username or password" });
      const token = crypto.randomBytes(24).toString("hex");
      sessions.set(token, { username: u.username, role: u.role, exp: Date.now() + SESSION_MS });
      setSessionCookie(res, token, SESSION_MS / 1000);
      return json(res, 200, { username: u.username, role: u.role });
    }
    if (req.method === "POST" && url.pathname === "/api/logout") {
      const token = parseCookies(req).noc_session;
      if (token) sessions.delete(token);
      setSessionCookie(res, "", 0);
      return json(res, 200, { ok: true });
    }

    // ---- Viewing (every GET — status, reports, TV wall) is open to anyone on the network.
    //      Only changes (adding/removing a device) need an admin login. ----
    const session = getSession(req);
    if (url.pathname === "/api/me") return session ? json(res, 200, { username: session.username, role: session.role }) : json(res, 401, { error: "Not signed in" });
    if (req.method !== "GET" && (!session || session.role !== "admin")) return json(res, 401, { error: "Sign in as admin to make changes" });

    if (req.method === "GET" && url.pathname === "/api/status")
      return json(res, 200, { devices: devices.map(view), alerts });
    if (req.method === "POST" && url.pathname === "/api/devices") {
      const b = await readBody(req);
      const name = String(b.name || "").trim(), ip = String(b.ip || "").trim();
      const port = b.port ? Number(b.port) : undefined;
      if (!name || !HOST_RE.test(ip) || !TYPES.includes(b.type) || (port && !(port > 0 && port < 65536)))
        return json(res, 400, { error: "Check name, IP/hostname, type and port" });
      const dup = devices.find((x) => keyOf(x) === keyOf({ ip, port }));
      if (dup) return json(res, 409, { error: `Already monitored as ${dup.name}` });
      const subtype = b.type === "face" ? String(b.subtype || "") : undefined;
      if (b.type === "face" && !FACE_KINDS.includes(subtype)) return json(res, 400, { error: "Choose the face device purpose: Attendance or Door Access" });
      const vlan = b.vlan !== undefined && b.vlan !== "" ? String(b.vlan).trim() : undefined;
      const uplink = b.uplink !== undefined && b.uplink !== "" ? String(b.uplink).trim() : undefined;
      const services = Array.isArray(b.services) ? b.services.map(String).filter(Boolean) : (typeof b.services === "string" && b.services.trim() ? b.services.split(",").map((s) => s.trim()).filter(Boolean) : undefined);
      const slaTarget = b.type === "wan" && Number(b.slaTarget) > 0 && Number(b.slaTarget) <= 100 ? Number(b.slaTarget) : undefined;
      const d = { id: newId(b.type), name, detail: String(b.detail || "").trim(), ip, type: b.type, ...(port && { port }), ...(subtype && { subtype }), ...(vlan && { vlan }), ...(uplink && { uplink }), ...(services && { services }), ...(slaTarget && { slaTarget }) };
      devices.push(d); save(); check(d);
      return json(res, 201, d);
    }
    // Edit an existing device: VLAN / uplink (for the Topology view) and the Windows services to watch (server health) — no need to delete and re-add.
    const em = req.method === "PATCH" && url.pathname.match(/^\/api\/devices\/([\w-]+)$/);
    if (em) {
      const d = devices.find((x) => x.id === em[1]);
      if (!d) return json(res, 404, { error: "Not found" });
      const b = await readBody(req);
      if (b.detail !== undefined) d.detail = String(b.detail).trim();
      if (b.vlan !== undefined) { const v = String(b.vlan).trim(); if (v) d.vlan = v; else delete d.vlan; }
      if (b.uplink !== undefined) { const v = String(b.uplink).trim(); if (v && v !== d.id) d.uplink = v; else delete d.uplink; }
      if (b.services !== undefined) {
        const list = Array.isArray(b.services) ? b.services.map(String).filter(Boolean) : String(b.services).split(",").map((s) => s.trim()).filter(Boolean);
        if (list.length) d.services = list; else delete d.services;
      }
      if (b.slaTarget !== undefined && d.type === "wan") { const n = Number(b.slaTarget); if (n > 0 && n <= 100) d.slaTarget = n; }
      save();
      return json(res, 200, d);
    }
    const m = req.method === "DELETE" && url.pathname.match(/^\/api\/devices\/([\w-]+)$/);
    if (m) { devices = devices.filter((d) => d.id !== m[1]); delete state[m[1]]; save(); return json(res, 200, { ok: true }); }

    // One device's 24h numbers for the click-through panel (same calculation as the reports)
    const rdt = req.method === "GET" && url.pathname.match(/^\/api\/devices\/([\w-]+)\/detail$/);
    if (rdt) {
      const dev = devices.find((x) => x.id === rdt[1]);
      if (!dev) return json(res, 404, { error: "Not found" });
      const r = buildReportData([dev], state);
      return json(res, 200, { ...r, device: { ...r.devices[0], vlan: dev.vlan || null, uplink: dev.uplink || null, uplinkName: dev.uplink ? devices.find((x) => x.id === dev.uplink)?.name || dev.uplink : null, services: dev.services || [] }, disk: dev.type === "server" ? diskState[dev.id] || { ok: null, error: "Checking…" } : undefined });
    }

    // Excel workbook (.xlsx) with charts: one device, or every device in one file
    const rx = req.method === "GET" && url.pathname.match(/^\/api\/devices\/([\w-]+)\/report\.xlsx$/);
    if (rx || (req.method === "GET" && url.pathname === "/api/report/overall.xlsx")) {
      const list = rx ? devices.filter((x) => x.id === rx[1]) : devices;
      if (!list.length) return json(res, 404, { error: "Not found" });
      const buf = await buildWorkbook(list, state);
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${rx ? list[0].name.replace(/[^\w-]+/g, "_") + "_24h_ping_report" : "ILJIN_NOC_Overall_Report"}_${stampName()}.xlsx"`,
        "Content-Length": buf.length,
      });
      return res.end(buf);
    }

    const rm = req.method === "GET" && url.pathname.match(/^\/api\/devices\/([\w-]+)\/report$/);
    if (rm) {
      const d = devices.find((x) => x.id === rm[1]);
      if (!d) return json(res, 404, { error: "Not found" });
      const log = state[d.id]?.log || [];
      const csv = deviceCsv(d, state);
      const filename = `${d.name.replace(/[^\w-]+/g, "_")}_24h_ping_report.csv`;
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      });
      return res.end(csv);
    }

    // Incident log: every device outage, fleet-wide, with an admin-editable root-cause note and MTTR.
    if (req.method === "GET" && url.pathname === "/api/incidents") {
      const list = [...incidents].reverse().slice(0, 300);
      const resolved = incidents.filter((i) => i.end != null);
      const mttrMin = resolved.length ? Math.round(resolved.reduce((t, i) => t + (i.end - i.start), 0) / resolved.length / 60000) : null;
      return json(res, 200, { incidents: list, mttrMin, resolvedCount: resolved.length, openCount: incidents.length - resolved.length });
    }
    const incM = req.method === "PATCH" && url.pathname.match(/^\/api\/incidents\/([\w-]+)$/);
    if (incM) {
      if (session.role !== "admin") return json(res, 401, { error: "Sign in as admin to make changes" });
      const inc = incidents.find((i) => i.id === incM[1]);
      if (!inc) return json(res, 404, { error: "Incident not found" });
      const b = await readBody(req);
      inc.rootCause = String(b.rootCause ?? "").slice(0, 500);
      saveIncidentsSoon();
      return json(res, 200, inc);
    }

    // ISP SLA report: uptime vs the contracted target for every ISP link, with a Met/Breached verdict.
    if (req.method === "GET" && url.pathname === "/api/report/isp-sla.csv") {
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="ILJIN_ISP_SLA_Report_${stampName()}.csv"` });
      return res.end(buildIspSlaCsv(devices, state));
    }

    // Overall report: every device in one file. ?inline=1 opens it in the browser instead of downloading.
    if (req.method === "GET" && url.pathname === "/api/report/overall") {
      const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" };
      if (url.searchParams.get("inline") !== "1") headers["Content-Disposition"] = `attachment; filename="ILJIN_NOC_Overall_Report_${stampName()}.html"`;
      res.writeHead(200, headers);
      return res.end(buildOverallReport(devices, state));
    }
    // Every device's raw 24h ping log combined into one CSV (opens in Excel).
    if (req.method === "GET" && url.pathname === "/api/report/overall.csv") {
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ILJIN_NOC_All_Devices_24h_ping_${stampName()}.csv"`,
      });
      for (const chunk of overallCsvChunks(devices, state)) res.write(chunk);
      return res.end();
    }

    json(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    if (res.headersSent) res.end(); else json(res, 400, { error: "Bad request" });
  }
}).listen(PORT, "0.0.0.0", () => console.log(`Monitor API running on http://0.0.0.0:${PORT} (reachable from any of this PC's IPs/VLANs — allow it through Windows Firewall if other PCs/TVs on the network need to reach it)`));
loadLog();
loop();
diskLoop();
