// Server-side sessions. The cookie holds a random token; the database stores only its hash.
const { q, one } = require("./db");
const { token, sha256 } = require("./security");
const { parseCookies, cookie, addCookie } = require("./http");

const CFG = {
  guest: { cookie: "eg_guest", ttlSec: 14 * 24 * 3600, idleSec: 14 * 24 * 3600 },
  admin: { cookie: "eg_admin", ttlSec: 12 * 3600, idleSec: 2 * 3600 },
};

async function create(req, res, kind, subjectId, mfaOk = false) {
  const c = CFG[kind];
  const t = token(32);
  await q(
    `INSERT INTO sessions (id_hash, kind, subject_id, mfa_ok, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(secs => $5))`,
    [sha256(t), kind, subjectId, mfaOk, c.ttlSec]
  );
  addCookie(res, cookie(req, c.cookie, t, c.ttlSec));
  return t;
}

async function get(req, kind) {
  const c = CFG[kind];
  const t = parseCookies(req)[c.cookie];
  if (!t) return null;
  const s = await one(
    `UPDATE sessions SET last_seen_at = now()
     WHERE id_hash = $1 AND kind = $2 AND expires_at > now() AND last_seen_at > now() - make_interval(secs => $3)
     RETURNING *`,
    [sha256(t), kind, c.idleSec]
  );
  return s;
}

async function markMfa(req) {
  const t = parseCookies(req)[CFG.admin.cookie];
  if (t) await q("UPDATE sessions SET mfa_ok = true WHERE id_hash = $1", [sha256(t)]);
}

async function destroy(req, res, kind) {
  const c = CFG[kind];
  const t = parseCookies(req)[c.cookie];
  if (t) await q("DELETE FROM sessions WHERE id_hash = $1", [sha256(t)]);
  addCookie(res, cookie(req, c.cookie, "", 0));
}

async function destroyAllFor(kind, subjectId) {
  await q("DELETE FROM sessions WHERE kind = $1 AND subject_id = $2", [kind, subjectId]);
}

module.exports = { create, get, destroy, destroyAllFor, markMfa };
