import React, { useState, useEffect } from "react";
import { Server, Network, Printer, Wifi, Globe, Activity, Clock, Plus, Trash2, Search, X, Boxes, CheckCircle2, AlertTriangle, XCircle, ScanFace, UserCheck, DoorOpen, LayoutGrid, List, Maximize, Download, BarChart3, FileSpreadsheet, ExternalLink, LogOut, Tv, Share2, ClipboardList, Router as RouterIcon, ShieldCheck } from "lucide-react";
import iljinLogo from "./assets/iljin-logo.jpg";
import amberLogo from "./assets/amber-logo.webp";
import Topology from "./Topology.jsx";
import Incidents from "./Incidents.jsx";
import "./styles.css";

const TYPES = {
  server: { label: "Servers", Icon: Server },
  switch: { label: "Switches", Icon: Network },
  router: { label: "Routers", Icon: RouterIcon },
  firewall: { label: "Firewalls", Icon: ShieldCheck },
  ap: { label: "Access Points", Icon: Wifi },
  face: { label: "Face Devices", Icon: ScanFace },
  printer: { label: "Printers", Icon: Printer },
  wan: { label: "ISP Link", Icon: Globe },
};
const SUBTYPES = { attendance: { label: "Attendance", Icon: UserCheck }, door: { label: "Door Access", Icon: DoorOpen } };
const ORDER = ["server", "switch", "router", "firewall", "ap", "face", "printer"];
const iconOf = (d) => (d.type === "face" ? SUBTYPES[d.subtype]?.Icon || ScanFace : (TYPES[d.type] || TYPES.server).Icon);
const labelOf = (d) => (d.type === "face" ? SUBTYPES[d.subtype]?.label : TYPES[d.type]?.label);
const STATUS = { up: "Online", warn: "Degraded", down: "Offline", unknown: "Checking" };
const RANK = { down: 0, warn: 1, unknown: 2, up: 3 };
const SEV = { critical: ["CRIT", "var(--crit)"], warning: ["WARN", "var(--warn)"], resolved: ["OK", "var(--ok)"], info: ["INFO", "var(--info)"] };
const fmtTime = (t) => new Date(t).toLocaleTimeString("en-IN", { hour12: false });
const msParts = (v) => (v == null ? ["…", ""] : v < 1 ? ["<1", "ms"] : [String(v < 10 ? +v.toFixed(1) : Math.round(v)), "ms"]);
const fmtMs = (v) => msParts(v).join(" ").trim();
const Lat = ({ d }) => (
  <div className="tile-lat">{d.status === "down" ? <b className="off">—</b> : <><b>{msParts(d.latency)[0]}</b><small>{msParts(d.latency)[1]}</small></>}</div>
);
const ago = (t) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};

