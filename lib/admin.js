// Protected admin actions. Every action re-checks the session, MFA and role on the server.
const fs = require("fs");
const path = require("path");
const { q, one, tx } = require("./db");
const { UserError } = require("./http");
const sec = require("./security");
const v = require("./validate");
const { audit } = require("./audit");
const { requireOwner, invite, publicAdmin } = require("./adminauth");
const { currentRetreat, roomsWithUnits, launchChecklist, soldCounts, earlyBirdPrice, BASIS_LABEL } = require("./retreat");
const { getSite } = require("./content");
const { SITE } = require("./defaults");

// ---------------- Overview ----------------
async function overview() {
  const retreat = await currentRetreat();
  const rooms = await roomsWithUnits(retreat.id);
  const site = await getSite("published");
  const { options, totals } = await ticketSummary(retreat, rooms);
  return {
    retreat: { name: retreat.name, reservations_open: retreat.reservations_open },
    options, totals,
    checklist: launchChecklist(retreat, rooms, site),
  };
}

// ---------------- Tickets: rooms and day immersions ----------------
// A room has one ticket per guest (its guest capacity). Sold counts come from recorded sales.
async function roomsList() {
  const retreat = await currentRetreat();
  const rooms = await roomsWithUnits(retreat.id);
  const sold = await soldCounts(retreat.id);
  for (const r of rooms) r.sold = sold[r.id] || 0;
  const immersions = (Array.isArray(retreat.immersions) ? retreat.immersions : []).map((i) => ({ ...i, sold: sold[i.id] || 0 }));
  return { rooms, basisLabels: BASIS_LABEL, immersions, immersions_enabled: Boolean(retreat.day_pass_enabled) };
}

const OWNER_ROOM_FIELDS = ["price_cents", "price_basis", "includes_admission", "guest_capacity"];

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
    features: v.text(b.features, { max: 300, label: "Features" }) || null,
    accessibility: v.text(b.accessibility, { max: 600, label: "Accessibility" }) || null,
    difference_note: v.text(b.difference_note, { max: 600, label: "What makes this room different" }) || null,
    description: v.text(b.description, { max: 2000, label: "Description" }) || null,
    photos: cleanPhotos(b.photos),
    visible: b.visible !== false,
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
    await audit(t, actor, "room.created", "room_type", id, null, next);
    return { ok: true, id };
  });
}

async function roomDelete(actor, b) {
  requireOwner(actor);
  return tx(async (t) => {
    const r = (await t.query("SELECT * FROM room_types WHERE id = $1", [b.id])).rows[0];
    if (!r) throw new UserError("Room not found.", 404);
    const used = (await t.query("SELECT 1 FROM ticket_sales WHERE option_id = $1 LIMIT 1", [b.id])).rows.length
      || (await t.query("SELECT 1 FROM bookings WHERE room_type_id = $1 LIMIT 1", [b.id])).rows.length;
    if (used) throw new UserError("This room has sales recorded, so it can’t be deleted. Hide it instead.");
    await t.query("DELETE FROM holds WHERE unit_id IN (SELECT id FROM inventory_units WHERE room_type_id = $1)", [b.id]);
    await t.query("DELETE FROM room_types WHERE id = $1", [b.id]);
    await audit(t, actor, "room.deleted", "room_type", b.id, r, null);
    return { ok: true };
  });
}

