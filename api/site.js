// Public and guest endpoints: /api/site?fn=<name>
const { handler, send, checkOrigin, UserError } = require("../lib/http");
const pub = require("../lib/public");
const guest = require("../lib/guest");
const health = require("../lib/health");

const GET = { health, content: pub.content, me: guest.me, unsubscribe: pub.unsubscribe };
const POST = {
  waitlist: pub.waitlist,
  "auth-start": guest.authStart,
  "auth-verify": guest.authVerify,
  logout: guest.logout,
  "portal-update": guest.portalUpdate,
  "portal-join": guest.portalJoin,
};

module.exports = handler(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const query = Object.fromEntries(url.searchParams);
  const fn = query.fn;
  if (req.method === "GET" && GET[fn]) return GET[fn](req, res, query);
  if (req.method === "POST" && POST[fn]) { checkOrigin(req); return POST[fn](req, res, query); }
  throw new UserError("Not found.", 404);
});
