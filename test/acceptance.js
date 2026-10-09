// End-to-end checks against a fresh local server (in-memory Postgres, fake email).
//   node test/acceptance.js
const { spawn } = require("child_process");
const path = require("path");
const assert = require("assert/strict");

const PORT = 3217;
const BASE = `http://localhost:${PORT}`;
process.env.APP_SECRET = "local-dev-secret-local-dev-secret-0123456789";
const sec = require("../lib/security");

let passed = 0;
const results = [];
async function check(name, fn) {
  try { await fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (e) { results.push(`  FAIL  ${name}\n        ${e.message}`); process.exitCode = 1; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor(ip) { this.jar = {}; this.ip = ip || `10.0.0.${Math.floor(Math.random() * 200) + 2}`; }
  cookie() { return Object.entries(this.jar).map(([k, v]) => `${k}=${v}`).join("; "); }
  async req(method, url, body, extraHeaders = {}) {
    const headers = { Origin: BASE, "X-Forwarded-For": this.ip, Cookie: this.cookie(), ...extraHeaders };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const r = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) {
      const [kv] = c.split(";"); const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (/Max-Age=0/.test(c)) delete this.jar[k]; else this.jar[k] = v;
    }
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  }
  get(url) { return this.req("GET", url); }
  post(url, body) { return this.req("POST", url, body || {}); }
  admin(action, body = {}) { return this.post("/api/admin", { action, ...body }); }
}
const outbox = async () => (await fetch(`${BASE}/dev/outbox`)).json();
const codeFor = async (email) => {
  const mails = (await outbox()).filter((m) => m.to.includes(email) && /sign-in code/i.test(m.subject));
  return mails.length ? mails[mails.length - 1].subject.match(/(\d{6})/)[1] : null;
};

async function joinWaitlist(c, fields, waitMs = 2100) {
  const content = await c.get("/api/site?fn=content");
  await sleep(waitMs);
  return c.post("/api/site?fn=waitlist", { ft: content.data.formToken, ...fields });
}

async function signInGuest(c, email) {
  const s = await c.post("/api/site?fn=auth-start", { email });
  assert.equal(s.status, 200, JSON.stringify(s.data));
  const code = await codeFor(email);
  assert.ok(code, "no sign-in code in outbox");
  const v = await c.post("/api/site?fn=auth-verify", { email, code });
  assert.equal(v.status, 200, JSON.stringify(v.data));
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "tools", "devserver.js")], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: "pglite:memory", DEV_UPLOAD_DIR: "/tmp/eg-test-uploads" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60 && !log.includes("Dev server"); i++) await sleep(100);

  const visitor = new Client();
  const owner = new Client("10.1.0.1");
  const staff = new Client("10.1.0.2");

  // ---------- Public page and prices ----------
  let content;
  await check("Public content loads; all 7 room prices match the brief exactly", async () => {
    content = await visitor.get("/api/site?fn=content");
    assert.equal(content.status, 200);
    const want = { "Sapphire": 319900, "Tiger’s Eye": 299900, "Emerald": 279900, "Obsidian": 289900, "Moonstone": 269900, "Downstairs queen sofa bed 1": 111100, "Downstairs queen sofa bed 2": 111100 };
    const got = Object.fromEntries(content.data.rooms.map((r) => [r.name, r.price_cents]));
    assert.deepEqual(got, want);
  });
  await check("Price basis starts unconfirmed and no capacity is inferred from occupancy labels", async () => {
    for (const r of content.data.rooms) { assert.equal(r.price_basis, "unconfirmed"); assert.equal(r.guest_capacity, null); assert.equal(r.availability, "waitlist"); }
  });
  await check("Unconfirmed dates/venue are hidden; reservations closed", async () => {
    assert.equal(content.data.retreat.dates, null); assert.equal(content.data.retreat.venue, null); assert.equal(content.data.retreat.reservationsOpen, false);
  });
  await check("Unapproved activities (including yoni steaming) and portal-only content are not public", async () => {
    assert.equal(content.data.site.experience.activities.length, 0);
    assert.equal(content.data.site.portal, undefined);
    assert.ok(!JSON.stringify(content.data).toLowerCase().includes("yoni"));
  });
  await check("Draft preview is refused without an admin session", async () => {
    const r = await visitor.get("/api/site?fn=content&preview=1");
    assert.equal(r.status, 401);
  });

  // ---------- Waiting list ----------
  await check("Waiting list: missing name and bad email give useful field errors", async () => {
    let r = await joinWaitlist(visitor, { name: "", email: "a@b.co" }, 2100);
    assert.equal(r.status, 400); assert.equal(r.data.field, "name");
    r = await joinWaitlist(visitor, { name: "Ama", email: "not-an-email" }, 2100);
    assert.equal(r.status, 400); assert.equal(r.data.field, "email"); assert.match(r.data.error, /email/i);
  });
  await check("Waiting list: valid join saves, shows calm success, and sends one confirmation", async () => {
    const r = await joinWaitlist(visitor, { name: "Ama Mensah", email: "Ama@Example.com ", room_pref: "room_sapphire", intention: "Rest.", marketing: true, tags: { utm_source: "ig" } });
    assert.equal(r.status, 200); assert.match(r.data.message, /waiting list, sistar/);
    assert.match(r.data.message, /does not reserve a room or require payment/);
    const mails = (await outbox()).filter((m) => m.to.includes("ama@example.com"));
    assert.equal(mails.length, 1); assert.match(mails[0].subject, /waiting list/i);
  });
  await check("Waiting list: duplicate (different case) gets the same message and no second email or row", async () => {
    const r = await joinWaitlist(new Client(), { name: "Someone Else", email: "AMA@example.com" });
    assert.equal(r.status, 200); assert.match(r.data.message, /waiting list, sistar/);
    assert.equal((await outbox()).filter((m) => m.to.includes("ama@example.com")).length, 1);
  });
  await check("Waiting list: honeypot and too-fast submissions are quietly dropped", async () => {
    const c = new Client();
    const r1 = await joinWaitlist(c, { name: "Bot", email: "bot1@example.com", website: "http://spam" });
    const r2 = await joinWaitlist(c, { name: "Bot", email: "bot2@example.com" }, 0);
    assert.equal(r1.status, 200); assert.equal(r2.status, 200);
    assert.equal((await outbox()).filter((m) => /bot\d@/.test(m.to[0])).length, 0);
  });
  await check("Waiting list: simultaneous duplicate submissions create one entry", async () => {
    const c = new Client(); const tok = (await c.get("/api/site?fn=content")).data.formToken; await sleep(2100);
    const rs = await Promise.all([1, 2, 3].map(() => c.post("/api/site?fn=waitlist", { ft: tok, name: "Twin", email: "twin@example.com" })));
    rs.forEach((r) => assert.equal(r.status, 200));
    assert.equal((await outbox()).filter((m) => m.to.includes("twin@example.com")).length, 1);
  });
  await check("Waiting list: rate limit stops floods from one connection", async () => {
    const c = new Client("10.9.9.9"); const tok = (await c.get("/api/site?fn=content")).data.formToken; await sleep(2100);
    let last;
    for (let i = 0; i < 12; i++) last = await c.post("/api/site?fn=waitlist", { ft: tok, name: "Flood", email: `flood${i}@example.com` });
    assert.equal(last.status, 429);
  });
  await check("Waiting list: if email delivery fails, the sign-up still succeeds and the email is queued for retry", async () => {
    await fetch(`${BASE}/dev/email-fail?on=1`);
    const r = await joinWaitlist(new Client(), { name: "Nia", email: "nia@example.com" });
    await fetch(`${BASE}/dev/email-fail?on=0`);
    assert.equal(r.status, 200);
    assert.equal((await outbox()).filter((m) => m.to.includes("nia@example.com")).length, 0);
  });

  // ---------- Guest sign-in and portal ----------
  const ama = new Client("10.2.0.1");
  await check("Portal is closed without sign-in", async () => {
    const r = await ama.get("/api/site?fn=me"); assert.equal(r.status, 401);
  });
  await check("Guest sign-in: wrong code is refused with tries left; right code signs in", async () => {
    await ama.post("/api/site?fn=auth-start", { email: "ama@example.com" });
    const code = await codeFor("ama@example.com");
    const wrong = String((Number(code) + 1) % 1e6).padStart(6, "0");
    const bad = await ama.post("/api/site?fn=auth-verify", { email: "ama@example.com", code: wrong });
    assert.equal(bad.status, 400); assert.match(bad.data.error, /tries left/);
    const ok = await ama.post("/api/site?fn=auth-verify", { email: "ama@example.com", code });
    assert.equal(ok.status, 200);
  });
  await check("Guest sign-in: a used code cannot be reused", async () => {
    const code = await codeFor("ama@example.com");
    const r = await new Client().post("/api/site?fn=auth-verify", { email: "ama@example.com", code });
    assert.equal(r.status, 400);
  });
  await check("Guest sign-in: resend is limited", async () => {
    const c = new Client();
    await c.post("/api/site?fn=auth-start", { email: "resend@example.com" });
    const r = await c.post("/api/site?fn=auth-start", { email: "resend@example.com" });
    assert.equal(r.status, 429);
  });
  await check("Verified guest sees her correct waiting-list account (not a reservation)", async () => {
    const r = await ama.get("/api/site?fn=me");
    assert.equal(r.status, 200);
    assert.equal(r.data.profile.email, "ama@example.com"); assert.equal(r.data.profile.name, "Ama Mensah");
    assert.equal(r.data.leadStatus, "waiting"); assert.equal(r.data.waitlist.room_pref, "room_sapphire");
    assert.equal(r.data.booking, null); assert.equal(r.data.portal.prepareUnlocked, false);
    assert.equal(r.data.retreat.privateAddress, undefined);
  });
  const bea = new Client("10.2.0.2");
  await check("A second guest cannot see or change the first guest's records", async () => {
    await signInGuest(bea, "bea@example.com");
    const r = await bea.get("/api/site?fn=me&profile=ama&email=ama@example.com");
    assert.equal(r.data.profile.email, "bea@example.com"); assert.equal(r.data.waitlist, null);
    assert.ok(!JSON.stringify(r.data).includes("ama@example.com"));
    const u = await bea.post("/api/site?fn=portal-update", { room_pref: "room_emerald", email: "ama@example.com", id: "anything" });
    assert.equal(u.status, 400);
    const again = await ama.get("/api/site?fn=me");
    assert.equal(again.data.waitlist.room_pref, "room_sapphire");
  });
  await check("Guest can update her own preference and sign out", async () => {
    const u = await ama.post("/api/site?fn=portal-update", { room_pref: "room_emerald", intention: "Slow down." });
    assert.equal(u.status, 200);
    assert.equal((await ama.get("/api/site?fn=me")).data.waitlist.room_pref, "room_emerald");
    await ama.post("/api/site?fn=logout");
    assert.equal((await ama.get("/api/site?fn=me")).status, 401);
  });
  await check("Cross-site POST without our headers is blocked", async () => {
    const r = await fetch(`${BASE}/api/site?fn=auth-start`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ email: "x@y.co" }) });
    assert.equal(r.status, 403);
  });

  // ---------- Admin access ----------
  await check("Unauthenticated visitor cannot use any admin action", async () => {
    for (const a of ["overview", "waitlist-list", "waitlist-csv", "rooms-list", "room-save", "content-publish", "staff-list", "audit-list"]) {
      const r = await visitor.admin(a); assert.equal(r.status, 401, a);
    }
  });
  await check("First-owner setup requires the setup token", async () => {
    const r = await owner.admin("setup", { setupToken: "wrong-token-xxxxxx", name: "Estar", email: "estar@example.com", password: "a-long-password-123" });
    assert.equal(r.status, 403);
    const ok = await owner.admin("setup", { setupToken: "local-setup-token-123", name: "Estar", email: "estar@example.com", password: "a-long-password-123" });
    assert.equal(ok.status, 200);
  });
  await check("Admin data stays locked until two-step sign-in is set up", async () => {
    const r = await owner.admin("overview"); assert.equal(r.status, 401); assert.equal(r.data.needMfa, true);
    const b = await owner.admin("mfa-begin"); assert.ok(b.data.secret);
    const bad = await owner.admin("mfa-enable", { code: "000000" }); assert.equal(bad.status, 400);
    const ok = await owner.admin("mfa-enable", { code: sec.totpNow(b.data.secret) }); assert.equal(ok.status, 200);
    owner.totp = b.data.secret;
    const o = await owner.admin("overview"); assert.equal(o.status, 200);
    assert.ok(o.data.waitlist.total >= 3);
  });
  await check("Setup cannot run twice", async () => {
    const r = await new Client().admin("setup", { setupToken: "local-setup-token-123", name: "X", email: "x@example.com", password: "another-long-pass-1" });
    assert.equal(r.status, 409);
  });
  await check("Admin sign-in needs password and an authenticator code", async () => {
    const c = new Client("10.1.0.9");
    assert.equal((await c.admin("login", { email: "estar@example.com", password: "wrong-password-1" })).status, 400);
    assert.equal((await c.admin("login", { email: "estar@example.com", password: "a-long-password-123" })).status, 200);
    assert.equal((await c.admin("overview")).status, 401);
    assert.equal((await c.admin("mfa-verify", { code: sec.totpNow(owner.totp) })).status, 200);
    assert.equal((await c.admin("overview")).status, 200);
  });
  await check("Owner invites staff; staff accepts and sets up two-step sign-in", async () => {
    const r = await owner.admin("staff-invite", { name: "Jadon", email: "jadon@example.com", role: "staff" });
    assert.equal(r.status, 200);
    const tok = r.data.inviteUrl.split("invite=")[1];
    assert.equal((await staff.admin("invite-accept", { token: tok, password: "staff-password-123" })).status, 200);
    const b = await staff.admin("mfa-begin");
    assert.equal((await staff.admin("mfa-enable", { code: sec.totpNow(b.data.secret) })).status, 200);
    assert.equal((await staff.admin("overview")).status, 200);
    assert.equal((await new Client().admin("invite-accept", { token: tok, password: "reuse-attempt-123" })).status, 400);
  });
  await check("Staff permissions are enforced on the server", async () => {
    const rooms = (await staff.admin("rooms-list")).data.rooms;
    const em = rooms.find((r) => r.name === "Emerald");
    const base = { ...em, photos: em.photos };
    let r = await staff.admin("room-save", { ...base, price_cents: 100 }); assert.equal(r.status, 403);
    r = await staff.admin("room-save", { ...base, price_basis: "per_room" }); assert.equal(r.status, 403);
    r = await staff.admin("room-save", { ...base, beds: "One queen bed" }); assert.equal(r.status, 200);
    for (const [a, body] of [["retreat-save", { name: "X", timezone: "America/New_York" }], ["terms-save", {}], ["staff-invite", { name: "Y", email: "y@example.com" }], ["template-approve", { key: "preparation", enabled: true }], ["reservations-toggle", { open: true }], ["client-email-change", { from: "a@b.co", to: "c@d.co" }], ["unit-save", { label: "x" }]]) {
      assert.equal((await staff.admin(a, body)).status, 403, a);
    }
  });
  await check("Owner price change is recorded in the change history", async () => {
    const rooms = (await owner.admin("rooms-list")).data.rooms;
    const ob = rooms.find((r) => r.name === "Obsidian");
    assert.equal((await owner.admin("room-save", { ...ob, price_cents: 289950 })).status, 200);
    const log = (await owner.admin("audit-list")).data.rows;
    const ev = log.find((a) => a.action === "room.price_changed" && a.entity_id === ob.id);
    assert.ok(ev, "no audit event"); assert.equal(ev.before.price_cents, 289900); assert.equal(ev.after.price_cents, 289950);
    assert.match(ev.actor_label, /Estar/);
    await owner.admin("room-save", { ...ob, price_cents: 289900 });
  });
  await check("Paid launch stays blocked while basis, dates, inventory or terms are unconfirmed", async () => {
    const r = await owner.admin("reservations-toggle", { open: true });
    assert.equal(r.status, 400);
    const c = r.data.checklist.items;
    assert.ok(c.find((i) => i.key === "dates" && !i.ok)); assert.ok(c.find((i) => i.key === "terms" && !i.ok));
    assert.ok(c.find((i) => i.key.startsWith("diff:") && /Emerald/.test(i.label) && /Obsidian/.test(i.label)), "Emerald vs Obsidian difference check missing");
  });

  // ---------- Content ----------
  await check("Admin edits content, previews the draft, then publishes", async () => {
    const d = (await owner.admin("content-get")).data.draft;
    d.hero.title = "Return to yourself. (test edit)";
    assert.equal((await owner.admin("content-save", { draft: d })).status, 200);
    assert.notEqual((await visitor.get("/api/site?fn=content")).data.site.hero.title, d.hero.title);
    assert.equal((await owner.get("/api/site?fn=content&preview=1")).data.site.hero.title, d.hero.title);
    assert.equal((await owner.admin("content-publish")).status, 200);
    assert.equal((await visitor.get("/api/site?fn=content")).data.site.hero.title, d.hero.title);
  });
  await check("Yoni steaming cannot be published until the owner records the safety review", async () => {
    const d = (await staff.admin("content-get")).data.draft;
    const y = d.experience.activities.find((a) => /yoni/i.test(a.title));
    y.published = true; y.reviewDone = true; delete y.reviewRequired;
    await staff.admin("content-save", { draft: d });
    const after = (await staff.admin("content-get")).data.draft.experience.activities.find((a) => /yoni/i.test(a.title));
    assert.equal(after.reviewRequired, true); assert.equal(after.reviewDone, false); assert.equal(after.published, false);
  });
  await check("Testimonials need permission to publish; staff cannot mark contact verified", async () => {
    const d = (await staff.admin("content-get")).data.draft;
    d.trust.testimonials = [{ id: "t1", quote: "Lovely", name: "A.", permission: false, published: true }];
    d.contact.verified = true;
    await staff.admin("content-save", { draft: d });
    const after = (await staff.admin("content-get")).data.draft;
    assert.equal(after.trust.testimonials[0].published, false); assert.equal(after.contact.verified, false);
  });
  await check("Content rejects unsafe links", async () => {
    const d = (await owner.admin("content-get")).data.draft;
    d.hero.imageUrl = "javascript:alert(1)";
    assert.equal((await owner.admin("content-save", { draft: d })).status, 400);
  });

  // ---------- Exports and email ----------
  await check("CSV exports include only permitted fields; marketing export only has opted-in people", async () => {
    const all = (await staff.admin("waitlist-csv", { kind: "all" })).data.csv;
    const header = all.split("\r\n")[0];
    assert.equal(header, "joined_at,name,email,room_preference,marketing_consent,consent_version,source,tags,status,portal_activated");
    assert.ok(!/Slow down|Rest\./.test(all), "intention leaked into CSV");
    const mkt = (await staff.admin("waitlist-csv", { kind: "marketing" })).data.csv;
    assert.ok(mkt.includes("Ama@Example.com") || mkt.toLowerCase().includes("ama@example.com"));
    assert.ok(!mkt.includes("nia@example.com") && !mkt.includes("twin@example.com"));
  });
  await check("CSV cells are protected against spreadsheet formula injection", async () => {
    await joinWaitlist(new Client(), { name: "=HYPERLINK(\"x\")", email: "formula@example.com" });
    const all = (await owner.admin("waitlist-csv", { kind: "all" })).data.csv;
    assert.ok(all.includes("'=HYPERLINK"));
  });
  await check("Failed emails are visible to staff and can be retried", async () => {
    const failed = (await staff.admin("emails-list", { status: "failed" })).data.rows;
    const job = failed.find((j) => j.to_email === "nia@example.com");
    assert.ok(job, "failed job not listed"); assert.match(job.last_error, /503|Simulated/);
    const r = await staff.admin("email-retry", { id: job.id });
    assert.equal(r.data.sent, 1);
    assert.equal((await outbox()).filter((m) => m.to.includes("nia@example.com")).length, 1);
  });
  await check("Unsubscribe link turns off marketing consent", async () => {
    const t = sec.sign({ e: "ama@example.com", k: "mkt" });
    const r = await fetch(`${BASE}/api/site?fn=unsubscribe&t=${encodeURIComponent(t)}`);
    assert.equal(r.status, 200);
    const mkt = (await owner.admin("waitlist-csv", { kind: "marketing" })).data.csv;
    assert.ok(!mkt.toLowerCase().includes("ama@example.com"));
    const bad = await fetch(`${BASE}/api/site?fn=unsubscribe&t=forged.token`);
    assert.equal(bad.status, 400);
  });
  await check("Scheduled job requires its secret", async () => {
    assert.equal((await fetch(`${BASE}/api/cron`)).status, 401);
    assert.equal((await fetch(`${BASE}/dev/cron`)).status, 200);
  });
  await check("Deactivated staff are signed out immediately", async () => {
    const list = (await owner.admin("staff-list")).data.rows;
    const j = list.find((a) => a.email === "jadon@example.com");
    await owner.admin("staff-update", { id: j.id, role: "staff", active: false });
    assert.equal((await staff.admin("overview")).status, 401);
  });
  await check("The last owner cannot be demoted", async () => {
    const list = (await owner.admin("staff-list")).data.rows;
    const me = list.find((a) => a.email === "estar@example.com");
    assert.equal((await owner.admin("staff-update", { id: me.id, role: "staff", active: true })).status, 400);
  });

  srv.kill();
  console.log(results.join("\n"));
  console.log(`\n${passed} of ${results.length} checks passed.`);
  if (process.exitCode) console.log("\nServer log:\n" + log.slice(-3000));
})();
