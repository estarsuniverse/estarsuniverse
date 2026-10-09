// Protected admin actions. Every action re-checks the session, MFA and role on the server.
const fs = require("fs");
const path = require("path");
const { q, one, tx } = require("./db");
const { UserError, siteUrl } = require("./http");
const sec = require("./security");
const v = require("./validate");
const { audit } = require("./audit");
const { requireOwner, invite, publicAdmin } = require("./adminauth");
const { currentRetreat, roomsWithUnits, launchChecklist, BASIS_LABEL } = require("./retreat");
const { getSite } = require("./content");
const { SITE } = require("./defaults");
const email = require("./email");
const sessions = require("./sessions");

// ---------------- Overview ----------------
async function overview(actor) {
  const retreat = await currentRetreat();
  const rooms = await roomsWithUnits(retreat.id);
  const site = await getSite("published");
  const one_ = async (sql, p = [retreat.id]) => (await one(sql, p)) || {};
  const wl = await one_(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week,
      count(*) FILTER (WHERE marketing_consent)::int AS consented,
      count(*) FILTER (WHERE profile_id IS NOT NULL)::int AS activated
    FROM waitlist_entries WHERE retreat_id = $1 AND status <> 'removed'`);
  const bk = await one_(`SELECT count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
      count(*) FILTER (WHERE status = 'pending')::int AS pending FROM bookings WHERE retreat_id = $1`);
  const money = await one_(`SELECT
      coalesce(sum(t.amount_cents) FILTER (WHERE t.kind IN ('payment','manual') AND t.status = 'succeeded'),0)::int AS collected,
      coalesce(sum(t.amount_cents) FILTER (WHERE t.kind = 'refund' AND t.status = 'succeeded'),0)::int AS refunded,
      count(*) FILTER (WHERE t.needs_review)::int AS needs_review
    FROM transactions t JOIN bookings b ON b.id = t.booking_id WHERE b.retreat_id = $1`);
  const owed = await one_(`SELECT coalesce(sum(o.amount_cents),0)::int AS outstanding,
      coalesce(sum(o.amount_cents) FILTER (WHERE o.due_at < now()),0)::int AS overdue
    FROM payment_obligations o JOIN bookings b ON b.id = o.booking_id
    WHERE b.retreat_id = $1 AND b.status IN ('pending','confirmed') AND o.status IN ('due','failed')`);
  const units = rooms.reduce((n, r) => n + r.units.filter((u) => u.status !== "blocked").length, 0);
  const sold = rooms.reduce((n, r) => n + r.units.filter((u) => u.status === "sold").length, 0);
  const prefs = await q(`SELECT coalesce(room_pref,'undecided') AS room, count(*)::int AS n FROM waitlist_entries
    WHERE retreat_id = $1 AND status <> 'removed' GROUP BY 1 ORDER BY 2 DESC`, [retreat.id]);
  const roomName = (id) => id === "any" ? "Any room" : id === "undecided" ? "Not sure yet" : (rooms.find((r) => r.id === id) || {}).name || id;
  const mail = await one_(`SELECT count(*) FILTER (WHERE status = 'failed')::int AS failed,
      count(*) FILTER (WHERE status = 'queued')::int AS queued FROM email_jobs WHERE $1::text IS NOT NULL`, ["x"]);
  return {
    retreat: { name: retreat.name, reservations_open: retreat.reservations_open },
    waitlist: wl,
    bookings: bk,
    conversion: wl.total ? Math.round((bk.confirmed / wl.total) * 1000) / 10 : 0,
    occupancy: { sold, units },
    money: { collected: money.collected - money.refunded, gross: money.collected, refunded: money.refunded, outstanding: owed.outstanding, overdue: owed.overdue, needs_review: money.needs_review },
    prefs: prefs.map((p) => ({ room: roomName(p.room), n: p.n })),
    mail,
    checklist: launchChecklist(retreat, rooms, site),
  };
}

// ---------------- Waiting list ----------------
function wlFilters(b, retreatId) {
  const where = ["w.retreat_id = $1"], p = [retreatId];
  if (b.search) { p.push(`%${String(b.search).toLowerCase().slice(0, 100)}%`); where.push(`(lower(w.name) LIKE $${p.length} OR w.email_norm LIKE $${p.length})`); }
  if (b.room) { p.push(String(b.room)); where.push(`coalesce(w.room_pref,'undecided') = $${p.length}`); }
  if (b.consent === "yes") where.push("w.marketing_consent");
  if (b.consent === "no") where.push("NOT w.marketing_consent");
  if (b.status) { p.push(String(b.status)); where.push(`w.status = $${p.length}`); } else where.push("w.status <> 'removed'");
  if (b.source) { p.push(String(b.source)); where.push(`w.source = $${p.length}`); }
  return { where: where.join(" AND "), p };
}

async function waitlistList(actor, b) {
  const retreat = await currentRetreat();
  const { where, p } = wlFilters(b, retreat.id);
  const rows = await q(`SELECT w.id, w.name, w.email_display, w.room_pref, w.intention, w.source, w.tags, w.marketing_consent, w.consent_version,
      w.status, w.notes, w.created_at, w.profile_id IS NOT NULL AS activated
    FROM waitlist_entries w WHERE ${where} ORDER BY w.created_at DESC LIMIT 2000`, p);
  const rooms = await q("SELECT id, name FROM room_types WHERE retreat_id = $1 ORDER BY sort", [retreat.id]);
  const sources = (await q("SELECT DISTINCT source FROM waitlist_entries WHERE retreat_id = $1 AND source IS NOT NULL", [retreat.id])).map((r) => r.source);
  return { rows, rooms, sources };
}

const csvCell = (x) => {
  let s = x == null ? "" : typeof x === "object" ? JSON.stringify(x) : String(x);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // stops spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Exports only permitted fields. Intentions and staff notes are never exported.
async function waitlistCsv(actor, b) {
  const retreat = await currentRetreat();
  const marketing = b.kind === "marketing";
  const { where, p } = wlFilters(marketing ? { ...b, consent: "yes" } : b, retreat.id);
  const rows = await q(`SELECT w.created_at, w.name, w.email_display, coalesce(r.name, w.room_pref) AS room_pref, w.marketing_consent, w.consent_version,
      w.source, w.tags, w.status, w.profile_id IS NOT NULL AS activated
    FROM waitlist_entries w LEFT JOIN room_types r ON r.id = w.room_pref WHERE ${where} ORDER BY w.created_at`, p);
  const cols = marketing
    ? ["joined_at", "name", "email", "consent_version", "tags"]
    : ["joined_at", "name", "email", "room_preference", "marketing_consent", "consent_version", "source", "tags", "status", "portal_activated"];
  const lines = [cols.join(",")];
  for (const r of rows) {
    const rec = { joined_at: new Date(r.created_at).toISOString(), name: r.name, email: r.email_display, room_preference: r.room_pref || "undecided",
      marketing_consent: r.marketing_consent ? "yes" : "no", consent_version: r.consent_version, source: r.source, tags: r.tags,
      status: r.status, portal_activated: r.activated ? "yes" : "no" };
    lines.push(cols.map((c) => csvCell(rec[c])).join(","));
  }
  await tx((t) => audit(t, actor, "waitlist.export_csv", "waitlist", null, null, { kind: marketing ? "marketing" : "all", rows: rows.length }));
  return { filename: `waitlist-${marketing ? "marketing-" : ""}${new Date().toISOString().slice(0, 10)}.csv`, csv: lines.join("\r\n") };
}

async function waitlistUpdate(actor, b) {
  const status = v.oneOf(b.status, ["waiting", "invited", "converted", "removed"], "Status");
  const notes = v.text(b.notes, { max: 2000, label: "Notes" });
  return tx(async (t) => {
    const before = (await t.query("SELECT status, notes FROM waitlist_entries WHERE id = $1", [b.id])).rows[0];
    if (!before) throw new UserError("Entry not found.", 404);
    await t.query("UPDATE waitlist_entries SET status = $2, notes = $3, updated_at = now() WHERE id = $1", [b.id, status, notes || null]);
    await audit(t, actor, "waitlist.update", "waitlist_entry", b.id, before, { status, notes: notes || null });
    return { ok: true };
  });
}

// ---------------- Clients ----------------
async function clientsList() {
  const retreat = await currentRetreat();
  const rows = await q(`
    SELECT coalesce(p.id, '') AS profile_id, w.id AS waitlist_id, coalesce(p.name, w.name) AS name, coalesce(p.email_norm, w.email_norm) AS email,
      p.verified_at, p.last_login_at, w.status AS lead_status, w.created_at AS joined_at,
      (SELECT status FROM bookings b WHERE b.profile_id = p.id AND b.retreat_id = $1 ORDER BY created_at DESC LIMIT 1) AS booking_status
    FROM waitlist_entries w FULL OUTER JOIN profiles p ON p.id = w.profile_id
    WHERE (w.retreat_id = $1 OR w.retreat_id IS NULL) AND coalesce(w.status,'') <> 'removed'
    ORDER BY coalesce(w.created_at, p.created_at) DESC LIMIT 2000`, [retreat.id]);
  return { rows };
}

async function clientInvite(actor, b, req) {
  const em = v.normEmail(b.email);
  const site = await getSite("published");
  const wl = await one("SELECT name FROM waitlist_entries WHERE email_norm = $1 ORDER BY created_at LIMIT 1", [em]);
  const prof = await one("SELECT name FROM profiles WHERE email_norm = $1", [em]);
  if (!wl && !prof) throw new UserError("That email is not on the waiting list or a client record.");
  const jobId = await tx(async (t) => {
    await audit(t, actor, "client.invite_sent", "client", em);
    await t.query("UPDATE waitlist_entries SET status = CASE WHEN status = 'waiting' THEN 'invited' ELSE status END, updated_at = now() WHERE email_norm = $1", [em]);
    return email.enqueue({ t, to: em, templateKey: "activation_invite", vars: { name: (prof && prof.name) || (wl && wl.name) || "sistar", portal_url: `${siteUrl(req)}/portal/` }, ref: "invite", site });
  });
  if (!jobId) throw new UserError("The portal invitation email template is turned off. Turn it on in Communications.");
  await email.attempt(jobId);
  return { ok: true };
}

// Controlled email change (owner only): updates the profile and waiting-list records, signs the guest out everywhere.
async function clientEmailChange(actor, b) {
  requireOwner(actor);
  const from = v.normEmail(b.from), to = v.normEmail(b.to);
  if (from === to) throw new UserError("The new email is the same as the old one.");
  await tx(async (t) => {
    if ((await t.query("SELECT 1 FROM profiles WHERE email_norm = $1", [to])).rows.length) throw new UserError("Another client already uses that email.");
    if ((await t.query("SELECT 1 FROM waitlist_entries WHERE email_norm = $1", [to])).rows.length) throw new UserError("That email is already on the waiting list.");
    const p = (await t.query("UPDATE profiles SET email_norm = $2 WHERE email_norm = $1 RETURNING id", [from, to])).rows[0];
    await t.query("UPDATE waitlist_entries SET email_norm = $2, email_display = $2, updated_at = now() WHERE email_norm = $1", [from, to]);
    if (p) await t.query("DELETE FROM sessions WHERE kind = 'guest' AND subject_id = $1", [p.id]);
    await audit(t, actor, "client.email_changed", "client", p ? p.id : from, { email: from }, { email: to, reason: v.text(b.reason, { max: 300 }) });
  });
  return { ok: true };
}

// ---------------- Rooms and inventory ----------------
async function roomsList() {
  const retreat = await currentRetreat();
  const rooms = await roomsWithUnits(retreat.id);
  const prefs = await q(`SELECT room_pref, count(*)::int AS n FROM waitlist_entries WHERE retreat_id = $1 AND status <> 'removed' GROUP BY 1`, [retreat.id]);
  for (const r of rooms) r.waitlist_interest = (prefs.find((p) => p.room_pref === r.id) || {}).n || 0;
  return { rooms, basisLabels: BASIS_LABEL };
}

const OWNER_ROOM_FIELDS = ["price_cents", "price_basis", "includes_admission", "guest_capacity", "inventory_confirmed"];

function cleanPhotos(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).map((p) => ({ url: v.url(p.url, "Photo"), alt: v.text(p.alt, { max: 200, label: "Photo description" }) })).filter((p) => p.url);
}

async function roomSave(actor, b) {
  const retreat = await currentRetreat();
  const next = {
    name: v.text(b.name, { max: 80, required: true, label: "Room name" }),
    sort: v.intOrNull(b.sort, { min: 0, max: 10000, label: "Order" }) ?? 0,
    price_cents: v.cents(b.price_cents, { label: "Price" }),
    price_basis: v.oneOf(b.price_basis, Object.keys(BASIS_LABEL), "Price basis"),
    includes_admission: v.oneOf(b.includes_admission, ["unconfirmed", "yes", "no"], "Admission"),
    occupancy_label: v.text(b.occupancy_label, { max: 120, label: "Occupancy" }) || null,
    guest_capacity: v.intOrNull(b.guest_capacity, { min: 1, max: 20, label: "Guest capacity" }),
    beds: v.text(b.beds, { max: 300, label: "Beds" }) || null,
    bathroom: v.text(b.bathroom, { max: 300, label: "Bathroom" }) || null,
    privacy: v.text(b.privacy, { max: 300, label: "Privacy" }) || null,
    features: v.text(b.features, { max: 300, label: "Features" }) || null,
    accessibility: v.text(b.accessibility, { max: 600, label: "Accessibility" }) || null,
    difference_note: v.text(b.difference_note, { max: 600, label: "What makes this room different" }) || null,
    description: v.text(b.description, { max: 2000, label: "Description" }) || null,
    photos: cleanPhotos(b.photos),
    visible: b.visible !== false,
    inventory_confirmed: b.inventory_confirmed === true,
  };
  return tx(async (t) => {
    let before = null;
    if (b.id) {
      before = (await t.query("SELECT * FROM room_types WHERE id = $1 AND retreat_id = $2 FOR UPDATE", [b.id, retreat.id])).rows[0];
      if (!before) throw new UserError("Room not found.", 404);
      if (actor.role !== "owner") {
        const changed = OWNER_ROOM_FIELDS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]));
        if (changed.length) throw new UserError(`Only the owner can change ${changed.map((k) => k.replace(/_/g, " ").replace("cents", "")).join(", ")}.`, 403);
      }
      const cols = Object.keys(next);
      await t.query(`UPDATE room_types SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
        [b.id, ...cols.map((c) => (c === "photos" ? JSON.stringify(next[c]) : next[c]))]);
      const plain = { ...before, photos: before.photos };
      await audit(t, actor, before.price_cents !== next.price_cents ? "room.price_changed" : "room.updated", "room_type", b.id, plain, { ...plain, ...next });
      return { ok: true, id: b.id };
    }
    requireOwner(actor);
    const id = sec.id("room");
    const cols = Object.keys(next);
    await t.query(`INSERT INTO room_types (id, retreat_id, ${cols.join(", ")}) VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(", ")})`,
      [id, retreat.id, ...cols.map((c) => (c === "photos" ? JSON.stringify(next[c]) : next[c]))]);
    await t.query("INSERT INTO inventory_units (id, retreat_id, room_type_id, label) VALUES ($1,$2,$3,$4)", [sec.id("unit"), retreat.id, id, next.name]);
    await audit(t, actor, "room.created", "room_type", id, null, next);
    return { ok: true, id };
  });
}

