// Request/response helpers shared by the API functions.
const crypto = require("crypto");

class UserError extends Error {
  constructor(message, status = 400, extra) { super(message); this.status = status; this.extra = extra; }
}

// A setup problem (missing Vercel setting, database unreachable). Safe to show: it never contains secret values.
class ConfigError extends Error {}

const MAX_BODY = 6 * 1024 * 1024;

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  let raw = "";
  if (typeof req.body === "string") raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString("utf8");
  else {
    raw = await new Promise((resolve, reject) => {
      let s = "", n = 0;
      req.on("data", (c) => { n += c.length; if (n > MAX_BODY) { reject(new UserError("Request is too large.", 413)); req.destroy(); } else s += c; });
      req.on("end", () => resolve(s));
      req.on("error", reject);
    });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new UserError("Invalid request."); }
}

// Raw body (for webhook signature checks in Phase 2).
async function readRaw(req) {
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  return new Promise((resolve, reject) => {
    let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => resolve(s)); req.on("error", reject);
  });
}

function send(res, status, obj, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function isLocal(req) {
  const host = String(req.headers.host || "");
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}

function cookie(req, name, value, maxAgeSec) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`];
  if (!isLocal(req)) parts.push("Secure");
  return parts.join("; ");
}

function addCookie(res, c) {
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", prev ? [].concat(prev, c) : [c]);
}

// Blocks cross-site form posts. Browsers send Origin on POST; it must match our host.
function checkOrigin(req) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.origin;
  if (!origin) {
    // Our pages always send this header; plain cross-site form posts cannot.
    if (req.headers["x-requested-with"] !== "fetch") throw new UserError("Request blocked.", 403);
    return;
  }
  let host;
  try { host = new URL(origin).host; } catch { throw new UserError("Request blocked.", 403); }
  if (host !== req.headers.host && host !== req.headers["x-forwarded-host"]) throw new UserError("Request blocked.", 403);
}

function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xf || req.socket?.remoteAddress || "0.0.0.0";
}

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const proto = isLocal(req) ? "http" : "https";
  return `${proto}://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

// Wraps a handler: consistent errors, and no personal data in logs.
function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof UserError) return send(res, e.status, { error: e.message, ...(e.extra || {}) });
      if (e instanceof ConfigError) {
        console.error("[setup]", e.message);
        return send(res, 503, { error: `The site isn\u2019t fully set up yet: ${e.message} See /api/site?fn=health for a checklist.`, setup: true });
      }
      const ref = crypto.randomBytes(4).toString("hex");
      console.error(`[error ${ref}]`, e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : String(e));
      send(res, 500, { error: `Something went wrong on our side. Please try again. (ref ${ref})` });
    }
  };
}

module.exports = { UserError, ConfigError, readBody, readRaw, send, parseCookies, cookie, addCookie, checkOrigin, clientIp, siteUrl, handler, isLocal };
