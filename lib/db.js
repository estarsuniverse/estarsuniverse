// Postgres access. Production: Vercel Postgres (Neon) via DATABASE_URL.
// Local testing: DATABASE_URL=pglite:memory (or pglite:./.localdb) runs an in-process Postgres.
const fs = require("fs");
const path = require("path");

let backend = null;   // { query(sql, params), tx(fn) }
let ready = null;     // promise: migrations + seed done

function connectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
}

function makeBackend() {
  const cs = connectionString();
  if (!cs) throw new Error("DATABASE_URL is not set. Connect a Postgres database in Vercel (Storage tab).");
  if (cs.startsWith("pglite:")) {
    const { PGlite } = require("@electric-sql/pglite");
    const where = cs.slice(7);
    const db = where && where !== "memory" ? new PGlite(where) : new PGlite();
    return {
      query: (sql, params = []) => db.query(sql, params),
      tx: (fn) => db.transaction((t) => fn({ query: (s, p = []) => t.query(s, p) })),
      exec: (sql) => db.exec(sql),
    };
  }
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: cs, max: 3, ssl: /localhost|127\.0\.0\.1/.test(cs) ? false : { rejectUnauthorized: true } });
  return {
    query: (sql, params = []) => pool.query(sql, params),
    tx: async (fn) => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const out = await fn({ query: (s, p = []) => c.query(s, p) });
        await c.query("COMMIT");
        return out;
      } catch (e) {
        try { await c.query("ROLLBACK"); } catch {}
        throw e;
      } finally { c.release(); }
    },
    exec: (sql) => pool.query(sql),
  };
}

async function migrate(b) {
  await b.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const { rows } = await b.query("SELECT 1 FROM schema_migrations WHERE version = $1", [f]);
    if (rows.length) continue;
    // Serialize concurrent cold starts on real Postgres.
    if (!connectionString().startsWith("pglite:")) await b.query("SELECT pg_advisory_lock(424242)");
    try {
      const again = await b.query("SELECT 1 FROM schema_migrations WHERE version = $1", [f]);
      if (!again.rows.length) {
        await b.exec(fs.readFileSync(path.join(dir, f), "utf8"));
        await b.query("INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING", [f]);
      }
    } finally {
      if (!connectionString().startsWith("pglite:")) await b.query("SELECT pg_advisory_unlock(424242)");
    }
  }
  await require("./seed").seedIfEmpty(b);
}

async function init() {
  if (!backend) backend = makeBackend();
  if (!ready) ready = migrate(backend).catch((e) => { ready = null; throw e; });
  await ready;
  return backend;
}

async function q(sql, params) { const b = await init(); return (await b.query(sql, params)).rows; }
async function one(sql, params) { return (await q(sql, params))[0] || null; }
async function tx(fn) { const b = await init(); return b.tx(fn); }

module.exports = { q, one, tx, init };
