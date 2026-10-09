// Guest sign-in (email one-time code) and the guest portal.
// Every portal query is scoped to the signed-in profile; the browser never chooses whose records to read.
const crypto = require("crypto");
const { q, one, tx } = require("./db");
const { UserError, readBody, send, clientIp, siteUrl } = require("./http");
const { id, hmac, safeEqual } = require("./security");
const { normEmail, text } = require("./validate");
const { enforce, hit } = require("./ratelimit");
const { getSite } = require("./content");
const { currentRetreat, roomsWithUnits, publicRetreat, BASIS_LABEL } = require("./retreat");
const email = require("./email");
const sessions = require("./sessions");

const CODE_TTL_MIN = 10;
const MAX_TRIES = 5;
const SENT_MSG = "If that address can receive email, a 6-digit code is on its way. It expires in 10 minutes. Check your spam folder if you don’t see it.";

// POST fn=auth-start { email, name? }
async function authStart(req, res) {
  const b = await readBody(req);
  const em = normEmail(b.email);
  const name = text(b.name, { max: 100, label: "Name" });
  await enforce(`otp:ip:${clientIp(req)}`, 20, 3600);
  if (!(await hit(`otp:wait:${em}`, 1, 45))) throw new UserError("A code was just sent. Please wait a minute before asking for another.", 429);
  await enforce(`otp:em:${em}`, 5, 3600, "Too many codes requested for this email. Please try again in an hour.");

  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  const jobId = await tx(async (t) => {
    await t.query("UPDATE otp_codes SET consumed_at = now() WHERE email_norm = $1 AND consumed_at IS NULL", [em]);
    await t.query(
      `INSERT INTO otp_codes (id, email_norm, code_hash, name, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(mins => $5))`,
      [id("otp"), em, hmac(`${em}:${code}`), name || null, CODE_TTL_MIN]
    );
    const prof = (await t.query("SELECT name FROM profiles WHERE email_norm = $1", [em])).rows[0];
    const wl = (await t.query("SELECT name FROM waitlist_entries WHERE email_norm = $1 ORDER BY created_at LIMIT 1", [em])).rows[0];
    const greet = (prof && prof.name) || (wl && wl.name) || name || "sistar";
    return email.enqueue({ t, to: em, templateKey: "signin_code", vars: { name: greet, code }, ref: "signin" });
  });
  if (jobId) await email.attempt(jobId);
  send(res, 200, { ok: true, message: SENT_MSG });
}

