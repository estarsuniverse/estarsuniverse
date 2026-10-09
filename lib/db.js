// Postgres access. Production: Vercel Postgres (Neon) via DATABASE_URL.
// Local testing: DATABASE_URL=pglite:memory (or pglite:./.localdb) runs an in-process Postgres.
const fs = require("fs");
const { ConfigError } = require("./http");
const path = require("path");

let backend = null;   // { query(sql, params), tx(fn) }
let ready = null;     // promise: migrations + seed done

function connectionString() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
}

function makeBackend() {
  const cs = connectionString();
  if (!cs) throw new ConfigError("No database is connected. In Vercel, open Storage, create or connect a Neon Postgres database to this project, then redeploy.");
  if (cs.startsWith("pglite:")) {
    const { PGlite } = require("@electric-sql/pglite");
    const where = cs.slice(7);
    const db = where && where !== "memory" ? new PGlite(where) : new PGlite();
    return {
      query: (sql, params = []) => db.query(sql, params),
      tx: (fn) => db.transaction((t) => fn({ query: (s, p = []) => t.query(s, p), exec: (s) => t.exec(s) })),
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
        const out = await fn({ query: (s, p = []) => c.query(s, p), exec: (s) => c.query(s) });
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
  const isLite = connectionString().startsWith("pglite:");
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  await b.tx(async (t) => {
    // Transaction-scoped lock: safe with Neon's pooled (PgBouncer) connection, released automatically on commit.
    if (!isLite) await t.query("SELECT pg_advisory_xact_lock(424242)");
    await t.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const f of files) {
      const { rows } = await t.query("SELECT 1 FROM schema_migrations WHERE version = $1", [f]);
      if (rows.length) continue;
      await t.exec(fs.readFileSync(path.join(dir, f), "utf8"));
      await t.query("INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING", [f]);
    }
  });
  await require("./seed").seedIfEmpty(b);
}

// Turns low-level connection failures into a plain setup message (never includes the connection string).
function explain(e) {
  if (e instanceof ConfigError) return e;
  const code = e && (e.code || "");
  const msg = String((e && e.message) || "");
  const known = {
    "28P01": "The database rejected the password. Reconnect the Neon database in Vercel so DATABASE_URL is refreshed, then redeploy.",
    "3D000": "The database named in DATABASE_URL does not exist.",
    ENOTFOUND: "The database address in DATABASE_URL could not be found. Check the value in Vercel, then redeploy.",
    ECONNREFUSED: "The database refused the connection.",
    ETIMEDOUT: "The database did not respond in time.",
    ERR_INVALID_URL: "DATABASE_URL is not a valid Postgres connection string.",
  };
  if (known[code]) return new ConfigError(known[code]);
  if (/self[- ]signed|certificate/i.test(msg)) return new ConfigError("The database connection failed its security (SSL) check.");
  if (/Invalid URL|invalid connection/i.test(msg)) return new ConfigError(known.ERR_INVALID_URL);
  return e;
}

async function init() {
  if (!backend) backend = makeBackend();
  if (!ready) ready = migrate(backend).catch((e) => { ready = null; backend = null; throw explain(e); });
  await ready;
  return backend;
}

async function q(sql, params) { const b = await init(); return (await b.query(sql, params)).rows; }
async function one(sql, params) { return (await q(sql, params))[0] || null; }
async function tx(fn) { const b = await init(); return b.tx(fn); }

module.exports = { q, one, tx, init, explain };
