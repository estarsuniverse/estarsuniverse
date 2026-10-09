// Change history. Records who changed what and when. Never stores secrets.
const SECRET_KEYS = /pass|secret|token|hash|code/i;

function scrub(obj) {
  if (obj == null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(scrub);
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = SECRET_KEYS.test(k) ? "[hidden]" : scrub(v);
  return out;
}

// Only keep fields that actually changed, to keep the log readable.
function diff(before, after) {
  if (!before || !after) return { before: scrub(before), after: scrub(after) };
  const b = {}, a = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k === "updated_at") continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) { b[k] = before[k]; a[k] = after[k]; }
  }
  return { before: scrub(b), after: scrub(a) };
}

async function audit(t, actor, action, entity, entityId, before, after) {
  const d = diff(before, after);
  await t.query(
    `INSERT INTO audit_events (actor_id, actor_label, action, entity, entity_id, before, after) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [actor ? actor.id : null, actor ? `${actor.name} (${actor.role})` : "system", action, entity || null, entityId || null,
     d.before == null ? null : JSON.stringify(d.before), d.after == null ? null : JSON.stringify(d.after)]
  );
}

module.exports = { audit, scrub };
