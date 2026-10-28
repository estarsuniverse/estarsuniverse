// Public endpoints: /api/site?fn=<name>
const { handler, UserError } = require("../lib/http");
const pub = require("../lib/public");
const health = require("../lib/health");

const GET = { health, content: pub.content, unsubscribe: pub.unsubscribe };

module.exports = handler(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const query = Object.fromEntries(url.searchParams);
  const fn = query.fn;
  if (req.method === "GET" && GET[fn]) return GET[fn](req, res, query);
  throw new UserError("Not found.", 404);
});
