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
    dayPass: r.day_pass_enabled && r.day_pass_price_cents != null ? { price_cents: r.day_pass_price_cents } : null,
    terms: r.terms_confirmed ? publicTerms(r.terms) : null,
  };
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
    privacy: r.privacy || "",
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
  add("checkout", "Online checkout built, tested and connected (Phase 2)", false, "Paid reservations arrive in Phase 2.");
  return { items, ready: items.every((i) => i.ok) };
}

module.exports = { currentRetreat, roomsWithUnits, publicRetreat, publicRoom, launchChecklist, BASIS_LABEL, fmtDate };