async function roomDelete(actor, b) {
  requireOwner(actor);
  return tx(async (t) => {
    const r = (await t.query("SELECT * FROM room_types WHERE id = $1", [b.id])).rows[0];
    if (!r) throw new UserError("Room not found.", 404);
    const used = (await t.query("SELECT 1 FROM bookings WHERE room_type_id = $1 LIMIT 1", [b.id])).rows.length;
    if (used) throw new UserError("This room has bookings, so it can’t be deleted. Hide it instead.");
    await t.query("DELETE FROM holds WHERE unit_id IN (SELECT id FROM inventory_units WHERE room_type_id = $1)", [b.id]);
    await t.query("DELETE FROM room_types WHERE id = $1", [b.id]);
    await audit(t, actor, "room.deleted", "room_type", b.id, r, null);
    return { ok: true };
  });
}

async function unitSave(actor, b) {
  requireOwner(actor);
  const label = v.text(b.label, { max: 80, required: true, label: "Unit name" });
  const status = v.oneOf(b.status || "available", ["available", "blocked"], "Status");
  return tx(async (t) => {
    if (b.id) {
      const before = (await t.query("SELECT * FROM inventory_units WHERE id = $1 FOR UPDATE", [b.id])).rows[0];
      if (!before) throw new UserError("Unit not found.", 404);
      if (before.status === "sold") throw new UserError("This unit is sold, so its status is managed by its booking.");
      await t.query("UPDATE inventory_units SET label = $2, status = $3 WHERE id = $1", [b.id, label, status]);
      await audit(t, actor, "inventory.unit_updated", "inventory_unit", b.id, before, { ...before, label, status });
      return { ok: true };
    }
    const room = (await t.query("SELECT id, retreat_id FROM room_types WHERE id = $1", [b.room_type_id])).rows[0];
    if (!room) throw new UserError("Room not found.", 404);
    const id = sec.id("unit");
    await t.query("INSERT INTO inventory_units (id, retreat_id, room_type_id, label, status) VALUES ($1,$2,$3,$4,$5)", [id, room.retreat_id, room.id, label, status]);
    await audit(t, actor, "inventory.unit_added", "inventory_unit", id, null, { room_type_id: room.id, label, status });
    return { ok: true };
  });
}

