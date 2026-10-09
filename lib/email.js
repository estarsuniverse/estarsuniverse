// Email: templates from the database, a queue with retries, and delivery through Resend.
const { q, one } = require("./db");
const { id, sign } = require("./security");

const MAX_ATTEMPTS = 6;
const BACKOFF_MIN = [0, 5, 30, 120, 720, 1440];   // minutes before attempt n+1
const SENSITIVE = new Set(["signin_code", "staff_invite"]);   // bodies are redacted once sent

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fill = (tpl, vars, escape) => String(tpl).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (escape ? esc(vars[k] ?? "") : String(vars[k] ?? "")));

function renderHtml(bodyText, vars, site, footerHtml) {
  const brand = (site && site.brand) || {};
  const logo = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.logoAlt || brand.orgName)}" style="max-height:56px;max-width:220px">`
    : `<div style="font-family:Georgia,serif;font-size:22px;color:#000">${esc(brand.orgName || "Empowered Wombman")}</div>`;
  const paras = fill(bodyText, vars, true).split(/\n{2,}/).map((p) => {
    const html = p.replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#615932">$1</a>');
    return /^\d{6}$/.test(p.trim())
      ? `<p style="font-size:32px;letter-spacing:8px;font-weight:600;margin:24px 0">${html}</p>`
      : `<p style="margin:0 0 16px">${html}</p>`;
  }).join("");
  return `<!doctype html><html><body style="margin:0;background:#FFFAFA;padding:24px 12px">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-top:4px solid #615932;padding:32px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#000">
<div style="margin-bottom:24px">${logo}</div>${paras}
<div style="border-top:1px solid #e6e1d3;margin-top:28px;padding-top:16px;font-size:13px;color:#3d3a33">${footerHtml || ""}</div>
</div></body></html>`;
}

function unsubscribeUrl(base, email) {
  return `${base}/api/site?fn=unsubscribe&t=${encodeURIComponent(sign({ e: email, k: "mkt" }))}`;
}

// Creates an email job from a template. Returns the job id, or null if the template is turned off.
// Pass `t` to enqueue inside a transaction (the job is only created if the transaction commits).
async function enqueue({ t, to, templateKey, vars = {}, ref, baseUrl, site }) {
  const run = t ? (s, p) => t.query(s, p).then((r) => r.rows) : q;
  const [tpl] = await run("SELECT * FROM email_templates WHERE key = $1", [templateKey]);
  if (!tpl || !tpl.enabled) return null;
  if (!site) site = (await run("SELECT published FROM content WHERE key = 'site'"))[0]?.published || {};
  const org = (site.brand && site.brand.orgName) || "Empowered Wombman";
  let footer = `${esc(org)}`;
  if (site.contact && site.contact.email) footer += ` &middot; <a href="mailto:${esc(site.contact.email)}" style="color:#615932">${esc(site.contact.email)}</a>`;
  if (tpl.category === "campaign" && baseUrl) footer += `<br><a href="${esc(unsubscribeUrl(baseUrl, to))}" style="color:#615932">Unsubscribe from updates</a>`;
  const subject = fill(tpl.subject, vars, false).replace(/[\r\n]+/g, " ").slice(0, 200);
  const text = fill(tpl.body, vars, false) + `\n\n${org}`;
  const html = renderHtml(tpl.body, vars, site, footer);
  const jobId = id("em");
  await run(
    `INSERT INTO email_jobs (id, to_email, template_key, subject, html, text_body, ref) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [jobId, to, templateKey, subject, html, text, ref || null]
  );
  return jobId;
}

async function deliver(job) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("Email is not configured yet (RESEND_API_KEY is missing).");
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error("EMAIL_FROM is not set (for example: Empowered Wombman <hello@yourdomain.com>).");
  const body = { from, to: [job.to_email], subject: job.subject, html: job.html, text: job.text_body };
  if (process.env.REPLY_TO) body.reply_to = process.env.REPLY_TO;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": job.id },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${r.status}: ${String(data.message || data.name || "send failed").slice(0, 200)}`);
  return data.id || "sent";
}

// Attempts one job. Safe to call concurrently: only one caller can claim it.
async function attempt(jobId) {
  const job = await one(
    `UPDATE email_jobs SET status = 'sending', attempts = attempts + 1
     WHERE id = $1 AND status IN ('queued','failed') AND attempts < $2 RETURNING *`,
    [jobId, MAX_ATTEMPTS]
  );
  if (!job) return false;
  try {
    const providerId = await deliver(job);
    const redact = SENSITIVE.has(job.template_key);
    await q(
      `UPDATE email_jobs SET status = 'sent', sent_at = now(), provider_id = $2, last_error = NULL,
         html = CASE WHEN $3 THEN '[redacted after sending]' ELSE html END,
         text_body = CASE WHEN $3 THEN '[redacted after sending]' ELSE text_body END
       WHERE id = $1`,
      [jobId, providerId, redact]
    );
    return true;
  } catch (e) {
    // Sign-in codes expire in 10 minutes, so they are not retried for long.
    const maxForJob = job.template_key === "signin_code" ? 2 : MAX_ATTEMPTS;
    const mins = BACKOFF_MIN[Math.min(job.attempts, BACKOFF_MIN.length - 1)] || 5;
    await q(
      `UPDATE email_jobs SET status = 'failed', last_error = $2,
         attempts = CASE WHEN attempts >= $4 THEN $5 ELSE attempts END,
         next_attempt_at = now() + make_interval(mins => $3) WHERE id = $1`,
      [jobId, String(e.message || e).slice(0, 300), mins, maxForJob, MAX_ATTEMPTS]
    );
    return false;
  }
}

async function processQueue(limit = 25) {
  await q(`UPDATE email_jobs SET status = 'failed', last_error = coalesce(last_error, 'Interrupted while sending')
           WHERE status = 'sending' AND created_at < now() - interval '10 minutes'`);
  const due = await q(
    `SELECT id FROM email_jobs WHERE status IN ('queued','failed') AND attempts < $1 AND next_attempt_at <= now()
     ORDER BY next_attempt_at LIMIT $2`, [MAX_ATTEMPTS, limit]);
  let sent = 0;
  for (const j of due) if (await attempt(j.id)) sent++;
  return { due: due.length, sent };
}

module.exports = { enqueue, attempt, processQueue, unsubscribeUrl, renderHtml, MAX_ATTEMPTS, esc };
