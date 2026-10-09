// Fixed-window rate limiting stored in Postgres, so it works across serverless instances.
const { q } = require("./db");
const { UserError } = require("./http");
const { sha256 } = require("./security");

// Returns true if allowed. key should not contain raw personal data; we hash it.
async function hit(key, limit, windowSec) {
  const k = sha256(key);
  const rows = await q(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN now() ELSE rate_limits.window_start END
     RETURNING count`,
    [k, windowSec]
  );
  return rows[0].count <= limit;
}

async function enforce(key, limit, windowSec, message = "Too many attempts. Please wait a few minutes and try again.") {
  if (!(await hit(key, limit, windowSec))) throw new UserError(message, 429);
}

module.exports = { hit, enforce };