async function unitDelete(actor, b) {
  requireOwner(actor);
  return tx(async (t) => {
    const u = (await t.query("SELECT * FROM inventory_units WHERE id = $1 FOR UPDATE", [b.id])).rows[0];
    if (!u) throw new UserError("Unit not found.", 404);
    if (u.status === "sold" || (await t.query("SELECT 1 FROM bookings WHERE unit_id = $1 LIMIT 1", [b.id])).rows.length) throw new UserError("This unit has a booking and can’t be removed.");
    await t.query("DELETE FROM holds WHERE unit_id = $1", [b.id]);
    await t.query("DELETE FROM inventory_units WHERE id = $1", [b.id]);
    await audit(t, actor, "inventory.unit_removed", "inventory_unit", b.id, u, null);
    return { ok: true };
  });
}

// ---------------- Retreat settings, terms, launch ----------------
async function retreatGet() {
  const retreat = await currentRetreat();
  const rooms = await roomsWithUnits(retreat.id);
  const site = await getSite("published");
  const r = { ...retreat };
  for (const k of ["start_date", "end_date"]) if (r[k]) r[k] = (r[k] instanceof Date ? r[k].toISOString() : String(r[k])).slice(0, 10);
  return { retreat: r, checklist: launchChecklist(retreat, rooms, site) };
}

