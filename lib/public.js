// Public endpoints: page content and the waiting list.
const { q, one, tx } = require("./db");
const { UserError, readBody, send, clientIp, siteUrl } = require("./http");
const { id, sign, unsign } = require("./security");
const { normEmail, text } = require("./validate");
const { enforce } = require("./ratelimit");
const { getSite, publicView } = require("./content");
const { currentRetreat, roomsWithUnits, publicRetreat, publicRoom } = require("./retreat");
const email = require("./email");
const sessions = require("./sessions");

const TAG_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"];

// GET /api/site?fn=content[&preview=1]
async function content(req, res, query) {
  let which = "published";
  if (query.preview === "1") {
    const s = await sessions.get(req, "admin");
    if (!s || !s.mfa_ok) throw new UserError("Sign in to the admin area to preview drafts.", 401);
    which = "draft";
  }
  const [site, retreat] = await Promise.all([getSite(which), currentRetreat()]);
  const rooms = (await roomsWithUnits(retreat.id)).filter((r) => r.visible).map((r) => publicRoom(r, retreat));
  send(res, 200, {
    preview: which === "draft",
    site: publicView(site),
    retreat: publicRetreat(retreat),
    rooms,
    formToken: sign({ t: Date.now() }),
  });
}

// POST /api/site?fn=waitlist
async function waitlist(req, res) {
  const b = await readBody(req);
  const ip = clientIp(req);

  // Spam protection: hidden field must stay empty, and the form must have been open for a moment.
  const tok = unsign(b.ft);
  const looksLikeBot = Boolean(b.website) || !tok || Date.now() - tok.t < 2000;
  if (!tok && !b.website) throw new UserError("This form has expired. Please refresh the page and try again.");

  const site = await getSite("published");
  const wl = site.waitlist || {};
  const okMessage = wl.successMessage || "You’re on the waiting list.";
  if (looksLikeBot) return send(res, 200, { ok: true, message: okMessage });   // quiet success, nothing saved
  if (Date.now() - tok.t > 2 * 24 * 3600 * 1000) throw new UserError("This form has expired. Please refresh the page and try again.");

  const name = text(b.name, { max: 100, required: true, field: "name", label: "Your name" });
  const em = normEmail(b.email);
  const intention = text(b.intention, { max: 500, field: "intention", label: "Your intention" });
  const marketing = b.marketing === true;
  await enforce(`wl:ip:${ip}`, 10, 3600, "Too many sign-ups from this connection. Please try again in an hour.");
  await enforce(`wl:em:${em}`, 4, 3600, "Please wait a little before trying again.");

  const retreat = await currentRetreat();
  let roomPref = text(b.room_pref, { max: 60 });
  if (roomPref && !["any", "undecided"].includes(roomPref)) {
    const r = await one("SELECT id FROM room_types WHERE id = $1 AND retreat_id = $2 AND visible", [roomPref, retreat.id]);
    if (!r) roomPref = "undecided";
  }
  const tags = {};
  if (b.tags && typeof b.tags === "object") for (const k of TAG_KEYS) if (b.tags[k]) tags[k] = text(b.tags[k], { max: 80 });
  const source = text(b.source, { max: 60 }) || "public_page";

  const jobId = await tx(async (t) => {
    const prof = (await t.query("SELECT id FROM profiles WHERE email_norm = $1", [em])).rows[0];
    const ins = await t.query(
      `INSERT INTO waitlist_entries (id, retreat_id, email_norm, email_display, name, room_pref, intention, source, tags,
         marketing_consent, consent_version, privacy_version, profile_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (retreat_id, email_norm) DO NOTHING RETURNING id`,
      [id("wl"), retreat.id, em, String(b.email).trim().slice(0, 254), name, roomPref || null, intention || null, source,
       JSON.stringify(tags), marketing, wl.consentVersion || "unversioned", wl.privacyVersion || "unversioned", prof ? prof.id : null]
    );
    if (!ins.rows.length) return null;   // already on the list: same calm response, no second email
    await t.query(`INSERT INTO consent_events (email_norm, profile_id, kind, granted, version, source) VALUES ($1,$2,'privacy_notice',true,$3,$4)`,
      [em, prof ? prof.id : null, wl.privacyVersion || "unversioned", source]);
    await t.query(`INSERT INTO consent_events (email_norm, profile_id, kind, granted, version, source) VALUES ($1,$2,'marketing',$3,$4,$5)`,
      [em, prof ? prof.id : null, marketing, wl.consentVersion || "unversioned", source]);
    // The confirmation is queued inside the same transaction, so it exists only if the save succeeded.
    return email.enqueue({ t, to: em, templateKey: "waitlist_confirmation", vars: { name, portal_url: `${siteUrl(req)}/portal/` }, ref: "waitlist", baseUrl: siteUrl(req), site });
  });
  if (jobId) await email.attempt(jobId);   // a failure stays queued and is retried by the scheduled job
  send(res, 200, { ok: true, message: okMessage });
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

module.exports = { content, waitlist, unsubscribe };
