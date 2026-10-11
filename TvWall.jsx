import React, { useEffect, useMemo, useState } from "react";

const PAGE_SIZE = 24; // tiles per page before it rotates to the next
const ROTATE_MS = 12000;
const STATUS_LABEL = { up: "Online", warn: "Degraded", down: "Offline", unknown: "Checking" };
const RANK = { down: 0, warn: 1, unknown: 2, up: 3 };

// Same short beep used for the live dashboard's toast, looped while something critical is unresolved.
const BEEP = "data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export default function TvWall() {
  const [data, setData] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [page, setPage] = useState(0);

  const load = () => fetch("/api/status").then((r) => r.json()).then(setData).catch(() => {});
  useEffect(() => {
    load();
    const a = setInterval(load, 4000), b = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(a); clearInterval(b); };
  }, []);

  const devices = data?.devices || [];
  const sorted = useMemo(() => [...devices].sort((a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name)), [devices]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  useEffect(() => {
    if (pages <= 1) { setPage(0); return; }
    const t = setInterval(() => setPage((p) => (p + 1) % pages), ROTATE_MS);
    return () => clearInterval(t);
  }, [pages]);
  const shown = sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const downN = devices.filter((d) => d.status === "down").length;
  const warnN = devices.filter((d) => d.status === "warn").length;
  const bannerClass = downN ? "crit" : warnN ? "warn" : "ok";
  const bannerText = downN ? `${downN} device${downN > 1 ? "s" : ""} OFFLINE — immediate attention needed`
    : warnN ? `${warnN} device${warnN > 1 ? "s" : ""} running slow`
    : "All systems operational";

  // Loop an alarm tone while anything is down — this view is meant to be watched, not clicked on.
  useEffect(() => {
    if (!downN) return;
    const audio = new Audio(BEEP);
    audio.loop = true;
    audio.play().catch(() => {});
    return () => { audio.pause(); };
  }, [downN]);

  useEffect(() => { document.title = downN ? `(${downN}) OFFLINE · ILJIN NOC Wall` : "ILJIN NOC Wall"; }, [downN]);

  return (
    <div className="noc-root tv-root">
      <div className="tv-head">
        <h1>ILJIN IT Network Operations — Wall Display</h1>
        <div className="tv-clock">{new Date(now).toLocaleTimeString("en-IN", { hour12: false })}</div>
      </div>
      <div className={`tv-banner ${bannerClass}`}>{bannerText}</div>
      {!data ? (
        <div className="empty">Waiting for monitor server…</div>
      ) : (
        <div className="tv-grid">
          {shown.map((d) => (
            <div key={d.id} className={`tv-tile ${d.status}`}>
              <div className="nm">{d.name}</div>
              <div className="ip">{d.ip}{d.port ? `:${d.port}` : ""}</div>
              <div className="st">{STATUS_LABEL[d.status]}</div>
            </div>
          ))}
        </div>
      )}
      {pages > 1 && (
        <div className="tv-page-dots">
          {Array.from({ length: pages }, (_, i) => <i key={i} className={i === page ? "active" : ""} />)}
        </div>
      )}
    </div>
  );
}