async function retreatSave(actor, b) {
  requireOwner(actor);
  const tzOk = (z) => { try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch { return false; } };
  const timezone = v.text(b.timezone, { max: 60, required: true, label: "Timezone" });
  if (!tzOk(timezone)) throw new UserError("Timezone must be a valid IANA name, for example America/New_York.");
  const next = {
    name: v.text(b.name, { max: 120, required: true, label: "Retreat name" }),
    timezone,
    start_date: v.dateOrNull(b.start_date, "Start date"),
    end_date: v.dateOrNull(b.end_date, "End date"),
    nights: v.intOrNull(b.nights, { min: 0, max: 60, label: "Nights" }),
    dates_confirmed: b.dates_confirmed === true,
    venue_name: v.text(b.venue_name, { max: 160, label: "Venue" }) || null,
    venue_city: v.text(b.venue_city, { max: 160, label: "City" }) || null,
    venue_confirmed: b.venue_confirmed === true,
    private_address: v.text(b.private_address, { max: 600, label: "Address" }) || null,
    day_pass_enabled: b.day_pass_enabled === true,
    day_pass_price_cents: v.cents(b.day_pass_price_cents, { allowNull: true, label: "Day pass price" }),
  };
  if (next.start_date && next.end_date && next.end_date < next.start_date) throw new UserError("The end date is before the start date.");
  if (next.dates_confirmed && (!next.start_date || next.nights == null)) throw new UserError("Add the start date and number of nights before marking dates confirmed.");
  if (next.venue_confirmed && !next.venue_name) throw new UserError("Add the venue before marking it confirmed.");
  if (next.day_pass_enabled && next.day_pass_price_cents == null) throw new UserError("Add a day pass price before turning the day pass on.");
  return tx(async (t) => {
    const before = (await t.query("SELECT * FROM retreats WHERE is_current FOR UPDATE")).rows[0];
    const cols = Object.keys(next);
    await t.query(`UPDATE retreats SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`, [before.id, ...cols.map((c) => next[c])]);
    await audit(t, actor, "retreat.updated", "retreat", before.id, before, { ...before, ...next });
    return { ok: true };
  });
}

