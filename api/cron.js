// Scheduled job: sends queued emails, retries failures, and clears expired sign-in data.
const { handler, send, UserError } = require("../lib/http");
const { q } = require("../lib/db");
const { processQueue } = require("../lib/email");
const { safeEqual } = require("../lib/security");

module.exports = handler(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const auth = String(req.headers.authorization || "");
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) throw new UserError("Unauthorized.", 401);
  const mail = await processQueue(50);
  await q("DELETE FROM otp_codes WHERE created_at < now() - interval '2 days'");
  await q("DELETE FROM sessions WHERE expires_at < now()");
  await q("DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'");
  await q("UPDATE holds SET released_at = now() WHERE released_at IS NULL AND expires_at < now()");
  send(res, 200, { ok: true, mail });
});