const nice = (v) => { const p = 10 ** Math.floor(Math.log10(v)), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
const clock = (t) => { const x = new Date(t); return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
const fmtDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? (m ? `${h}h ${m}m` : `${h}h`) : m ? `${m}m` : `${s}s`; };

// numbers count up when they change
function useCount(v) {
  const [x, setX] = useState(0);
  const prev = React.useRef(0);
  useEffect(() => {
    const from = prev.current, t0 = performance.now();
    if (from === v || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setX(v); prev.current = v; return; }
    let raf;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 650);
      setX(Math.round(from + (v - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step); else prev.current = v;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [v]);
  return x;
}

function Kpi({ Icon, label, value, total, color, hint }) {
  const n = useCount(value);
  return (
    <div className="kpi" style={color ? { "--c": color } : undefined}>
      <span className="kpi-ico"><Icon size={21} /></span>
      <div className="kpi-body"><div className="cap">{label}</div><div className="num">{n}</div><div className="hint">{hint}</div></div>
      {total != null && <div className="kpi-bar"><i style={{ width: `${total ? (100 * value) / total : 0}%` }} /></div>}
    </div>
  );
}

// smooth latency area for the last ~3 minutes; red ticks = missed checks
function Trend({ h, status }) {
  const id = React.useId().replace(/:/g, ""), n = 40, w = 200, ht = 44;
  const vals = h.slice(-n);
  if (vals.length < 2) return <div className="trend-empty" />;
  const max = Math.max(20, ...vals) * 1.15, step = w / (vals.length - 1), off = 0; // stretch what we have across the full width
  const P = vals.map((v, i) => [off + i * step, ht - 3 - (v / max) * (ht - 9)]);
  const segs = []; let cur = [];
  vals.forEach((v, i) => { if (!v) { if (cur.length) segs.push(cur); cur = []; } else cur.push(i); });
  if (cur.length) segs.push(cur);
  const color = status === "down" ? "#ff4d6a" : status === "warn" ? "#ffc53d" : "#7f9bff";
  const pts = (s) => s.map((i) => `${P[i][0].toFixed(1)},${P[i][1].toFixed(1)}`).join(" ");
  return (
    <svg className="trend" viewBox={`0 0 ${w} ${ht}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".4" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {vals.map((v, i) => !v && <rect key={i} x={P[i][0] - 1.4} y="0" width="2.8" height={ht} fill="#ff4d6a" opacity=".55" />)}
      {segs.map((s, k) => s.length > 1
        ? <g key={k}><polygon points={`${P[s[0]][0]},${ht} ${pts(s)} ${P[s[s.length - 1]][0]},${ht}`} fill={`url(#${id})`} /><polyline points={pts(s)} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></g>
        : null)}
    </svg>
  );
}

function Tile({ d, onDelete, onOpen }) {
  const Icon = iconOf(d);
  return (
    <div className={`tile clickable ${d.status}`} onClick={() => onOpen(d)} title="Click for details">
      <div className="tile-top">
        <span className={`tile-icon type-${d.type}`}><Icon size={15} /></span>
        <div className="tile-id">
          <div className="tile-name">{d.name}</div>
          <div className="tile-detail">{d.detail || labelOf(d)}</div>
        </div>
        <Lat d={d} />
        <div className="tile-actions">
          <a className="icon-btn dl" title="Download this device's Excel report (last 24 h, with graphs)" href={`/api/devices/${d.id}/report.xlsx`} download onClick={(e) => e.stopPropagation()}><Download size={14} /></a>
          {onDelete && <button className="icon-btn" title="Remove device" onClick={(e) => { e.stopPropagation(); onDelete(d); }}><Trash2 size={14} /></button>}
        </div>
      </div>
      {d.type === "face" && <div className="kind-row"><span className={`tag kind-${d.subtype}`}>{labelOf(d)}</span></div>}
      <Trend h={d.history} status={d.status} />
      <div className="tile-bottom mono">
        <span>{d.ip}{d.port ? `:${d.port}` : ""}</span>
        <span>{d.port ? "TCP check" : "ping"}</span>
      </div>
      <div className="tile-foot">
        <span className={`badge ${d.status}`}>{STATUS[d.status]}{d.status !== "unknown" && d.since ? ` · ${ago(d.since)}` : ""}</span>
        <span className="mono dim" title="Share of checks answered in the last 24 hours (same figure as the reports)">{d.uptime != null ? `${d.uptime}% · 24h` : ""}</span>
      </div>
    </div>
  );
}

function Row({ d, onDelete, onOpen }) {
  const Icon = iconOf(d);
  return (
    <div className={`row clickable ${d.status}`} onClick={() => onOpen(d)}>
      <span className="row-name"><Icon size={14} />{d.name}</span>
      <span className="dim row-detail">{d.detail || labelOf(d)}</span>
      <span className="mono">{d.ip}{d.port ? `:${d.port}` : ""}</span>
      <span className={`badge ${d.status}`}>{STATUS[d.status]}{d.status !== "unknown" && d.since ? ` · ${ago(d.since)}` : ""}</span>
      <span className="mono">{d.status === "down" ? "—" : fmtMs(d.latency)}</span>
      <span className="mono dim">{d.uptime != null ? `${d.uptime}%` : ""}</span>
      <a className="icon-btn dl" title="Download Excel report (24 h)" href={`/api/devices/${d.id}/report.xlsx`} download onClick={(e) => e.stopPropagation()}><Download size={13} /></a>
      {onDelete && <button className="icon-btn" title="Remove device" onClick={(e) => { e.stopPropagation(); onDelete(d); }}><Trash2 size={13} /></button>}
    </div>
  );
}

function WanCard({ d, onDelete, onOpen }) {
  return (
    <div className={`wan-card clickable ${d.status}`} onClick={() => onOpen(d)} title="Click for details">
      <div className="wan-card-top">
        <span className="wan-card-icon"><Globe size={16} /></span>
        <div className="wan-card-id">
          <div className="wan-card-name">{d.name}</div>
          <div className="tile-detail">{d.detail || "ISP link"}</div>
        </div>
        <Lat d={d} />
        <div className="tile-actions">
          <a className="icon-btn dl" title="Download this link's Excel report (last 24 h, with graphs)" href={`/api/devices/${d.id}/report.xlsx`} download onClick={(e) => e.stopPropagation()}><Download size={14} /></a>
          {onDelete && <button className="icon-btn" title="Remove device" onClick={(e) => { e.stopPropagation(); onDelete(d); }}><Trash2 size={14} /></button>}
        </div>
      </div>
      <div><span className={`badge ${d.status}`} style={{ display: "inline-block", margin: "10px 0 0" }}>{STATUS[d.status]}</span></div>
      <Trend h={d.history} status={d.status} />
      <div className="tile-bottom mono"><span>{d.ip}</span><span>ping</span></div>
      <div className="tile-foot">
        <span className="mono dim">{d.uptime != null ? `${d.uptime}% available · 24h` : ""}</span>
        <span className="mono dim">{d.since ? ago(d.since) : ""}</span>
      </div>
    </div>
  );
}

// A searchable "which switch/router/device is this plugged into" picker — a plain <select> gets unusable once
// there are 50+ devices, especially with duplicate names (two "B-Block" switches, two "Server Room"...), so this
// shows type + IP + detail alongside the name and lets you type to filter instead of scrolling a long list.
const UPLINK_RANK = { firewall: 0, router: 1, switch: 2 };
function UplinkPicker({ value, onChange, options, selfId }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = React.useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const current = options.find((x) => x.id === value);
  const sorted = React.useMemo(() => [...options].filter((x) => x.id !== selfId).sort((a, b) => {
    const ra = UPLINK_RANK[a.type] ?? 9, rb = UPLINK_RANK[b.type] ?? 9;
    return ra !== rb ? ra - rb : a.name.localeCompare(b.name, undefined, { numeric: true });
  }), [options, selfId]);
  const needle = q.trim().toLowerCase();
  const matches = needle ? sorted.filter((x) => `${x.name} ${x.ip} ${x.detail || ""} ${TYPES[x.type]?.label || ""}`.toLowerCase().includes(needle)) : sorted;
  const describe = (x) => [TYPES[x.type]?.label?.replace(/s$/, ""), x.ip, x.detail].filter(Boolean).join(" · ");
  const pick = (x) => { onChange(x ? x.id : ""); setOpen(false); setQ(""); };
  return (
    <div className="uplink-pick" ref={boxRef}>
      <button type="button" className="uplink-current" onClick={() => setOpen((o) => !o)}>
        {current ? <><b>{current.name}</b><span>{describe(current)}</span></> : <span className="dim">— none / not set —</span>}
        <X size={13} className="uplink-clear" style={{ visibility: current ? "visible" : "hidden" }} onClick={(e) => { e.stopPropagation(); pick(null); }} />
      </button>
      {open && (
        <div className="uplink-menu">
          <div className="uplink-search"><Search size={13} /><input autoFocus placeholder="Type a name or IP to filter…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="uplink-list">
            <div className="uplink-row none" onClick={() => pick(null)}>— none / not set —</div>
            {matches.length === 0 && <div className="uplink-empty">No device matches "{q}"</div>}
            {matches.map((x) => (
              <div key={x.id} className={`uplink-row${x.id === value ? " sel" : ""}`} onClick={() => pick(x)}>
                {React.createElement(iconOf(x), { size: 13 })}
                <span className="un">{x.name}</span>
                <span className="ud">{describe(x)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// click any device: 24-hour graph, stats, outages
function DeviceDrawer({ id, onClose, canEdit, allDevices = [], onSaved }) {
  const [r, setR] = useState(null);
  const [hi, setHi] = useState(null);
  const [edit, setEdit] = useState(false);
  const [ef, setEf] = useState({ vlan: "", uplink: "", services: "" });
  const [eErr, setEErr] = useState(""); const [eBusy, setEBusy] = useState(false);
  const load = () => fetch(`/api/devices/${id}/detail`).then((x) => x.json()).then((j) => setR(j)).catch(() => {});
  useEffect(() => {
    let alive = true;
    const tick = () => fetch(`/api/devices/${id}/detail`).then((x) => x.json()).then((j) => alive && setR(j)).catch(() => {});
    tick();
    const t = setInterval(tick, 10000), key = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => { alive = false; clearInterval(t); window.removeEventListener("keydown", key); };
  }, [id]);
  const d = r?.device;
  const Icon = d ? iconOf(d) : Activity;
  let body = <div className="dim" style={{ padding: "30px 4px" }}>Loading…</div>;
  if (d && !d.total) body = <div className="empty">No ping data collected yet for this device.</div>;
  else if (d) {
    const nb = r.nb, lossy = (b) => b[3] && b[2] / b[3] >= 0.5;
    const avgs = d.b.map((b) => (lossy(b) ? null : b[0])), peaks = d.b.map((b) => (lossy(b) ? null : b[1]));
    const W = 520, H = 190, L = 40, Rt = 8, T = 10, B = 22, pw = W - L - Rt, ph = H - T - B;
    const yMax = nice(Math.max(5, d.warn * 0.4, ...peaks.filter((v) => v != null)) * 1.12);
    const x = (i) => L + (nb > 1 ? (i / (nb - 1)) * pw : pw / 2), y = (v) => T + ph - (Math.min(v, yMax) / yMax) * ph, cw = nb > 1 ? pw / (nb - 1) : pw;
    const div = yMax / 10 ** Math.floor(Math.log10(yMax)) === 2 ? 4 : 5; // round tick labels (10, 20, 30 …)
    const segs = []; let cur = [];
    avgs.forEach((v, i) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(i); });
    if (cur.length) segs.push(cur);
    const line = (s) => s.map((i) => `${x(i).toFixed(1)},${y(avgs[i]).toFixed(1)}`).join(" ");
    const move = (e) => { const bx = e.currentTarget.getBoundingClientRect(), px = ((e.clientX - bx.left) / bx.width) * W; setHi(Math.max(0, Math.min(nb - 1, Math.round(((px - L) / pw) * (nb - 1))))); };
    const hb = hi != null ? d.b[hi] : null;
    const inc = r.incidents.filter((o) => o.id === d.id);
    const avc = d.uptime >= 99.5 ? "var(--ok)" : d.uptime >= 97 ? "var(--warn)" : "var(--crit)";
    const stats = [
      ["Availability", `${d.uptime}%`, `${d.failed} missed checks`, avc], ["Average", fmtMs(d.avg), "every reply"], ["Slowest", fmtMs(d.max), `fastest ${fmtMs(d.min)}`, d.max > d.warn ? "var(--warn)" : null],
      ["Packet loss", `${d.loss ?? 0}%`, `${d.sent - d.recv} of ${d.sent} pings`, d.loss > 1 ? "var(--warn)" : null],
      ["95th percentile", fmtMs(d.p95), "per check"], ["Downtime", d.downMs ? fmtDur(d.downMs) : "None", `${d.outageCount} outage${d.outageCount === 1 ? "" : "s"}`, d.downMs ? "var(--crit)" : null],
      ["Checks", d.total.toLocaleString(), "last 24 h"], ["Slow above", `${d.warn} ms`, "degraded limit"],
    ];
    body = (
      <>
        <div className="dstats">{stats.map(([k, v, sub, c]) => <div className="dstat" key={k}><small>{k}</small><b style={c ? { color: c } : undefined}>{v}</b><em>{sub}</em></div>)}</div>
        <div className="dsec">Latency, last 24 hours</div>
        <div className="dread">{hb ? `${clock(r.b0 + hi * r.bucketMs)} – ${clock(r.b0 + (hi + 1) * r.bucketMs)}  ·  ${!hb[3] ? "no data" : hb[0] == null ? "offline" : `avg ${fmtMs(hb[0])}  ·  slowest ${fmtMs(hb[1])}`}${hb[2] ? `  ·  missed ${hb[2]}/${hb[3]}` : ""}` : "Move over the graph for details"}</div>
        <svg viewBox={`0 0 ${W} ${H}`} className="dsvg" onMouseMove={move} onMouseLeave={() => setHi(null)}>
          <defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7f9bff" stopOpacity=".38" /><stop offset="1" stopColor="#7f9bff" stopOpacity="0" /></linearGradient></defs>
          {Array.from({ length: div + 1 }, (_, k) => k).map((k) => { const v = (yMax * k) / div; return <g key={k}><line x1={L} x2={W - Rt} y1={y(v)} y2={y(v)} stroke="#ffffff14" /><text x={L - 6} y={y(v) + 3.5} textAnchor="end" className="ax">{Math.round(v * 10) / 10}</text></g>; })}
          {d.b.map((b, i) => (lossy(b) ? <rect key={i} x={x(i) - cw / 2} y={T} width={cw} height={ph} fill="#ff4d6a" opacity=".24" /> : null))}
          {d.warn < yMax && <line x1={L} x2={W - Rt} y1={y(d.warn)} y2={y(d.warn)} stroke="#ffc53d" strokeDasharray="4 4" opacity=".7" />}
          {segs.map((s, k) => (s.length > 1
            ? <g key={k}><polygon points={`${x(s[0])},${T + ph} ${line(s)} ${x(s[s.length - 1])},${T + ph}`} fill="url(#dg)" /><polyline points={line(s)} fill="none" stroke="#9db3ff" strokeWidth="2" strokeLinejoin="round" /></g>
            : <circle key={k} cx={x(s[0])} cy={y(avgs[s[0]])} r="2.5" fill="#9db3ff" />))}
          {[0, 0.5, 1].map((f) => <text key={f} x={L + f * pw} y={H - 6} textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"} className="ax">{clock(r.b0 + f * (r.end - r.b0))}</text>)}
          {hi != null && <line x1={x(hi)} x2={x(hi)} y1={T} y2={T + ph} stroke="#ff7a33" />}
          {hi != null && avgs[hi] != null && <circle cx={x(hi)} cy={y(avgs[hi])} r="4" fill="#ff7a33" />}
        </svg>
        <div className="dsec">Health, every {fmtDur(r.bucketMs)}</div>
        <div className="dstrip">{d.b.map((b, i) => { const [a, , fail, n] = b; const c = !n ? "nd" : fail / n >= 0.5 ? "dn" : fail / n >= 0.02 || (a != null && a > d.warn) ? "wn" : ""; return <i key={i} className={c} title={`${clock(r.b0 + i * r.bucketMs)}${n ? ` · ${a == null ? "offline" : `avg ${fmtMs(a)}`} · missed ${fail}/${n}` : " · no data"}`} />; })}</div>
        <div className="dsec">Outages</div>
        {inc.length ? <div className="dinc">{inc.map((o, i) => <div key={i}><span className="dot down" />{clock(o.s)} — {o.ongoing ? <b>still offline</b> : <>back at {clock(o.e)}</>}<em>{fmtDur(o.e - o.s)}</em></div>)}</div>
          : <div className="dim" style={{ fontSize: 13 }}>None — this device answered every check.</div>}
        {d.type === "server" && (
          <>
            <div className="dsec">Disk usage</div>
            {r.disk?.ok ? (
              <div className="disks">
                {r.disk.disks.map((dk) => {
                  const level = dk.percent >= 90 ? "crit" : dk.percent >= 75 ? "warn" : "ok";
                  return (
                    <div className={`disk ${level}`} key={dk.drive}>
                      <div className="disk-top"><b>{dk.drive}</b><span>{dk.percent}%</span></div>
                      <div className="disk-bar"><i style={{ width: `${dk.percent}%` }} /></div>
                      <div className="disk-sub">{dk.usedGB} GB used of {dk.totalGB} GB{dk.daysToFull ? ` · full in ~${dk.daysToFull} day${dk.daysToFull === 1 ? "" : "s"} at this rate` : ""}</div>
                    </div>
                  );
                })}
              </div>
            ) : r.disk?.ok === false ? (
              <div className="dim" style={{ fontSize: 13, lineHeight: 1.6 }}>
                Couldn't get disk info: {r.disk.error} — see the README's "Server disk usage" section for the
                easiest fix (a small script that runs on the server itself, no admin credentials needed).
              </div>
            ) : (
              <div className="dim" style={{ fontSize: 13 }}>Checking… (disk usage refreshes every 5 minutes)</div>
            )}
            {r.disk?.ok && (r.disk.ram || r.disk.cpuPercent != null) && (
              <div className="disks" style={{ marginTop: 8 }}>
                {r.disk.cpuPercent != null && (
                  <div className={`disk ${r.disk.cpuPercent >= 90 ? "crit" : r.disk.cpuPercent >= 75 ? "warn" : "ok"}`}>
                    <div className="disk-top"><b>CPU</b><span>{r.disk.cpuPercent}%</span></div>
                    <div className="disk-bar"><i style={{ width: `${r.disk.cpuPercent}%` }} /></div>
                  </div>
                )}
                {r.disk.ram && (
                  <div className={`disk ${r.disk.ram.percent >= 90 ? "crit" : r.disk.ram.percent >= 75 ? "warn" : "ok"}`}>
                    <div className="disk-top"><b>RAM</b><span>{r.disk.ram.percent}%</span></div>
                    <div className="disk-bar"><i style={{ width: `${r.disk.ram.percent}%` }} /></div>
                    <div className="disk-sub">{r.disk.ram.usedGB} GB used of {r.disk.ram.totalGB} GB</div>
                  </div>
                )}
              </div>
            )}
            {r.disk?.ok && r.disk.services?.length > 0 && (
              <>
                <div className="dsec">Windows services</div>
                <div className="svc-list">
                  {r.disk.services.map((s) => <div className={`svc-row ${s.running ? "up" : "down"}`} key={s.name}><span className="dot" />{s.name}<em>{s.state}</em></div>)}
                </div>
              </>
            )}
          </>
        )}
        {canEdit && (
          <>
            <div className="dsec">Network &amp; health settings {!edit && <button className="link-btn" onClick={() => { setEf({ vlan: d.vlan || "", uplink: d.uplink || "", services: (d.services || []).join(", ") }); setEdit(true); }}>Edit</button>}</div>
            {edit ? (
              <form className="edit-inline" onSubmit={async (e) => {
                e.preventDefault(); setEBusy(true); setEErr("");
                try {
                  const body = { vlan: ef.vlan, uplink: ef.uplink };
                  if (d.type === "server") body.services = ef.services;
                  const res = await fetch(`/api/devices/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
                  if (!res.ok) { setEErr((await res.json()).error || "Could not save"); setEBusy(false); return; }
                  setEdit(false); setEBusy(false); onSaved?.(); load();
                } catch { setEErr("Monitor server is not running"); setEBusy(false); }
              }}>
                <label className="field">VLAN <input placeholder="e.g. 10 or Plant-VLAN" value={ef.vlan} onChange={(e) => setEf({ ...ef, vlan: e.target.value })} /></label>
                {/* a plain div, not <label> — a <label> auto-forwards any click inside it to the first
                    button it contains, which would re-open the picker right after choosing a row */}
                <div className="field">Uplink (which switch/device it connects to)
                  <UplinkPicker value={ef.uplink} onChange={(v) => setEf({ ...ef, uplink: v })} options={allDevices} selfId={d.id} />
                </div>
                {d.type === "server" && <label className="field">Windows services to watch (comma-separated)
                  <input placeholder="Spooler, MSSQLSERVER" value={ef.services} onChange={(e) => setEf({ ...ef, services: e.target.value })} />
                </label>}
                {eErr && <div className="err">{eErr}</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn" disabled={eBusy} type="submit">Save</button>
                  <button className="btn ghost" type="button" onClick={() => setEdit(false)}>Cancel</button>
                </div>
              </form>
            ) : (
              <div className="dim" style={{ fontSize: 13 }}>
                VLAN: {d.vlan || "not set"} · Uplink: {d.uplinkName || "not set"}{d.type === "server" ? ` · Services watched: ${(d.services || []).join(", ") || "none"}` : ""}
              </div>
            )}
          </>
        )}
        <div className="dactions">
          <a className="btn" href={`/api/devices/${d.id}/report.xlsx`} download><Download size={14} /> Excel report</a>
          <a className="btn ghost" href={`/api/devices/${d.id}/report`} download><Download size={14} /> Raw CSV</a>
        </div>
      </>
    );
  }
  return (
    <div className="drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-label="Device details">
        <div className="drawer-head">
          <span className={`tile-icon type-${d?.type}`}><Icon size={17} /></span>
          <div className="drawer-title"><h3>{d?.name || "…"}</h3>{d && <span>{[d.detail || (d.type === "face" ? SUBTYPES[d.subtype]?.label : TYPES[d.type]?.label), `${d.ip}${d.port ? `:${d.port}` : ""}`].filter(Boolean).join("  ·  ")}</span>}</div>
          {d && <span className={`badge ${d.status}`}>{STATUS[d.status]}</span>}
          <button className="icon-btn" style={{ opacity: 1 }} onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {body}
      </aside>
    </div>
  );
}

function AddModal({ onClose, onAdded }) {
  const [f, setF] = useState({ name: "", ip: "", type: "server", detail: "", port: "", subtype: "attendance" });
  const [err, setErr] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      if (r.ok) { onAdded(); onClose(); } else setErr((await r.json()).error || "Could not add device");
    } catch { setErr("Monitor server is not running (npm run dev)"); }
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <h3>Add device</h3>
          <button type="button" className="icon-btn" style={{ opacity: 1 }} onClick={onClose}><X size={16} /></button>
        </div>
        <label className="field">Type
          <select value={f.type} onChange={set("type")}>
            {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v.label.replace(/s$/, "")}</option>)}
          </select>
        </label>
        {f.type === "face" && (
          <label className="field">Purpose
            <select value={f.subtype} onChange={set("subtype")}>
              {Object.entries(SUBTYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </label>
        )}
        <label className="field">Device name
          <input required autoFocus placeholder="PLANT1-CORE-SW01" value={f.name} onChange={set("name")} />
        </label>
        <div className="row2">
          <label className="field">IP / hostname
            <input required placeholder="10.10.0.1" value={f.ip} onChange={set("ip")} />
          </label>
          <label className="field">TCP port (optional)
            <input type="number" placeholder="e.g. 443" value={f.port} onChange={set("port")} />
          </label>
        </div>
        <label className="field">Description (optional)
          <input placeholder="Core · 48P" value={f.detail} onChange={set("detail")} />
        </label>
        {err && <div className="err">{err}</div>}
        <button className="btn" style={{ width: "100%", justifyContent: "center" }}>Add to monitoring</button>
      </form>
    </div>
  );
}

function ReportModal({ onClose, deviceCount }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal report-modal">
        <div className="modal-head">
          <h3>Reports</h3>
          <button type="button" className="icon-btn" style={{ opacity: 1 }} onClick={onClose}><X size={16} /></button>
        </div>
        <p className="report-sub">All {deviceCount} devices · last 24 hours · saved to disk, so a restart does not lose it.</p>

        <div className="report-opt">
          <div className="report-head">
            <span className="report-ico"><BarChart3 size={19} /></span>
            <div><b>Visual report</b><span>Animated graphs for availability, latency and outages, plus a section for every device. Opens in any browser — Print → Save as PDF to share.</span></div>
          </div>
          <div className="report-btns">
            <a className="btn ghost" href="/api/report/overall?inline=1" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Preview</a>
            <a className="btn" href="/api/report/overall" download><Download size={14} /> Download</a>
          </div>
        </div>

        <div className="report-opt">
          <div className="report-head">
            <span className="report-ico sheet"><FileSpreadsheet size={19} /></span>
            <div><b>Excel workbook (.xlsx) with graphs</b><span>Summary with charts, an Outages list and one sheet per device with a latency graph. Every figure is an Excel formula over the minute-by-minute data, so it can be checked.</span></div>
          </div>
          <div className="report-btns">
            <a className="btn" href="/api/report/overall.xlsx" download><Download size={14} /> Download Excel</a>
          </div>
        </div>

        <div className="report-opt">
          <div className="report-head">
            <span className="report-ico raw"><FileSpreadsheet size={19} /></span>
            <div><b>Raw ping data (.csv)</b><span>Every check of every device: latest reply, average / min / max of all replies, pings sent, replies and packet loss.</span></div>
          </div>
          <div className="report-btns">
            <a className="btn ghost" href="/api/report/overall.csv" download><Download size={14} /> Download CSV</a>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminLoginModal({ onClose, onLoggedIn }) {
  const [u, setU] = useState(""), [p, setP] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u.trim(), password: p }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(body.error || "Login failed"); setBusy(false); return; }
      onLoggedIn(body);
    } catch { setErr("Monitor server is not running (npm run dev)"); setBusy(false); }
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit}>
        <div className="modal-head">
          <h3>Admin sign in</h3>
          <button type="button" className="icon-btn" style={{ opacity: 1 }} onClick={onClose}><X size={16} /></button>
        </div>
        <p className="dim" style={{ marginTop: -6, marginBottom: 14, fontSize: 12.5 }}>Only needed to add or remove devices — viewing the dashboard never needs a login.</p>
        <label className="field">Username<input required autoFocus value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" /></label>
        <label className="field">Password<input required type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" /></label>
        {err && <div className="err">{err}</div>}
        <button className="btn" disabled={busy} style={{ width: "100%", justifyContent: "center" }}>Sign in</button>
      </form>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState({ role: "guest" }); // {role:"guest"} until an admin signs in
  const [loginOpen, setLoginOpen] = useState(false);
  const [data, setData] = useState(null);
  const [live, setLive] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [modal, setModal] = useState(false);
  const [reportModal, setReportModal] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [sub, setSub] = useState("all");
  const [view, setView] = useState("grid");
  const [page, setPage] = useState("dashboard"); // "dashboard" | "topology"
  const [toast, setToast] = useState(null);
  const seenAlertIds = React.useRef(null);
  const canEdit = session.role === "admin";

  useEffect(() => {
    fetch("/api/me").then((r) => (r.ok ? r.json() : null)).then((s) => s && setSession(s)).catch(() => {});
  }, []);
  const logout = async () => { await fetch("/api/logout", { method: "POST" }).catch(() => {}); setSession({ role: "guest" }); };

  const load = async () => {
    try {
      const d = await (await fetch("/api/status")).json();
      setData(d); setLive(true);

      // "Normal message" in-app alert: pop a toast + sound + browser notification
      // the moment a NEW critical alert shows up (device just went offline).
      const critIds = new Set((d.alerts || []).filter((a) => a.severity === "critical").map((a) => a.id));
      if (seenAlertIds.current === null) { seenAlertIds.current = critIds; }
      else {
        const fresh = (d.alerts || []).find((a) => a.severity === "critical" && !seenAlertIds.current.has(a.id));
        if (fresh) {
          setToast(fresh);
          try { new Audio("data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=").play().catch(() => {}); } catch {}
          if (typeof Notification !== "undefined") {
            if (Notification.permission === "granted") new Notification("ILJIN NOC alert", { body: fresh.message });
            else if (Notification.permission !== "denied") Notification.requestPermission();
          }
        }
        seenAlertIds.current = critIds;
      }
    } catch { setLive(false); }
  };
  useEffect(() => {
    load();
    const a = setInterval(load, 4000), b = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const remove = async (d) => {
    if (window.confirm(`Remove ${d.name} from monitoring?`)) { await fetch(`/api/devices/${d.id}`, { method: "DELETE" }); load(); }
  };

  const all = data?.devices || [];
  const wans = all.filter((d) => d.type === "wan").sort((a, b) => RANK[a.status] - RANK[b.status]);
  const nonWan = all.filter((d) => d.type !== "wan");
  const count = (s) => all.filter((d) => d.status === s).length;
  const shown = nonWan
    .filter((d) => (type === "all" || d.type === type) && (type !== "face" || sub === "all" || d.subtype === sub) && `${d.name} ${d.ip} ${d.detail}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name));
  const alerts = data?.alerts || [];
  const crit = alerts.filter((a) => a.severity === "critical").length;
  // Prefer the dedicated public-internet check when one is configured — an ISP gateway/router
  // IP can keep answering pings even when that link's actual uplink to the internet is dead,
  // so basing "Internet reachable" on gateway pings alone is misleading. Detected either by the
  // "kind" flag (set when added via devices.json) or by IP (a known public DNS resolver — this
  // is what lets someone add it through the normal "Add device" UI, as ISP Link + 8.8.8.8, and
  // have it just work with no extra field to fill in).
  const PUBLIC_DNS_IPS = ["8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1", "9.9.9.9"];
  const inetCheck = wans.find((w) => w.kind === "internet-check" || PUBLIC_DNS_IPS.includes(w.ip));
  const internetUp = inetCheck
    ? (inetCheck.status === "up" || inetCheck.status === "warn")
    : wans.some((w) => w.status === "up" || w.status === "warn");
  const groups = ORDER.map((k) => [k, shown.filter((d) => d.type === k)]).filter(([, l]) => l.length);
  const issues = [
    ...wans.filter((w) => w.status === "down").map((w) => `${w.name} link down`),
    ...nonWan.filter((d) => d.status === "down").map((d) => `${d.name} offline`),
    ...wans.filter((w) => w.status === "warn").map((w) => `${w.name} slow`),
    ...nonWan.filter((d) => d.status === "warn").map((d) => `${d.name} degraded`),
  ];
  const severe = wans.some((w) => w.status === "down") || nonWan.some((d) => d.status === "down");
  useEffect(() => { document.title = issues.length ? `(${issues.length}) Issues · ILJIN NOC` : "ILJIN IT Network Operations"; }, [issues.length]);
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());

  return (
    <div className="noc-root">
      <header className="header">
        <div className="brand">
          <img className="brand-logo-img" src={iljinLogo} alt="ILJIN" />
          <div><h1>ILJIN IT Network Operations</h1><p>Live campus monitoring</p></div>
          <img className="brand-logo-img amber" src={amberLogo} alt="Amber" />
        </div>
        <div className="header-right">
          <div className="pill"><span className={`live-dot ${live ? "" : "off"}`} /><span className="mono">{live ? "LIVE" : "OFFLINE"}</span></div>
          <div className="pill dim"><Clock size={13} /><span className="mono">{fmtTime(now)}</span></div>
          <button className={`pill iconpill ${page === "topology" ? "on" : ""}`} title="Network topology" onClick={() => setPage(page === "topology" ? "dashboard" : "topology")}><Share2 size={14} /></button>
          <button className={`pill iconpill ${page === "incidents" ? "on" : ""}`} title="Incident log" onClick={() => setPage(page === "incidents" ? "dashboard" : "incidents")}><ClipboardList size={14} /></button>
          <a className="pill iconpill" title="Open NOC wall display (for a TV/monitor)" href="/?tv=1" target="_blank" rel="noreferrer"><Tv size={14} /></a>
          <button className="pill iconpill" title="Full screen (TV mode)" onClick={toggleFull}><Maximize size={14} /></button>
          <button className="btn ghost" onClick={() => setReportModal(true)}><BarChart3 size={15} /> Reports</button>
          {canEdit && <button className="btn" onClick={() => setModal(true)}><Plus size={15} /> Add device</button>}
          {canEdit ? (
            <>
              <div className="pill user"><span className="mono">{session.username}</span><span className="role-tag admin">admin</span></div>
              <button className="pill iconpill" title="Sign out" onClick={logout}><LogOut size={14} /></button>
            </>
          ) : (
            <button className="btn ghost" onClick={() => setLoginOpen(true)}><LogOut size={15} style={{ transform: "scaleX(-1)" }} /> Admin sign in</button>
          )}
        </div>
      </header>

      {!live && <div className="banner">Monitor server is not reachable. Start everything with <b className="mono">npm run dev</b>.</div>}

      {page === "topology" ? (
        <section style={{ marginTop: 18 }}>
          <div className="wan-section-head" style={{ marginBottom: 12 }}>
            <div className="wan-title"><Share2 size={14} /> Network topology</div>
            <span className="dim" style={{ fontSize: 12.5 }}>{all.length} devices · Internet → Firewall → switches → devices, following each device's Uplink · drag to pan, scroll to zoom, click a device to open it</span>
          </div>
          <Topology devices={all} onOpen={(x) => setDetailId(x.id)} />
        </section>
      ) : page === "incidents" ? (
        <Incidents canEdit={canEdit} />
      ) : (
      <div className="layout">
        <main>
          {issues.length > 0 && (
            <div className={`attn ${severe ? "" : "warn"}`}>
              <AlertTriangle size={17} />
              <b>{issues.length} {issues.length === 1 ? "device needs" : "devices need"} attention</b>
              <span>{issues.slice(0, 3).join("  ·  ")}{issues.length > 3 ? `  ·  +${issues.length - 3} more` : ""}</span>
            </div>
          )}
          <div className="kpis">
            <Kpi Icon={Boxes} label="Total devices" value={nonWan.length} />
            <Kpi Icon={CheckCircle2} label="Online" value={nonWan.filter((d) => d.status === "up").length} total={nonWan.length} color="var(--ok)" hint="responding normally" />
            <Kpi Icon={AlertTriangle} label="Degraded" value={nonWan.filter((d) => d.status === "warn").length} total={nonWan.length} color="var(--warn)" hint="slow response" />
            <Kpi Icon={XCircle} label="Offline" value={nonWan.filter((d) => d.status === "down").length} total={nonWan.length} color="var(--crit)" hint="not responding" />
          </div>

          <div className="wan-section">
            <div className="wan-section-head">
              <div className="wan-title"><Globe size={14} /> Internet / ISP links</div>
              {wans.length > 0 && (
                <span className="badge" style={{ background: internetUp ? "#34d3991f" : "#f43f5e22", color: internetUp ? "var(--ok)" : "var(--crit)" }}>
                  {internetUp ? "Internet reachable" : (inetCheck ? "Internet down" : "Both links down")}
                </span>
              )}
            </div>
            {wans.length ? (
              <div className="wan-grid">
                {wans.map((d) => <WanCard key={d.id} d={d} onDelete={canEdit ? remove : undefined} onOpen={(x) => setDetailId(x.id)} />)}
              </div>
            ) : (
              <div className="empty" style={{ padding: "24px 20px" }}>
                No ISP links being monitored yet. Click <b>Add device</b> above, choose type <b>ISP Link</b>,
                and add one entry each for your primary (Ekowebtech) and secondary (Airtel) connections —
                use the IP you can ping to confirm that specific link is up (its gateway/router IP works well).
              </div>
            )}
          </div>

          <div className="toolbar">
            <div className="chips">
              {[["all", "All", nonWan.length], ...Object.entries(TYPES).filter(([k]) => k !== "wan").map(([k, v]) => [k, v.label, nonWan.filter((d) => d.type === k).length])].map(([k, label, n]) => (
                <button key={k} className={`chip ${type === k ? "active" : ""}`} onClick={() => { setType(k); setSub("all"); }}>{label} <b>{n}</b></button>
              ))}
            </div>
            <div className="toolbar-right">
              <div className="search"><Search size={14} /><input placeholder="Search name or IP" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <div className="seg">
                <button className={view === "grid" ? "on" : ""} title="Grid view" onClick={() => setView("grid")}><LayoutGrid size={14} /></button>
                <button className={view === "list" ? "on" : ""} title="List view" onClick={() => setView("list")}><List size={14} /></button>
              </div>
            </div>
          </div>
          {type === "face" && (
            <div className="chips subchips">
              {[["all", "All face devices"], ...Object.entries(SUBTYPES).map(([k, v]) => [k, v.label])].map(([k, label]) => (
                <button key={k} className={`chip ${sub === k ? "active" : ""}`} onClick={() => setSub(k)}>{label} <b>{nonWan.filter((d) => d.type === "face" && (k === "all" || d.subtype === k)).length}</b></button>
              ))}
            </div>
          )}

          {groups.length ? groups.map(([k, list]) => {
            const n = (st) => list.filter((d) => d.status === st).length;
            const GIcon = TYPES[k].Icon;
            return (
              <section key={k} className="group">
                <div className="group-head">
                  <span className="group-title"><GIcon size={15} />{TYPES[k].label}</span>
                  <span className="mono dim group-count">{n("up")}/{list.length} online</span>
                  <div className="healthbar"><i className="ok" style={{ flex: n("up") }} /><i className="warn" style={{ flex: n("warn") }} /><i className="down" style={{ flex: n("down") }} /></div>
                </div>
                {view === "grid" ? (
                  <div className="grid">{list.map((d) => <Tile key={d.id} d={d} onDelete={canEdit ? remove : undefined} onOpen={(x) => setDetailId(x.id)} />)}</div>
                ) : (
                  <div className="list">{list.map((d) => <Row key={d.id} d={d} onDelete={canEdit ? remove : undefined} onOpen={(x) => setDetailId(x.id)} />)}</div>
                )}
              </section>
            );
          }) : (
            <div className="empty">{data ? "No devices match. Use “Add device” to start monitoring one." : "Waiting for monitor server…"}</div>
          )}
        </main>

        <aside className="panel alert-panel">
          <div className="alert-head">
            <h2>Live alerts</h2>
            <span className="pill mono" style={{ padding: "3px 10px", color: crit ? "var(--crit)" : undefined }}>{crit} critical</span>
          </div>
          <div className="alert-list">
            {alerts.length === 0 && <div className="dim" style={{ fontSize: 12.5 }}>No alerts yet — all quiet.</div>}
            {alerts.map((a) => (
              <div key={a.id} className="alert-row" style={{ "--c": SEV[a.severity][1] }}>
                <span className="alert-tag mono">{SEV[a.severity][0]}</span>
                <div>
                  <div className="alert-msg">{a.message}</div>
                  <div className="alert-meta mono">{a.source} · {fmtTime(a.time)}</div>
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
      )}
      {modal && <AddModal onClose={() => setModal(false)} onAdded={load} />}
      {loginOpen && <AdminLoginModal onClose={() => setLoginOpen(false)} onLoggedIn={(s) => { setSession(s); setLoginOpen(false); }} />}
      {detailId && <DeviceDrawer id={detailId} onClose={() => setDetailId(null)} canEdit={canEdit} allDevices={all} onSaved={load} />}
      {reportModal && <ReportModal onClose={() => setReportModal(false)} deviceCount={all.length} />}
      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          <span className="toast-dot" />
          <div>
            <div className="toast-title">Device offline</div>
            <div className="toast-msg">{toast.message}</div>
          </div>
          <button className="icon-btn" style={{ opacity: 1 }} onClick={(e) => { e.stopPropagation(); setToast(null); }}><X size={14} /></button>
        </div>
      )}
    </div>
  );
}