async function termsSave(actor, b) {
  requireOwner(actor);
  const tt = (k) => v.text(b[k], { max: 4000, label: "Terms" });
  const installments = (Array.isArray(b.installments) ? b.installments : []).slice(0, 12).map((i) => ({
    label: v.text(i.label, { max: 80, required: true, label: "Installment name" }),
    amount_cents: v.cents(i.amount_cents, { allowNull: true, label: "Installment amount" }),
    percent: i.percent === "" || i.percent == null ? null : Math.max(0, Math.min(100, Number(i.percent) || 0)),
    due_date: v.dateOrNull(i.due_date, "Installment due date"),
  }));
  const terms = {
    fees_text: tt("fees_text"), taxes_text: tt("taxes_text"),
    deposit_cents: v.cents(b.deposit_cents, { allowNull: true, label: "Deposit" }), deposit_text: tt("deposit_text"),
    installments, installments_text: tt("installments_text"),
    cancellation_text: tt("cancellation_text"), transfer_text: tt("transfer_text"), refund_text: tt("refund_text"),
  };
  const termsConfirmed = b.terms_confirmed === true, legalConfirmed = b.legal_confirmed === true;
  if (termsConfirmed && (!terms.cancellation_text || !terms.refund_text || (terms.deposit_cents == null && !terms.deposit_text)))
    throw new UserError("Add the deposit, cancellation and refund terms before marking terms confirmed.");
  return tx(async (t) => {
    const before = (await t.query("SELECT id, terms, terms_confirmed, legal_confirmed FROM retreats WHERE is_current FOR UPDATE")).rows[0];
    await t.query("UPDATE retreats SET terms = $2, terms_confirmed = $3, legal_confirmed = $4, updated_at = now() WHERE id = $1",
      [before.id, JSON.stringify(terms), termsConfirmed, legalConfirmed]);
    await audit(t, actor, "retreat.payment_terms_changed", "retreat", before.id, before, { terms, terms_confirmed: termsConfirmed, legal_confirmed: legalConfirmed });
    return { ok: true };
  });
}

async function reservationsToggle(actor, b) {
  requireOwner(actor);
  const retreat = await currentRetreat();
  const rooms = await roomsWithUnits(retreat.id);
  const site = await getSite("published");
  const open = b.open === true;
  if (open) {
    const c = launchChecklist(retreat, rooms, site);
    if (!c.ready) throw new UserError("Reservations can’t open until every launch checklist item is complete.", 400, { checklist: c });
  }
  await tx(async (t) => {
    await t.query("UPDATE retreats SET reservations_open = $2, updated_at = now() WHERE id = $1", [retreat.id, open]);
    await audit(t, actor, open ? "reservations.opened" : "reservations.closed", "retreat", retreat.id, { reservations_open: retreat.reservations_open }, { reservations_open: open });
  });
  return { ok: true };
}

async function bookingsList() {
  const retreat = await currentRetreat();
  const rows = await q(`SELECT b.id, b.status, b.total_cents, b.created_at, b.confirmed_at, b.confirmed_by, p.name, p.email_norm AS email, r.name AS room
    FROM bookings b JOIN profiles p ON p.id = b.profile_id LEFT JOIN room_types r ON r.id = b.room_type_id
    WHERE b.retreat_id = $1 ORDER BY b.created_at DESC`, [retreat.id]);
  const review = await q(`SELECT t.* FROM transactions t WHERE t.needs_review ORDER BY t.created_at DESC LIMIT 100`);
  return { rows, review };
}

// ---------------- Content ----------------
const URL_KEY = /(Url|url)$/;
function cleanValue(val, key, depth = 0) {
  if (depth > 8) throw new UserError("Content is nested too deeply.");
  if (val == null) return val;
  if (typeof val === "string") {
    const s = val.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    if (s.length > 20000) throw new UserError("One of the text fields is too long.");
    return URL_KEY.test(key || "") ? v.url(s, "Link") : s;
  }
  if (typeof val === "boolean" || typeof val === "number") return val;
  if (Array.isArray(val)) return val.slice(0, 300).map((x) => cleanValue(x, key, depth + 1));
  if (typeof val === "object") {
    const out = {};
    for (const [k, x] of Object.entries(val).slice(0, 200)) out[String(k).slice(0, 60)] = cleanValue(x, k, depth + 1);
    return out;
  }
  return null;
}

