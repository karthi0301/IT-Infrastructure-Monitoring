// Sends an alert out to email (Outlook/Office365 SMTP) and/or WhatsApp
// (CallMeBot — free for personal use) whenever a device goes offline.
// Nothing here does anything until notify-config.json has it turned on.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const CONFIG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "notify-config.json");

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); }
  catch { return { email: { enabled: false }, whatsapp: { enabled: false } }; }
}

// Simple per-target cooldown so a flapping device can't spam email/WhatsApp —
// same alert text won't re-send within this window.
const COOLDOWN_MS = 2 * 60 * 1000;
const lastSent = new Map();
function throttled(key) {
  const now = Date.now();
  const prev = lastSent.get(key) || 0;
  if (now - prev < COOLDOWN_MS) return true;
  lastSent.set(key, now);
  return false;
}

// One reusable, pooled SMTP connection instead of opening a new one per
// email — opening a fresh connection for every alert is what triggers
// Outlook/Office365's "432 Concurrent connections limit exceeded" when
// several devices go down at once (e.g. right when the server starts).
let transporterCache = null; // { key, transporter }

async function getTransporter(cfg) {
  const key = `${cfg.host}:${cfg.port}:${cfg.user}`;
  if (transporterCache?.key === key) return transporterCache.transporter;
  const nodemailer = await import("nodemailer");
  const port = cfg.port || 587;
  const secure = port === 465;
  const transporter = nodemailer.default.createTransport({
    host: cfg.host, port, secure, requireTLS: !secure,
    auth: { user: cfg.user, pass: cfg.pass },
    pool: true, maxConnections: 1, maxMessages: 50, // one connection, reused and queued
  });
  transporterCache = { key, transporter };
  return transporter;
}

async function sendEmail(cfg, subject, body) {
  if (!cfg.enabled || !cfg.host || !cfg.user || !cfg.pass || !cfg.to) return;
  try {
    const transporter = await getTransporter(cfg);
    await transporter.sendMail({ from: cfg.user, to: cfg.to, subject, text: body });
  } catch (e) {
    console.error("Email alert failed:", e.message);
  }
}

async function sendWhatsapp(cfg, text) {
  if (!cfg.enabled || !cfg.phone || !cfg.apikey) return;
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(cfg.phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(cfg.apikey)}`;
    await fetch(url);
  } catch (e) {
    console.error("WhatsApp alert failed:", e.message);
  }
}

export function notifyCritical(message, source) {
  if (throttled(message)) return;
  const cfg = loadConfig();
  const subject = `ILJIN NOC ALERT: ${message}`;
  const body = `${message}\nSource: ${source}\nTime: ${new Date().toLocaleString("en-IN")}`;
  sendEmail(cfg.email || {}, subject, body);
  sendWhatsapp(cfg.whatsapp || {}, `🔴 ILJIN NOC\n${message}\n(${source})`);
}
