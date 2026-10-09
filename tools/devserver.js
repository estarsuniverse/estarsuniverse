// Local stand-in for Vercel, for testing only. Uses an in-process Postgres (PGlite) and fake email.
//   node tools/devserver.js            then open http://localhost:3000
// Fake emails: http://localhost:3000/dev/outbox   Toggle email failures: /dev/email-fail?on=1
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
process.chdir(ROOT);

const env = process.env;
env.DATABASE_URL ||= "pglite:memory";
env.APP_SECRET ||= "local-dev-secret-local-dev-secret-0123456789";
env.SETUP_TOKEN ||= "local-setup-token-123";
env.RESEND_API_KEY ||= "re_test_fake";
env.EMAIL_FROM ||= "Empowered Wombman <hello@example.com>";
env.CRON_SECRET ||= "local-cron";
env.DEV_UPLOAD_DIR ||= path.join(ROOT, ".dev-uploads");
const PORT = Number(env.PORT || 3000);

const outbox = [];
let failEmail = false;
const realFetch = global.fetch;
global.fetch = async (u, init = {}) => {
  if (String(u).startsWith("https://api.resend.com")) {
    if (failEmail) return new Response(JSON.stringify({ message: "Simulated outage" }), { status: 503 });
    const body = JSON.parse(init.body);
    outbox.push({ at: new Date().toISOString(), to: body.to, subject: body.subject, text: body.text, html: body.html });
    return new Response(JSON.stringify({ id: `dev_${outbox.length}` }), { status: 200 });
  }
  return realFetch(u, init);
};

const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon" };
const fns = {};

http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  let p = u.pathname;
  if (p === "/dev/outbox") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(outbox, null, 2)); }
  if (p === "/dev/email-fail") { failEmail = u.searchParams.get("on") === "1"; return res.end(`email failures: ${failEmail}`); }
  if (p === "/dev/cron") { req.headers.authorization = `Bearer ${env.CRON_SECRET}`; p = "/api/cron"; }
  for (const r of vercel.rewrites) if (p === r.source) p = r.destination;
  if (p.startsWith("/api/")) {
    const name = p.slice(5).replace(/\.js$/, "");
    const file = path.join(ROOT, "api", name + ".js");
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end("no api"); }
    fns[name] ||= require(file);
    return fns[name](req, res);
  }
  if (p.startsWith("/dev-uploads/")) {
    const f = path.join(env.DEV_UPLOAD_DIR, path.basename(p));
    if (fs.existsSync(f)) { res.setHeader("Content-Type", types[path.extname(f)] || "application/octet-stream"); return res.end(fs.readFileSync(f)); }
  }
  let f = path.join(ROOT, "public", decodeURIComponent(p));
  if (!f.startsWith(path.join(ROOT, "public"))) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end("Not found"); }
  res.setHeader("Content-Type", types[path.extname(f)] || "application/octet-stream");
  res.end(fs.readFileSync(f));
}).listen(PORT, () => console.log(`Dev server on http://localhost:${PORT}  (setup token: ${env.SETUP_TOKEN})`));