function cleanContent(input, current, actor) {
  const out = {};
  for (const k of Object.keys(SITE)) out[k] = cleanValue(input[k] !== undefined ? input[k] : current[k], k);
  // Owner-only switches.
  const curActs = ((current.experience || {}).activities) || [];
  if (out.experience && Array.isArray(out.experience.activities)) {
    out.experience.activities = out.experience.activities.map((a) => {
      const prev = curActs.find((p) => p.id === a.id) || {};
      if (prev.reviewRequired) a.reviewRequired = true;           // can't be removed
      if (actor.role !== "owner") a.reviewDone = Boolean(prev.reviewDone);
      if (a.reviewRequired && !a.reviewDone) a.published = false; // blocked until the review is done
      return a;
    });
  }
  if (actor.role !== "owner" && out.contact && current.contact) out.contact.verified = Boolean(current.contact.verified);
  if (out.trust && Array.isArray(out.trust.testimonials)) {
    out.trust.testimonials = out.trust.testimonials.map((t) => ({ ...t, published: Boolean(t.published && t.permission) }));
  }
  return out;
}

async function contentGet() {
  const row = await one("SELECT * FROM content WHERE key = 'site'");
  return { draft: row.draft, published: row.published, draft_updated_at: row.draft_updated_at, draft_updated_by: row.draft_updated_by,
    published_at: row.published_at, published_by: row.published_by, dirty: JSON.stringify(row.draft) !== JSON.stringify(row.published) };
}

async function contentSave(actor, b) {
  if (!b.draft || typeof b.draft !== "object") throw new UserError("Nothing to save.");
  return tx(async (t) => {
    const row = (await t.query("SELECT draft FROM content WHERE key = 'site' FOR UPDATE")).rows[0];
    const draft = cleanContent(b.draft, row.draft, actor);
    await t.query("UPDATE content SET draft = $1, draft_updated_at = now(), draft_updated_by = $2 WHERE key = 'site'", [JSON.stringify(draft), `${actor.name}`]);
    return { ok: true };
  });
}

async function contentPublish(actor) {
  return tx(async (t) => {
    const row = (await t.query("SELECT * FROM content WHERE key = 'site' FOR UPDATE")).rows[0];
    const draft = row.draft;
    // Changing consent or privacy wording creates a new version, so each sign-up records what she agreed to.
    const pw = row.published.waitlist || {}, dw = draft.waitlist || {};
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    if (dw.consentText !== pw.consentText && dw.consentVersion === pw.consentVersion) dw.consentVersion = `marketing-${stamp}`;
    if (dw.privacyNotice !== pw.privacyNotice && dw.privacyVersion === pw.privacyVersion) dw.privacyVersion = `privacy-${stamp}`;
    await t.query("UPDATE content SET draft = $1, published = $1, published_at = now(), published_by = $2 WHERE key = 'site'", [JSON.stringify(draft), actor.name]);
    await t.query("INSERT INTO content_versions (key, data, published_by) VALUES ('site', $1, $2)", [JSON.stringify(row.published), actor.name]);
    await audit(t, actor, "content.published", "content", "site", row.published, draft);
    return { ok: true };
  });
}

async function contentDiscard(actor) {
  await tx(async (t) => {
    await t.query("UPDATE content SET draft = published, draft_updated_at = now(), draft_updated_by = $1 WHERE key = 'site'", [actor.name]);
    await audit(t, actor, "content.draft_discarded", "content", "site");
  });
  return { ok: true };
}

// ---------------- Uploads (photos, logo) ----------------
const IMG_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
async function upload(actor, b) {
  const type = String(b.contentType || "");
  if (!IMG_TYPES[type]) throw new UserError("Please upload a JPG, PNG or WebP image.");
  const buf = Buffer.from(String(b.dataBase64 || ""), "base64");
  if (!buf.length) throw new UserError("The file is empty.");
  if (buf.length > 4 * 1024 * 1024) throw new UserError("Images must be under 4 MB. Try exporting a smaller version.");
  const name = `${Date.now()}-${sec.token(6)}.${IMG_TYPES[type]}`;
  let url;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = require("@vercel/blob");
    const r = await put(`public/${name}`, buf, { access: "public", contentType: type, addRandomSuffix: false });
    url = r.url;
  } else if (process.env.DEV_UPLOAD_DIR) {
    fs.mkdirSync(process.env.DEV_UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.DEV_UPLOAD_DIR, name), buf);
    url = `/dev-uploads/${name}`;
  } else {
    throw new UserError("Photo storage isn’t connected yet. In Vercel, open Storage and connect a Blob store to this project.");
  }
  await tx((t) => audit(t, actor, "upload.image", "upload", name, null, { url, bytes: buf.length }));
  return { url };
}

// ---------------- Communications ----------------
async function templatesList() {
  return { rows: await q("SELECT * FROM email_templates ORDER BY category DESC, name") };
}

