// Seeds a fresh database once. Never overwrites existing records.
const { RETREAT, ROOMS, SITE, TEMPLATES } = require("./defaults");

async function seedIfEmpty(b) {
  const { rows } = await b.query("SELECT count(*)::int AS n FROM retreats");
  if (rows[0].n > 0) return;
  await b.tx(async (t) => {
    await t.query(
      `INSERT INTO retreats (id, slug, name, timezone, terms, is_current) VALUES ($1,$2,$3,$4,$5,true)`,
      [RETREAT.id, RETREAT.slug, RETREAT.name, RETREAT.timezone, JSON.stringify(RETREAT.terms)]
    );
    let sort = 0;
    for (const r of ROOMS) {
      sort += 10;
      await t.query(
        `INSERT INTO room_types (id, retreat_id, name, sort, price_cents, occupancy_label, features)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [r.id, RETREAT.id, r.name, sort, r.price_cents, r.occupancy_label, r.features || null]
      );
      await t.query(
        `INSERT INTO inventory_units (id, retreat_id, room_type_id, label) VALUES ($1,$2,$3,$4)`,
        [r.id.replace("room_", "unit_") + "_1", RETREAT.id, r.id, r.name]
      );
    }
    await t.query(
      `INSERT INTO content (key, draft, published, published_by, draft_updated_by) VALUES ('site', $1, $1, 'seed', 'seed')`,
      [JSON.stringify(SITE)]
    );
    for (const tp of TEMPLATES) {
      await t.query(
        `INSERT INTO email_templates (key, name, category, subject, body, enabled, updated_by) VALUES ($1,$2,$3,$4,$5,$6,'seed')`,
        [tp.key, tp.name, tp.category, tp.subject, tp.body, tp.enabled]
      );
    }
    await t.query(`INSERT INTO audit_events (actor_label, action, entity) VALUES ('system', 'seed', 'database')`);
  });
}

module.exports = { seedIfEmpty };
