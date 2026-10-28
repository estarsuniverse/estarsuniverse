// Public endpoints: page content, and the unsubscribe link in emails already sent.
const { tx } = require("./db");
const { UserError, send } = require("./http");
const { unsign } = require("./security");
const { getSite, publicView } = require("./content");
const { currentRetreat, roomsWithUnits, publicRetreat, publicRoom, soldCounts } = require("./retreat");
const { signInRequired } = require("./adminauth");
const email = require("./email");
const sessions = require("./sessions");

// GET /api/site?fn=content[&preview=1]
async function content(req, res, query) {
  let which = "published";
  if (query.preview === "1") {
    const s = await sessions.get(req, "admin");
    if (signInRequired() && (!s || !s.mfa_ok)) throw new UserError("Sign in to the admin area to preview drafts.", 401);
    which = "draft";
  }
  const [site, retreat] = await Promise.all([getSite(which), currentRetreat()]);
  const sold = await soldCounts(retreat.id);
  const rooms = (await roomsWithUnits(retreat.id)).filter((r) => r.visible).map((r) => publicRoom(r, retreat, sold[r.id] || 0));
  send(res, 200, {
    preview: which === "draft",
    site: publicView(site),
    retreat: publicRetreat(retreat, sold),
    rooms,
  });
}

// GET /api/site?fn=unsubscribe&t=...
async function unsubscribe(req, res, query) {
  const p = unsign(query.t);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex");
  if (!p || p.k !== "mkt" || !p.e) {
    res.statusCode = 400;
    return res.end(page("This link is not valid", "Please contact us and we will update your preferences."));
  }
  const em = String(p.e).toLowerCase();
  await tx(async (t) => {
    await t.query("UPDATE waitlist_entries SET marketing_consent = false, updated_at = now() WHERE email_norm = $1", [em]);
    await t.query(`INSERT INTO consent_events (email_norm, kind, granted, version, source) VALUES ($1,'marketing',false,'unsubscribe','email_link')`, [em]);
  });
  res.statusCode = 200;
  res.end(page("You’re unsubscribed", "You will no longer receive updates and offerings. You will still receive messages about any reservation you make."));
}

function page(title, msg) {
  const e = email.esc;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title>
<body style="margin:0;background:#FFFAFA;font-family:system-ui,sans-serif;color:#000;display:grid;place-items:center;min-height:100vh;padding:24px">
<main style="max-width:480px;text-align:center"><h1 style="font-family:Georgia,serif;font-weight:400">${e(title)}</h1><p>${e(msg)}</p><p><a href="/" style="color:#615932">Back to the retreat</a></p></main>`;
}

module.exports = { content, unsubscribe };