// POST fn=auth-verify { email, code }
async function authVerify(req, res) {
  const b = await readBody(req);
  const em = normEmail(b.email);
  const code = String(b.code || "").replace(/\D/g, "");
  if (code.length !== 6) throw new UserError("Enter the 6-digit code from your email.", 400, { field: "code" });
  await enforce(`otpv:ip:${clientIp(req)}`, 40, 3600);

  const row = await one(
    `UPDATE otp_codes SET attempts = attempts + 1
     WHERE id = (SELECT id FROM otp_codes WHERE email_norm = $1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1)
     RETURNING *`, [em]);
  const expired = !row || new Date(row.expires_at) < new Date();
  if (expired) throw new UserError("That code has expired or was already used. Request a new code.", 400, { expired: true });
  if (row.attempts > MAX_TRIES) {
    await q("UPDATE otp_codes SET consumed_at = now() WHERE id = $1", [row.id]);
    throw new UserError("Too many incorrect tries. Request a new code.", 400, { expired: true });
  }
  if (!safeEqual(row.code_hash, hmac(`${em}:${code}`))) {
    const left = MAX_TRIES - row.attempts;
    throw new UserError(left > 0 ? `That code doesn’t match. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code doesn’t match. Request a new code.", 400, { field: "code" });
  }

  const profileId = await tx(async (t) => {
    const used = await t.query("UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id", [row.id]);
    if (!used.rows.length) throw new UserError("That code was already used. Request a new code.", 400, { expired: true });
    const wl = (await t.query("SELECT name FROM waitlist_entries WHERE email_norm = $1 ORDER BY created_at LIMIT 1", [em])).rows[0];
    const p = (await t.query(
      `INSERT INTO profiles (id, email_norm, name, verified_at, last_login_at) VALUES ($1,$2,$3, now(), now())
       ON CONFLICT (email_norm) DO UPDATE SET last_login_at = now(), verified_at = coalesce(profiles.verified_at, now()),
         name = coalesce(profiles.name, EXCLUDED.name)
       RETURNING id`,
      [id("pro"), em, (wl && wl.name) || row.name || null]
    )).rows[0];
    // Link by verified email only (never by name).
    await t.query("UPDATE waitlist_entries SET profile_id = $1 WHERE email_norm = $2 AND profile_id IS NULL", [p.id, em]);
    return p.id;
  });
  await sessions.create(req, res, "guest", profileId);
  send(res, 200, { ok: true });
}

async function logout(req, res) {
  await sessions.destroy(req, res, "guest");
  send(res, 200, { ok: true });
}

async function requireGuest(req) {
  const s = await sessions.get(req, "guest");
  if (!s) throw new UserError("Please sign in.", 401, { signedOut: true });
  const p = await one("SELECT * FROM profiles WHERE id = $1", [s.subject_id]);
  if (!p) throw new UserError("Please sign in.", 401, { signedOut: true });
  return p;
}

// GET fn=me : everything the portal shows, for this guest only.
async function me(req, res) {
  const p = await requireGuest(req);
  const retreat = await currentRetreat();
  const [site, rooms] = await Promise.all([getSite("published"), roomsWithUnits(retreat.id)]);
  const entry = await one(
    `SELECT id, name, room_pref, intention, status, marketing_consent, created_at FROM waitlist_entries
     WHERE retreat_id = $1 AND profile_id = $2`, [retreat.id, p.id]);
  const booking = await one(
    `SELECT b.id, b.status, b.total_cents, b.price_snapshot, b.terms_snapshot, b.roommate_pref, b.created_at, b.confirmed_at
     FROM bookings b WHERE b.retreat_id = $1 AND b.profile_id = $2 AND b.status IN ('pending','confirmed') ORDER BY b.created_at DESC LIMIT 1`,
    [retreat.id, p.id]);
  let obligations = [], payments = [];
  if (booking) {
    obligations = await q("SELECT label, amount_cents, due_at, status FROM payment_obligations WHERE booking_id = $1 ORDER BY due_at", [booking.id]);
    payments = await q("SELECT kind, amount_cents, status, created_at FROM transactions WHERE booking_id = $1 ORDER BY created_at", [booking.id]);
  }
  const confirmed = booking && booking.status === "confirmed";
  const portal = site.portal || {};
  const pr = publicRetreat(retreat);
  if (confirmed && retreat.private_address) pr.privateAddress = retreat.private_address;   // confirmed guests only
  const roomName = (rid) => (rooms.find((r) => r.id === rid) || {}).name;
  send(res, 200, {
    profile: { name: p.name, email: p.email_norm },
    retreat: pr,
    leadStatus: entry ? entry.status : "none",
    waitlist: entry ? { ...entry, room_pref_name: entry.room_pref === "any" ? "Any room" : entry.room_pref === "undecided" || !entry.room_pref ? "Not sure yet" : roomName(entry.room_pref) || "Not sure yet" } : null,
    booking: booking ? { status: booking.status, total_cents: booking.total_cents, room: booking.price_snapshot.room_name, roommate_pref: booking.roommate_pref } : null,
    obligations, payments,
    rooms: rooms.filter((r) => r.visible).map((r) => ({ id: r.id, name: r.name, price_cents: r.price_cents, basis: BASIS_LABEL[r.price_basis], occupancy_label: r.occupancy_label })),
    portal: {
      welcome: portal.welcome,
      announcements: portal.announcements || [],
      // Preparation materials are for confirmed guests; waitlisted guests see status and public updates.
      prepareUnlocked: Boolean(confirmed),
      packingList: confirmed ? portal.packingList || [] : [],
      arrivalGuidance: confirmed ? portal.arrivalGuidance || "" : "",
      preparation: confirmed ? portal.preparation || "" : "",
      forms: (portal.forms || []).map((f) => ({ ...f, status: booking ? "not_started" : "after_reservation" })),
      supportText: portal.supportText || "",
    },
    itinerary: site.itinerary || { days: [] },
    contact: site.contact && site.contact.verified ? site.contact : null,
    waitlistText: site.waitlist ? { privacyNotice: site.waitlist.privacyNotice, consentText: site.waitlist.consentText } : {},
  });
}

// POST fn=portal-update { room_pref, intention }  (only this guest's own entry)
async function portalUpdate(req, res) {
  const p = await requireGuest(req);
  const b = await readBody(req);
  const retreat = await currentRetreat();
  let roomPref = text(b.room_pref, { max: 60 });
  if (roomPref && !["any", "undecided"].includes(roomPref)) {
    const r = await one("SELECT id FROM room_types WHERE id = $1 AND retreat_id = $2 AND visible", [roomPref, retreat.id]);
    if (!r) throw new UserError("Please choose a room from the list.");
  }
  const intention = text(b.intention, { max: 500, label: "Your intention" });
  const r = await one(
    `UPDATE waitlist_entries SET room_pref = $1, intention = $2, updated_at = now()
     WHERE retreat_id = $3 AND profile_id = $4 RETURNING id`, [roomPref || null, intention || null, retreat.id, p.id]);
  if (!r) throw new UserError("You’re not on the waiting list yet.");
  send(res, 200, { ok: true });
}

// POST fn=portal-join { room_pref, intention, marketing }  (signed-in guest joins with her verified email)
async function portalJoin(req, res) {
  const p = await requireGuest(req);
  const b = await readBody(req);
  const retreat = await currentRetreat();
  const site = await getSite("published");
  const wl = site.waitlist || {};
  const name = text(b.name || p.name, { max: 100, required: true, label: "Your name" });
  let roomPref = text(b.room_pref, { max: 60 });
  if (roomPref && !["any", "undecided"].includes(roomPref)) {
    const r = await one("SELECT id FROM room_types WHERE id = $1 AND retreat_id = $2 AND visible", [roomPref, retreat.id]);
    if (!r) roomPref = "undecided";
  }
  const intention = text(b.intention, { max: 500, label: "Your intention" });
  const marketing = b.marketing === true;
  const jobId = await tx(async (t) => {
    const ins = await t.query(
      `INSERT INTO waitlist_entries (id, retreat_id, email_norm, email_display, name, room_pref, intention, source, marketing_consent, consent_version, privacy_version, profile_id)
       VALUES ($1,$2,$3,$3,$4,$5,$6,'portal',$7,$8,$9,$10) ON CONFLICT (retreat_id, email_norm) DO NOTHING RETURNING id`,
      [id("wl"), retreat.id, p.email_norm, name, roomPref || null, intention || null, marketing, wl.consentVersion || "unversioned", wl.privacyVersion || "unversioned", p.id]);
    if (!ins.rows.length) return null;
    if (!p.name) await t.query("UPDATE profiles SET name = $1 WHERE id = $2", [name, p.id]);
    await t.query(`INSERT INTO consent_events (email_norm, profile_id, kind, granted, version, source) VALUES ($1,$2,'privacy_notice',true,$3,'portal')`, [p.email_norm, p.id, wl.privacyVersion || "unversioned"]);
    await t.query(`INSERT INTO consent_events (email_norm, profile_id, kind, granted, version, source) VALUES ($1,$2,'marketing',$3,$4,'portal')`, [p.email_norm, p.id, marketing, wl.consentVersion || "unversioned"]);
    return email.enqueue({ t, to: p.email_norm, templateKey: "waitlist_confirmation", vars: { name, portal_url: `${siteUrl(req)}/portal/` }, ref: "waitlist", baseUrl: siteUrl(req), site });
  });
  if (jobId) await email.attempt(jobId);
  send(res, 200, { ok: true, message: wl.successMessage });
}

module.exports = { authStart, authVerify, logout, me, portalUpdate, portalJoin, requireGuest };
