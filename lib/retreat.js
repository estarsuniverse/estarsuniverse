// Retreat, rooms, public projections, and the launch checklist that gates paid reservations.
const { q, one } = require("./db");

const BASIS_LABEL = {
  unconfirmed: "Price basis to be confirmed",
  per_guest: "per guest",
  per_room: "per room",
  per_sleeping_unit: "per sleeping space",
};

async function currentRetreat() {
  const r = await one("SELECT * FROM retreats WHERE is_current ORDER BY created_at LIMIT 1");
  if (!r) throw new Error("No current retreat.");
  return r;
}

async function roomsWithUnits(retreatId) {
  const rooms = await q("SELECT * FROM room_types WHERE retreat_id = $1 ORDER BY sort, name", [retreatId]);
  const units = await q("SELECT * FROM inventory_units WHERE retreat_id = $1 ORDER BY created_at, label", [retreatId]);
  const holds = await q(
    `SELECT h.unit_id FROM holds h JOIN inventory_units u ON u.id = h.unit_id
     WHERE u.retreat_id = $1 AND h.released_at IS NULL AND h.expires_at > now()`, [retreatId]);
  const held = new Set(holds.map((h) => h.unit_id));
  for (const r of rooms) {
    r.units = units.filter((u) => u.room_type_id === r.id).map((u) => ({ ...u, held: held.has(u.id) }));
    r.available_units = r.units.filter((u) => u.status === "available" && !u.held).length;
  }
  return rooms;
}

function fmtDate(d, tz) {
  if (!d) return "";
  const s = typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const [y, m, day] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day, 12)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// Only confirmed facts reach the public page.
function publicRetreat(r) {
  return {
    name: r.name,
    timezone: r.timezone,
    dates: r.dates_confirmed && r.start_date
      ? { start: fmtDate(r.start_date), end: r.end_date ? fmtDate(r.end_date) : "", nights: r.nights }
      : null,
    venue: r.venue_confirmed && r.venue_name ? { name: r.venue_name, city: r.venue_city || "" } : null,
    reservationsOpen: Boolean(r.reservations_open),
    immersions: publicImmersions(r),
    depositPercent: r.terms && Number.isInteger(r.terms.deposit_percent) ? r.terms.deposit_percent : null,
    payLinks: r.reservations_open ? resolvedPayLinks(r) : {},   // where Secure your spot goes, only while reservations are open
    terms: r.terms_confirmed ? publicTerms(r.terms) : null,
  };
}

// Day immersions on sale: none while they are turned off in Settings.
function publicImmersions(r) {
  if (!r.day_pass_enabled) return [];
  return (Array.isArray(r.immersions) ? r.immersions : []).filter((i) => i && i.id && i.name && i.price_cents != null)
    .map((i) => ({ id: i.id, name: i.name, days: i.days ?? null, price_cents: i.price_cents, early_bird_price_cents: i.early_bird_price_cents ?? null }));
}

// Payment links set by the owner (where Secure your spot goes): { "<room or immersion id>": { deposit, full } }, with "*" as the default for every option.
// Rooms can be paid by deposit or in full; immersions are paid in full.
function resolvedPayLinks(r, rooms) {
  const all = r.payment_links && typeof r.payment_links === "object" ? r.payment_links : {};
  const def = all["*"] || {};
  const out = {};
  const ids = (rooms || []).map((x) => x.id).concat(publicImmersions(r).map((i) => i.id));
  for (const id of new Set(ids.concat(Object.keys(all).filter((k) => k !== "*")))) {
    const own = all[id] || {};
    const isImm = publicImmersions(r).some((i) => i.id === id);
    const deposit = isImm ? "" : own.deposit || def.deposit || "";
    const full = own.full || def.full || "";
    if (deposit || full) out[id] = { deposit, full };
  }
  if (!rooms && (def.deposit || def.full)) out["*"] = { deposit: def.deposit || "", full: def.full || "" };
  return out;
}

// A waiting-list choice is a visible room, a day immersion on sale, "any" or "undecided". Anything else becomes "undecided".
async function cleanPref(raw, retreat) {
  if (!raw || raw === "any" || raw === "undecided") return raw;
  if (publicImmersions(retreat).some((i) => i.id === raw)) return raw;
  const r = await one("SELECT id FROM room_types WHERE id = $1 AND retreat_id = $2 AND visible", [raw, retreat.id]);
  return r ? raw : "undecided";
}

