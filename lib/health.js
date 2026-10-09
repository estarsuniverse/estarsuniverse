// GET /api/site?fn=health : a setup checklist. Shows only whether each setting is present, never its value.
const { send } = require("./http");

module.exports = async function health(req, res) {
  const env = process.env;
  const checks = [];
  const add = (name, ok, fix) => checks.push({ name, ok: Boolean(ok), fix: ok ? "" : fix });
  add("Database connected (DATABASE_URL)", env.DATABASE_URL || env.POSTGRES_URL, "In Vercel: Storage > create or connect a Neon Postgres database to this project, then redeploy.");
  add("APP_SECRET (32+ characters)", env.APP_SECRET && env.APP_SECRET.length >= 32, "Add APP_SECRET in Settings > Environment Variables (a long random string), then redeploy.");
  add("ADMIN_PASSWORD (the shared admin code, 8+ characters)", env.ADMIN_PASSWORD && env.ADMIN_PASSWORD.length >= 8, "Add ADMIN_PASSWORD in Settings > Environment Variables. Admins type it after their own password.");
  add("SETUP_TOKEN (needed once to create the owner account)", env.SETUP_TOKEN && env.SETUP_TOKEN.length >= 16, "Add SETUP_TOKEN (16+ characters) to create the first owner account. You can remove it afterwards.");
  add("Email: RESEND_API_KEY", env.RESEND_API_KEY, "Add your Resend API key. Until then, sign-up still saves but emails wait in the queue.");
  add("Email: EMAIL_FROM", env.EMAIL_FROM, "Add EMAIL_FROM, for example: Empowered Wombman <hello@yourdomain.com> (domain verified in Resend).");
  add("Photo uploads (BLOB_READ_WRITE_TOKEN)", env.BLOB_READ_WRITE_TOKEN, "In Vercel: Storage > create or connect a Blob store. Needed only for uploading new photos in the admin.");
  add("CRON_SECRET", env.CRON_SECRET, "Add CRON_SECRET (any long random string) so scheduled email retries run.");
  let database = { ok: false, detail: "" };
  if (env.DATABASE_URL || env.POSTGRES_URL) {
    try {
      const { one } = require("./db");
      const r = await one("SELECT count(*)::int AS rooms FROM room_types");
      database = { ok: true, detail: `Connected. Tables ready (${r.rooms} rooms).` };
    } catch (e) {
      database = { ok: false, detail: e.constructor && e.constructor.name === "ConfigError" ? e.message : `Could not use the database (${e.code || "error"}).` };
    }
  }
  const ok = checks.filter((c) => c.name.startsWith("Database") || c.name.startsWith("APP_SECRET") || c.name.startsWith("ADMIN_PASSWORD")).every((c) => c.ok) && database.ok;
  send(res, ok ? 200 : 503, { ok, environment: env.VERCEL_ENV || "local", database, checks });
};