async function templateSave(actor, b) {
  const subject = v.text(b.subject, { max: 200, required: true, label: "Subject" });
  const body = v.text(b.body, { max: 10000, required: true, label: "Email text" });
  return tx(async (t) => {
    const before = (await t.query("SELECT * FROM email_templates WHERE key = $1 FOR UPDATE", [b.key])).rows[0];
    if (!before) throw new UserError("Template not found.", 404);
    if (before.key === "signin_code" && !/\{\{\s*code\s*\}\}/.test(body)) throw new UserError("The sign-in email must include {{code}}.");
    if (before.key === "staff_invite" && !/\{\{\s*invite_url\s*\}\}/.test(body)) throw new UserError("The staff invitation must include {{invite_url}}.");
    // Campaign emails need fresh owner approval after any edit.
    const resetApproval = before.category === "campaign";
    await t.query(`UPDATE email_templates SET subject = $2, body = $3, updated_at = now(), updated_by = $4,
        approved_at = CASE WHEN $5 THEN NULL ELSE approved_at END, enabled = CASE WHEN $5 THEN false ELSE enabled END WHERE key = $1`,
      [b.key, subject, body, actor.name, resetApproval]);
    await audit(t, actor, "template.updated", "email_template", b.key, { subject: before.subject, body: before.body }, { subject, body });
    return { ok: true };
  });
}

async function templateApprove(actor, b) {
  requireOwner(actor);
  const enabled = b.enabled === true;
  if (!enabled && ["signin_code", "staff_invite"].includes(b.key)) throw new UserError("This email is required for sign-in and can’t be turned off.");
  return tx(async (t) => {
    const before = (await t.query("SELECT key, enabled, approved_at FROM email_templates WHERE key = $1 FOR UPDATE", [b.key])).rows[0];
    if (!before) throw new UserError("Template not found.", 404);
    await t.query(`UPDATE email_templates SET enabled = $2, approved_at = CASE WHEN $2 THEN now() ELSE approved_at END, approved_by = CASE WHEN $2 THEN $3 ELSE approved_by END WHERE key = $1`,
      [b.key, enabled, actor.name]);
    await audit(t, actor, enabled ? "template.approved_enabled" : "template.disabled", "email_template", b.key, before, { enabled });
    return { ok: true };
  });
}

async function templatePreview(actor, b) {
  const tpl = await one("SELECT * FROM email_templates WHERE key = $1", [b.key]);
  if (!tpl) throw new UserError("Template not found.", 404);
  const sample = { name: "Sistar", code: "123456", portal_url: "https://example.com/portal/", invite_url: "https://example.com/admin/#invite=...", inviter: actor.name, role: "staff", room: "Sapphire", total: "$3,199.00", amount: "$500.00", balance: "$2,699.00", due_date: "January 15" };
  const site = await getSite("published");
  const fakeTpl = { ...tpl, subject: b.subject || tpl.subject, body: b.body || tpl.body };
  const fill = (x) => String(x).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => sample[k] ?? "");
  const subject = fill(fakeTpl.subject);
  const text = fill(fakeTpl.body);
  const html = email.renderHtml(fakeTpl.body, sample, site, (site.brand && site.brand.orgName) || "");
  return { subject, text, html };
}

async function emailsList(actor, b) {
  const st = ["queued", "sending", "sent", "failed", "canceled"].includes(b.status) ? b.status : null;
  const rows = await q(`SELECT id, to_email, template_key, subject, status, attempts, last_error, next_attempt_at, created_at, sent_at
    FROM email_jobs ${st ? "WHERE status = $1" : ""} ORDER BY created_at DESC LIMIT 300`, st ? [st] : []);
  return { rows, maxAttempts: email.MAX_ATTEMPTS };
}

async function emailRetry(actor, b) {
  const ids = b.id ? [b.id] : (await q("SELECT id FROM email_jobs WHERE status = 'failed' ORDER BY created_at LIMIT 50")).map((r) => r.id);
  let sent = 0;
  for (const id of ids) {
    await q("UPDATE email_jobs SET attempts = least(attempts, $2 - 1), next_attempt_at = now() WHERE id = $1 AND status = 'failed' AND template_key <> 'signin_code'", [id, email.MAX_ATTEMPTS]);
    if (await email.attempt(id)) sent++;
  }
  await tx((t) => audit(t, actor, "email.retry", "email_job", b.id || "all_failed", null, { tried: ids.length, sent }));
  return { tried: ids.length, sent };
}

async function emailCancel(actor, b) {
  await q("UPDATE email_jobs SET status = 'canceled' WHERE id = $1 AND status IN ('queued','failed')", [b.id]);
  await tx((t) => audit(t, actor, "email.canceled", "email_job", b.id));
  return { ok: true };
}

// ---------------- Staff, integrations, audit ----------------
async function staffList() {
  return { rows: await q("SELECT id, name, email, role, active, totp_enabled, last_login_at, created_at, invite_expires FROM admins ORDER BY created_at") };
}