function prefName(id, rooms, retreat) {
  if (id === "any") return "Any room";
  if (!id || id === "undecided") return "Not sure yet";
  const room = rooms.find((r) => r.id === id);
  if (room) return room.name;
  const imm = (Array.isArray(retreat.immersions) ? retreat.immersions : []).find((i) => i.id === id);
  return imm ? imm.name : id;
}

function publicTerms(t = {}) {
  const keep = ["fees_text", "taxes_text", "deposit_text", "installments_text", "cancellation_text", "transfer_text", "refund_text"];
  const out = {};
  for (const k of keep) if (t[k]) out[k] = t[k];
  return out;
}

function publicRoom(r, retreat) {
  const soldOut = r.inventory_confirmed && r.units.length > 0 && r.available_units === 0;
  return {
    id: r.id,
    name: r.name,
    price_cents: r.price_cents,
    price_basis: r.price_basis,
    price_basis_label: BASIS_LABEL[r.price_basis],
    includes_admission: r.includes_admission,
    occupancy_label: r.occupancy_label || "",
    guest_capacity: r.guest_capacity,
    beds: r.beds || "",
    bathroom: r.bathroom || "",
    features: r.features || "",
    accessibility: r.accessibility || "",
    difference_note: r.difference_note || "",
    description: r.description || "",
    photos: Array.isArray(r.photos) ? r.photos : [],
    availability: soldOut ? "sold_out" : retreat.reservations_open ? "open" : "waitlist",
  };
}

// Everything that must be true before paid reservations can open.
function launchChecklist(retreat, rooms, site) {
  const items = [];
  const add = (key, label, ok, detail) => items.push({ key, label, ok: Boolean(ok), detail: detail || "" });
  add("dates", "Retreat dates, year and number of nights confirmed", retreat.dates_confirmed && retreat.start_date && retreat.nights != null);
  add("venue", "Venue confirmed", retreat.venue_confirmed && retreat.venue_name);
  add("terms", "Payment terms confirmed (fees, taxes, deposit, installments, cancellation, transfer, refunds)", retreat.terms_confirmed);
  add("legal", "Agreement and policy text supplied by the attorney and approved", retreat.legal_confirmed);
  add("contact", "Verified support contact", site && site.contact && site.contact.verified && (site.contact.email || site.contact.phone));
  const visible = rooms.filter((r) => r.visible);
  for (const r of visible) {
    const missing = [];
    if (r.price_basis === "unconfirmed") missing.push("price basis");
    if (r.includes_admission === "unconfirmed") missing.push("whether admission is included");
    if (!r.guest_capacity) missing.push("guest capacity");
    if (!r.beds) missing.push("bed layout");
    if (!r.inventory_confirmed) missing.push("inventory");
    if (!r.photos || !r.photos.length) missing.push("a real photo");
    add(`room:${r.id}`, `${r.name} ready to sell`, missing.length === 0, missing.length ? `Needs ${missing.join(", ")}` : "");
  }
  // Rooms that look identical but are priced differently must explain the difference (Emerald vs Obsidian).
  for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
    const a = visible[i], b = visible[j];
    const same = (a.occupancy_label || "") === (b.occupancy_label || "") && (a.features || "") === (b.features || "") && (a.features || "") !== "";
    if (same && a.price_cents !== b.price_cents) {
      add(`diff:${a.id}:${b.id}`, `Difference between ${a.name} and ${b.name} explained`, a.difference_note && b.difference_note,
        "They are listed with the same features but different prices.");
    }
  }
  const links = resolvedPayLinks(retreat, visible);
  const noLink = visible.concat(publicImmersions(retreat)).filter((o) => !links[o.id]).map((o) => o.name);
  add("payment_links", "Payment link added for every room and day immersion", noLink.length === 0, noLink.length ? `Missing for ${noLink.join(", ")}` : "");
  return { items, ready: items.every((i) => i.ok) };
}

module.exports = { currentRetreat, roomsWithUnits, publicRetreat, publicRoom, publicImmersions, resolvedPayLinks, cleanPref, prefName, launchChecklist, BASIS_LABEL, fmtDate };