// Day immersions (owner only, like prices): name, days, price, optional early-bird price and ticket limit.
async function immersionsSave(actor, b) {
  requireOwner(actor);
  const list = (Array.isArray(b.immersions) ? b.immersions : []).slice(0, 6).map((i, n) => {
    const out = {
      id: /^[a-z0-9_]{1,40}$/.test(String(i.id || "")) ? String(i.id) : `imm_${Date.now().toString(36)}_${n}`,
      name: v.text(i.name, { max: 80, required: true, label: "Immersion name" }),
      days: v.intOrNull(i.days, { min: 1, max: 14, label: "Immersion days" }),
      price_cents: v.cents(i.price_cents, { label: "Immersion price" }),
      early_bird_price_cents: v.cents(i.early_bird_price_cents, { allowNull: true, label: "Early-bird price" }),
      early_bird_ends: v.dateOrNull(i.early_bird_ends, "Early bird ends"),
      ticket_limit: v.intOrNull(i.ticket_limit, { min: 0, max: 10000, label: "Ticket limit" }),
    };
    if (out.early_bird_price_cents != null && out.early_bird_price_cents >= out.price_cents) throw new UserError(`The early-bird price for ${out.name} must be lower than its standard price.`);
    return out;
  });
  const enabled = b.enabled === true;
  if (enabled && !list.length) throw new UserError("Add at least one day immersion before offering them.");
  if (new Set(list.map((i) => i.id)).size !== list.length) throw new UserError("Each immersion needs its own ID.");
  return tx(async (t) => {
    const before = (await t.query("SELECT id, day_pass_enabled, immersions FROM retreats WHERE is_current FOR UPDATE")).rows[0];
    await t.query("UPDATE retreats SET day_pass_enabled = $2, immersions = $3, updated_at = now() WHERE id = $1", [before.id, enabled, JSON.stringify(list)]);
    await audit(t, actor, "retreat.immersions_changed", "retreat", before.id, before, { day_pass_enabled: enabled, immersions: list });
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
  };
  if (next.start_date && next.end_date && next.end_date < next.start_date) throw new UserError("The end date is before the start date.");
  if (next.dates_confirmed && (!next.start_date || next.nights == null)) throw new UserError("Add the start date and number of nights before marking dates confirmed.");
  if (next.venue_confirmed && !next.venue_name) throw new UserError("Add the venue before marking it confirmed.");
  return tx(async (t) => {
    const before = (await t.query("SELECT * FROM retreats WHERE is_current FOR UPDATE")).rows[0];
    const cols = Object.keys(next);
    await t.query(`UPDATE retreats SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
      [before.id, ...cols.map((c) => next[c])]);
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
    deposit_percent: b.deposit_percent === "" || b.deposit_percent == null ? null : v.intOrNull(b.deposit_percent, { min: 1, max: 100, label: "Deposit percent" }),
    installments, installments_text: tt("installments_text"),
    cancellation_text: tt("cancellation_text"), transfer_text: tt("transfer_text"), refund_text: tt("refund_text"),
  };
  const termsConfirmed = b.terms_confirmed === true, legalConfirmed = b.legal_confirmed === true;
  if (termsConfirmed && (!terms.cancellation_text || !terms.refund_text || (terms.deposit_cents == null && terms.deposit_percent == null && !terms.deposit_text)))
    throw new UserError("Add the deposit, cancellation and refund terms before marking terms confirmed.");
  return tx(async (t) => {
    const before = (await t.query("SELECT id, terms, terms_confirmed, legal_confirmed FROM retreats WHERE is_current FOR UPDATE")).rows[0];
    await t.query("UPDATE retreats SET terms = $2, terms_confirmed = $3, legal_confirmed = $4, updated_at = now() WHERE id = $1",
      [before.id, JSON.stringify(terms), termsConfirmed, legalConfirmed]);
    await audit(t, actor, "retreat.payment_terms_changed", "retreat", before.id, before, { terms, terms_confirmed: termsConfirmed, legal_confirmed: legalConfirmed });
    return { ok: true };
  });
}

// Payment links (owner only, like prices): { "*" | room id | immersion id: { deposit, full } }. Each must be an https link.
async function paymentLinksSave(actor, b) {
  requireOwner(actor);
  const retreat = await currentRetreat();
  const rooms = await q("SELECT id FROM room_types WHERE retreat_id = $1", [retreat.id]);
  const known = new Set(["*", ...rooms.map((r) => r.id), ...(Array.isArray(retreat.immersions) ? retreat.immersions : []).map((i) => i.id)]);
  const link = (x) => {
    const u = v.url(x, "Payment link");
    if (u && !u.startsWith("https://")) throw new UserError("Payment links must start with https://");
    return u;
  };
  const links = {};
  for (const [id, l] of Object.entries(b.links && typeof b.links === "object" ? b.links : {})) {
    if (!known.has(id) || !l || typeof l !== "object") continue;
    const out = { deposit: link(l.deposit), full: link(l.full) };
    if (out.deposit || out.full) links[id] = out;
  }
  await tx(async (t) => {
    await t.query("UPDATE retreats SET payment_links = $2, updated_at = now() WHERE id = $1", [retreat.id, JSON.stringify(links)]);
    await audit(t, actor, "retreat.payment_links_changed", "retreat", retreat.id, { payment_links: retreat.payment_links }, { payment_links: links });
  });
  return { ok: true };
}

async function reservationsToggle(actor, b) {
  requireOwner(actor);
  const retreat = await currentRetreat();
  const rooms = await roomsWithUnits(retreat.id);
  const site = await getSite("published");
  const open = b.open === true;
  if (open) {
    const c = launchChecklist(retreat, rooms, site);
    if (!c.ready) throw new UserError("Payments can’t be turned on until every checklist item is complete.", 400, { checklist: c });
  }
  await tx(async (t) => {
    await t.query("UPDATE retreats SET reservations_open = $2, updated_at = now() WHERE id = $1", [retreat.id, open]);
    await audit(t, actor, open ? "reservations.opened" : "reservations.closed", "retreat", retreat.id, { reservations_open: retreat.reservations_open }, { reservations_open: open });
  });
  return { ok: true };
}

// ---------------- Payments: sales and the payments toward them ----------------
const csvCell = (x) => {
  let s = x == null ? "" : typeof x === "object" ? JSON.stringify(x) : String(x);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // stops spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Every room and day immersion with its tickets, sold count and money, plus totals.
async function ticketSummary(retreat, rooms) {
  const sold = await soldCounts(retreat.id);
  const money = await q(`SELECT s.option_id,
      coalesce(sum(s.total_cents) FILTER (WHERE s.status = 'active'), 0)::int AS booked,
      coalesce((SELECT sum(CASE WHEN p.kind = 'refund' THEN -p.amount_cents ELSE p.amount_cents END) FROM ticket_payments p
        JOIN ticket_sales x ON x.id = p.sale_id WHERE x.retreat_id = $1 AND x.option_id = s.option_id), 0)::int AS collected
    FROM ticket_sales s WHERE s.retreat_id = $1 GROUP BY s.option_id`, [retreat.id]);
  const m = Object.fromEntries(money.map((r) => [r.option_id, r]));
  const opt = (id, name, kind, price, tickets, visible) => {
    const n = sold[id] || 0, mm = m[id] || {};
    return { id, name, kind, price_cents: price, tickets, sold: n, left: tickets == null ? null : Math.max(0, tickets - n), visible,
      booked_cents: mm.booked || 0, collected_cents: mm.collected || 0 };
  };
  const options = rooms.map((r) => opt(r.id, r.name, "room", r.price_cents, r.guest_capacity ?? null, r.visible))
    .concat((Array.isArray(retreat.immersions) ? retreat.immersions : []).map((i) => ({
      ...opt(i.id, i.name, "immersion", earlyBirdPrice(i, retreat.timezone) ?? i.price_cents, i.ticket_limit ?? null, Boolean(retreat.day_pass_enabled)),
      standard_price_cents: i.price_cents, early_bird: earlyBirdPrice(i, retreat.timezone) != null })));
  const sum = (k) => options.reduce((a, o) => a + (o[k] || 0), 0);
  const tot = await one(`SELECT
      coalesce(sum(CASE WHEN p.kind = 'refund' THEN -p.amount_cents ELSE p.amount_cents END), 0)::int AS collected
    FROM ticket_payments p JOIN ticket_sales s ON s.id = p.sale_id WHERE s.retreat_id = $1`, [retreat.id]);
  const active = await one(`SELECT coalesce(sum(s.total_cents - coalesce((SELECT sum(CASE WHEN p.kind = 'refund' THEN -p.amount_cents ELSE p.amount_cents END)
      FROM ticket_payments p WHERE p.sale_id = s.id), 0)), 0)::int AS outstanding
    FROM ticket_sales s WHERE s.retreat_id = $1 AND s.status = 'active'`, [retreat.id]);
  const forSale = options.filter((o) => o.visible);
  return {
    options,
    totals: {
      sold: sum("sold"),
      tickets: forSale.every((o) => o.tickets != null) ? forSale.reduce((a, o) => a + o.tickets, 0) : null,
      residential_sold: options.filter((o) => o.kind === "room").reduce((a, o) => a + o.sold, 0),
      residential_tickets: options.filter((o) => o.kind === "room" && o.visible).reduce((a, o) => a + (o.tickets || 0), 0),
      collected_cents: tot.collected, outstanding_cents: active.outstanding,
    },
  };
}

async function salesList() {
  const retreat = await currentRetreat();
  const rooms = await roomsWithUnits(retreat.id);
  const sales = await q(`SELECT s.*,
      coalesce((SELECT sum(CASE WHEN p.kind = 'refund' THEN -p.amount_cents ELSE p.amount_cents END) FROM ticket_payments p WHERE p.sale_id = s.id), 0)::int AS paid_cents,
      coalesce((SELECT json_agg(json_build_object('id', p.id, 'kind', p.kind, 'amount_cents', p.amount_cents, 'paid_on', p.paid_on, 'note', p.note) ORDER BY p.paid_on, p.created_at)
        FROM ticket_payments p WHERE p.sale_id = s.id), '[]') AS payments
    FROM ticket_sales s WHERE s.retreat_id = $1 ORDER BY s.created_at DESC`, [retreat.id]);
  for (const x of sales) x.balance_cents = x.status === "active" ? x.total_cents - x.paid_cents : 0;
  const { options, totals } = await ticketSummary(retreat, rooms);
  const t = retreat.terms || {};
  return { sales, options, totals, deposit_percent: Number.isInteger(t.deposit_percent) ? t.deposit_percent : null };
}

const money = (x, label) => v.cents(x, { label });

// Records a sale (one ticket for one guest) and, optionally, its first payment. Refuses to oversell.
async function saleSave(actor, b) {
  const retreat = await currentRetreat();
  const fields = {
    guest_name: v.text(b.guest_name, { max: 120, required: true, label: "Guest name" }),
    guest_email: b.guest_email ? v.normEmail(b.guest_email) : null,
    guest_phone: v.text(b.guest_phone, { max: 40, label: "Phone" }) || null,
    plan: v.oneOf(b.plan, ["deposit", "full"], "Payment plan"),
    notes: v.text(b.notes, { max: 1000, label: "Notes" }) || null,
  };
  return tx(async (t) => {
    if (b.id) {
      const before = (await t.query("SELECT * FROM ticket_sales WHERE id = $1 AND retreat_id = $2 FOR UPDATE", [b.id, retreat.id])).rows[0];
      if (!before) throw new UserError("Sale not found.", 404);
      const total = b.total_cents == null ? before.total_cents : money(b.total_cents, "Ticket price");
      await t.query(`UPDATE ticket_sales SET guest_name = $2, guest_email = $3, guest_phone = $4, plan = $5, notes = $6, total_cents = $7, updated_at = now() WHERE id = $1`,
        [b.id, fields.guest_name, fields.guest_email, fields.guest_phone, fields.plan, fields.notes, total]);
      await audit(t, actor, "sale.updated", "ticket_sale", b.id, before, { ...before, ...fields, total_cents: total });
      return { ok: true, id: b.id };
    }
    // The option and its price as sold; lock the retreat row so two sales can't take the last ticket together.
    const r = (await t.query("SELECT * FROM retreats WHERE id = $1 FOR UPDATE", [retreat.id])).rows[0];
    const room = (await t.query("SELECT id, name, price_cents, guest_capacity FROM room_types WHERE id = $1 AND retreat_id = $2", [b.option_id, r.id])).rows[0];
    const imm = room ? null : (Array.isArray(r.immersions) ? r.immersions : []).find((i) => i.id === b.option_id);
    if (!room && !imm) throw new UserError("Choose a room or day immersion.", 400, { field: "option_id" });
    if (imm && fields.plan === "deposit") throw new UserError("Day immersions are paid in full.");
    const limit = room ? room.guest_capacity : imm.ticket_limit;
    const n = (await t.query("SELECT count(*)::int AS n FROM ticket_sales WHERE option_id = $1 AND retreat_id = $2 AND status = 'active'", [b.option_id, r.id])).rows[0].n;
    if (limit != null && n >= limit) throw new UserError(`${room ? room.name : imm.name} has no tickets left.`);
    const total = b.total_cents == null || b.total_cents === "" ? (room ? room.price_cents : earlyBirdPrice(imm, r.timezone) ?? imm.price_cents) : money(b.total_cents, "Ticket price");
    const id = sec.id("sale");
    await t.query(`INSERT INTO ticket_sales (id, retreat_id, option_id, option_name, guest_name, guest_email, guest_phone, plan, total_cents, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, r.id, b.option_id, room ? room.name : imm.name, fields.guest_name, fields.guest_email, fields.guest_phone, fields.plan, total, fields.notes, actor.name]);
    const first = b.first_payment_cents == null || b.first_payment_cents === "" ? null : money(b.first_payment_cents, "Amount paid");
    if (first) {
      if (first > total) throw new UserError("The amount paid is more than the ticket price.");
      await t.query("INSERT INTO ticket_payments (id, sale_id, amount_cents, paid_on, note, created_by) VALUES ($1,$2,$3,coalesce($4::date, current_date),$5,$6)",
        [sec.id("pay"), id, first, v.dateOrNull(b.paid_on, "Payment date"), fields.plan === "deposit" ? "Deposit" : "Paid in full", actor.name]);
    }
    await audit(t, actor, "sale.recorded", "ticket_sale", id, null, { option_id: b.option_id, guest_name: fields.guest_name, plan: fields.plan, total_cents: total, first_payment_cents: first });
    return { ok: true, id };
  });
}

// Canceling frees the ticket; payments already recorded stay (add a refund if money was returned).
async function saleCancel(actor, b) {
  return tx(async (t) => {
    const before = (await t.query("SELECT * FROM ticket_sales WHERE id = $1 FOR UPDATE", [b.id])).rows[0];
    if (!before) throw new UserError("Sale not found.", 404);
    const status = b.restore === true ? "active" : "canceled";
    if (status === "active") {
      const limit = (await t.query("SELECT guest_capacity FROM room_types WHERE id = $1", [before.option_id])).rows[0];
      const cap = limit ? limit.guest_capacity : ((await currentRetreat()).immersions || []).find((i) => i.id === before.option_id)?.ticket_limit;
      const n = (await t.query("SELECT count(*)::int AS n FROM ticket_sales WHERE option_id = $1 AND status = 'active'", [before.option_id])).rows[0].n;
      if (cap != null && n >= cap) throw new UserError(`${before.option_name} has no tickets left, so this sale can’t be restored.`);
    }
    await t.query("UPDATE ticket_sales SET status = $2, updated_at = now() WHERE id = $1", [b.id, status]);
    await audit(t, actor, status === "active" ? "sale.restored" : "sale.canceled", "ticket_sale", b.id, { status: before.status }, { status });
    return { ok: true };
  });
}

async function paymentAdd(actor, b) {
  const kind = v.oneOf(b.kind || "payment", ["payment", "refund"], "Type");
  const amount = money(b.amount_cents, "Amount");
  if (!amount) throw new UserError("Enter an amount.", 400, { field: "amount" });
  return tx(async (t) => {
    const sale = (await t.query("SELECT * FROM ticket_sales WHERE id = $1 FOR UPDATE", [b.sale_id])).rows[0];
    if (!sale) throw new UserError("Sale not found.", 404);
    const paid = (await t.query("SELECT coalesce(sum(CASE WHEN kind = 'refund' THEN -amount_cents ELSE amount_cents END), 0)::int AS n FROM ticket_payments WHERE sale_id = $1", [sale.id])).rows[0].n;
    if (kind === "payment" && paid + amount > sale.total_cents) throw new UserError(`That's more than the remaining balance of $${((sale.total_cents - paid) / 100).toFixed(2)}.`);
    if (kind === "refund" && amount > paid) throw new UserError("A refund can't be more than what has been paid.");
    const id = sec.id("pay");
    await t.query("INSERT INTO ticket_payments (id, sale_id, kind, amount_cents, paid_on, note, created_by) VALUES ($1,$2,$3,$4,coalesce($5::date, current_date),$6,$7)",
      [id, sale.id, kind, amount, v.dateOrNull(b.paid_on, "Payment date"), v.text(b.note, { max: 200, label: "Note" }) || null, actor.name]);
    await audit(t, actor, kind === "refund" ? "payment.refund_recorded" : "payment.recorded", "ticket_sale", sale.id, null, { kind, amount_cents: amount });
    return { ok: true };
  });
}

async function paymentDelete(actor, b) {
  return tx(async (t) => {
    const p = (await t.query("SELECT * FROM ticket_payments WHERE id = $1 FOR UPDATE", [b.id])).rows[0];
    if (!p) throw new UserError("Payment not found.", 404);
    await t.query("DELETE FROM ticket_payments WHERE id = $1", [b.id]);
    await audit(t, actor, "payment.removed", "ticket_sale", p.sale_id, p, null);
    return { ok: true };
  });
}

async function salesCsv(actor) {
  const { sales } = await salesList();
  const cols = ["recorded_on", "guest_name", "guest_email", "guest_phone", "ticket", "plan", "price", "paid", "balance", "status", "notes"];
  const d = (c) => (c / 100).toFixed(2);
  const lines = [cols.join(",")].concat(sales.map((x) => [new Date(x.created_at).toISOString().slice(0, 10), x.guest_name, x.guest_email, x.guest_phone, x.option_name,
    x.plan === "deposit" ? "Deposit" : "Paid in full", d(x.total_cents), d(x.paid_cents), d(x.balance_cents), x.status, x.notes].map(csvCell).join(",")));
  await tx((t) => audit(t, actor, "sales.export_csv", "ticket_sale", null, null, { rows: sales.length }));
  return { filename: `ticket-sales-${new Date().toISOString().slice(0, 10)}.csv`, csv: lines.join("\r\n") };
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
      { name: "Admin sign-in", ok: /^(1|true|yes|on)$/i.test(String(env.ADMIN_REQUIRE_SIGNIN || "").trim()), detail: /^(1|true|yes|on)$/i.test(String(env.ADMIN_REQUIRE_SIGNIN || "").trim()) ? "Required" : "Off: anyone with the /admin/ link can use the admin area. Set ADMIN_REQUIRE_SIGNIN to true in Vercel to require it." },
      { name: "Owner sign-in (ADMIN_EMAIL and ADMIN_PASSWORD)", ok: Boolean(env.ADMIN_EMAIL) && (env.ADMIN_PASSWORD || "").length >= 8, detail: !env.ADMIN_EMAIL ? "Missing ADMIN_EMAIL" : (env.ADMIN_PASSWORD || "").length < 8 ? "ADMIN_PASSWORD missing or shorter than 8 characters" : `Set for ${env.ADMIN_EMAIL}` },
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
  "rooms-list": [roomsList], "room-save": [roomSave], "room-delete": [roomDelete, true], "immersions-save": [immersionsSave, true],
  "sales-list": [salesList], "sale-save": [saleSave], "sale-cancel": [saleCancel], "payment-add": [paymentAdd], "payment-delete": [paymentDelete], "sales-csv": [salesCsv],
  "retreat-get": [retreatGet], "retreat-save": [retreatSave, true], "terms-save": [termsSave, true],
  "reservations-toggle": [reservationsToggle, true], "payment-links-save": [paymentLinksSave, true],
  "content-get": [contentGet], "content-save": [contentSave], "content-publish": [contentPublish], "content-discard": [contentDiscard],
  upload: [upload],
  "staff-list": [staffList], "staff-invite": [(a, b, req) => invite(req, a, b), true], "staff-update": [staffUpdate, true], "staff-reset-mfa": [staffResetMfa, true],
  integrations: [integrations], "audit-list": [auditList],
};

module.exports = { ACTIONS, cleanContent, publicAdmin };