async function staffUpdate(actor, b) {
  requireOwner(actor);
  const role = v.oneOf(b.role, ["owner", "staff"], "Role");
  const active = b.active !== false;
  return tx(async (t) => {
    const before = (await t.query("SELECT id, name, email, role, active FROM admins WHERE id = $1 FOR UPDATE", [b.id])).rows[0];
    if (!before) throw new UserError("Admin not found.", 404);
    if (before.role === "owner" && (role !== "owner" || !active)) {
      const owners = (await t.query("SELECT count(*)::int AS n FROM admins WHERE role = 'owner' AND active")).rows[0].n;
      if (owners <= 1) throw new UserError("There must always be at least one active owner.");
    }
    await t.query("UPDATE admins SET role = $2, active = $3 WHERE id = $1", [b.id, role, active]);
    if (!active || role !== before.role) await t.query("DELETE FROM sessions WHERE kind = 'admin' AND subject_id = $1", [b.id]);
    await audit(t, actor, "admin.access_changed", "admin", b.id, before, { ...before, role, active });
    return { ok: true };
  });
}

async function staffResetMfa(actor, b) {
  requireOwner(actor);
  await tx(async (t) => {
    const before = (await t.query("SELECT id, name FROM admins WHERE id = $1", [b.id])).rows[0];
    if (!before) throw new UserError("Admin not found.", 404);
    await t.query("UPDATE admins SET totp_enabled = false, totp_secret_enc = NULL WHERE id = $1", [b.id]);
    await t.query("DELETE FROM sessions WHERE kind = 'admin' AND subject_id = $1", [b.id]);
    await audit(t, actor, "admin.mfa_reset", "admin", b.id);
  });
  return { ok: true };
}

function integrations() {
  const env = process.env;
  const stripe = env.STRIPE_SECRET_KEY || "";
  return {
    environment: env.VERCEL_ENV || "local",
    items: [
      { name: "Database (Vercel Postgres)", ok: Boolean(env.DATABASE_URL || env.POSTGRES_URL), detail: "Connected" },
      { name: "App secret", ok: Boolean(env.APP_SECRET && env.APP_SECRET.length >= 32), detail: env.APP_SECRET ? "Set" : "Missing APP_SECRET" },
      { name: "Email (Resend)", ok: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM), detail: !env.RESEND_API_KEY ? "Missing RESEND_API_KEY" : !env.EMAIL_FROM ? "Missing EMAIL_FROM" : `Sending as ${env.EMAIL_FROM}` },
      { name: "Photo storage (Vercel Blob)", ok: Boolean(env.BLOB_READ_WRITE_TOKEN || env.DEV_UPLOAD_DIR), detail: env.BLOB_READ_WRITE_TOKEN ? "Connected" : env.DEV_UPLOAD_DIR ? "Local test storage" : "Connect a Blob store in Vercel" },
      { name: "Scheduled email retries", ok: Boolean(env.CRON_SECRET), detail: env.CRON_SECRET ? "Set" : "Missing CRON_SECRET" },
      { name: "Site address", ok: Boolean(env.SITE_URL), detail: env.SITE_URL || "SITE_URL not set (using the request address)" },
      { name: "Stripe (Phase 2)", ok: false, detail: !stripe ? "Not connected yet" : stripe.startsWith("sk_live_") ? "Live key present. Checkout is not built yet." : "Test key present. Checkout is not built yet." },
    ],
  };
}

async function auditList(actor, b) {
  const p = [], where = [];
  if (b.entity) { p.push(String(b.entity)); where.push(`entity = $${p.length}`); }
  if (b.before) { p.push(Number(b.before)); where.push(`id < $${p.length}`); }
  const rows = await q(`SELECT * FROM audit_events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT 100`, p);
  return { rows };
}

// Action table: [handler, ownerOnly]. Owner checks also live inside handlers for mixed cases.
const ACTIONS = {
  overview: [overview],
  "waitlist-list": [waitlistList], "waitlist-csv": [waitlistCsv], "waitlist-update": [waitlistUpdate],
  "clients-list": [clientsList], "client-invite": [clientInvite], "client-email-change": [clientEmailChange, true],
  "rooms-list": [roomsList], "room-save": [roomSave], "room-delete": [roomDelete, true],
  "unit-save": [unitSave, true], "unit-delete": [unitDelete, true],
  "retreat-get": [retreatGet], "retreat-save": [retreatSave, true], "terms-save": [termsSave, true],
  "reservations-toggle": [reservationsToggle, true], "bookings-list": [bookingsList],
  "content-get": [contentGet], "content-save": [contentSave], "content-publish": [contentPublish], "content-discard": [contentDiscard],
  upload: [upload],
  "templates-list": [templatesList], "template-save": [templateSave], "template-approve": [templateApprove, true], "template-preview": [templatePreview],
  "emails-list": [emailsList], "email-retry": [emailRetry], "email-cancel": [emailCancel],
  "staff-list": [staffList], "staff-invite": [(a, b, req) => invite(req, a, b), true], "staff-update": [staffUpdate, true], "staff-reset-mfa": [staffResetMfa, true],
  integrations: [integrations], "audit-list": [auditList],
};

module.exports = { ACTIONS, cleanContent, publicAdmin };
