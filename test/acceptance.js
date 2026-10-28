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
(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "tools", "devserver.js")], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: "pglite:memory", DEV_UPLOAD_DIR: "/tmp/eg-test-uploads", ADMIN_REQUIRE_SIGNIN: "true" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 60 && !log.includes("Dev server"); i++) await sleep(100);

  const visitor = new Client();
  const owner = new Client("10.1.0.1");
  const staff = new Client("10.1.0.2");

  // ---------- Public page and prices ----------
  let content;
  await check("Public content loads; the 5 offered room prices are exact (Emerald and Obsidian aligned at $2,799)", async () => {
    content = await visitor.get("/api/site?fn=content");
    assert.equal(content.status, 200);
    const want = { "Sapphire": 319900, "Tiger’s Eye": 299900, "Emerald": 279900, "Obsidian": 279900, "Moonstone": 269900 };
    const got = Object.fromEntries(content.data.rooms.map((r) => [r.name, r.price_cents]));
    assert.deepEqual(got, want);
  });
  await check("Prices are per guest, include the full retreat, and capacities match the confirmed details", async () => {
    const want = { "Sapphire": 1, "Tiger’s Eye": 2, "Emerald": 2, "Obsidian": 2, "Moonstone": 3 };
    for (const r of content.data.rooms) {
      assert.equal(r.price_basis, "per_guest"); assert.equal(r.guest_capacity, want[r.name], r.name);
      assert.equal(r.includes_admission, "yes"); assert.equal(r.difference_note, ""); assert.equal(r.availability, "soon");
    }
  });
  await check("Room photos load, with descriptions", async () => {
    const want = { "Sapphire": 4, "Tiger’s Eye": 4, "Emerald": 5, "Obsidian": 4, "Moonstone": 6 };
    for (const r of content.data.rooms) {
      assert.equal(r.photos.length, want[r.name], r.name);
      for (const p of r.photos) { assert.ok(p.alt && p.alt.length > 20, p.url); assert.equal((await fetch(BASE + p.url)).status, 200, p.url); }
      if (r.name === "Emerald" || r.name === "Moonstone") {
        const urls = r.photos.map((p) => p.url);
        assert.equal(urls.indexOf("/media/rooms/downstairs-living-1.jpg") + 1, urls.indexOf("/media/rooms/downstairs-kitchenette.jpg"), r.name);
      }
    }
  });
  await check("Beds, bathrooms and accessibility match the confirmed details; room privacy is not shown", async () => {
    const by = Object.fromEntries(content.data.rooms.map((r) => [r.name, r]));
    assert.equal(by["Sapphire"].beds, "1 queen bed"); assert.equal(by["Moonstone"].beds, "3 queen beds");
    for (const n of ["Tiger’s Eye", "Emerald", "Obsidian"]) assert.equal(by[n].beds, "2 queen beds", n);
    for (const n of ["Sapphire", "Tiger’s Eye", "Emerald", "Obsidian"]) assert.match(by[n].bathroom, /^Private en suite/, n);
    for (const n of ["Moonstone"]) assert.equal(by[n].bathroom, "Detached shared full bathroom", n);
    for (const n of ["Emerald", "Moonstone"]) assert.match(by[n].accessibility, /^Downstairs/, n);
    for (const n of ["Sapphire", "Tiger’s Eye", "Obsidian"]) assert.equal(by[n].accessibility, "Upstairs.", n);
    for (const n of ["Moonstone"]) assert.equal(by[n].features, "Shared detached balcony with a jacuzzi", n);
    for (const r of content.data.rooms) assert.ok(!("privacy" in r), r.name);
    assert.match(content.data.site.stay.sharedNote, /No one shares a bed/);
  });
  await check("Confirmed dates and venue are public; reservations closed", async () => {
    assert.deepEqual(content.data.retreat.dates, { start: "March 6, 2027", end: "March 10, 2027", nights: 4 });
    assert.deepEqual(content.data.retreat.venue, { name: "Peace on the Pond", city: "Douglasville, Georgia" });
    assert.equal(content.data.retreat.reservationsOpen, false);
  });
  await check("Experience photos are public, each with a local image and a description", async () => {
    const photos = content.data.site.experience.photos;
    assert.equal(photos.length, 10);
    for (const p of photos) { assert.match(p.url, /^\/media\/events\/[a-z0-9-]+\.jpg$/); assert.ok(p.alt && p.alt.length > 20, p.id); assert.equal(p.caption, "", p.id); }
    for (const p of photos) assert.equal((await fetch(BASE + p.url)).status, 200, p.url);
    assert.ok(!/approved for this retreat/.test(content.data.site.grounds.intro), "venue photo approval note still shown");
  });
  await check("Logos, Estar's portrait and her seven experiences are public; nothing held back (such as yoni steaming) or portal-only is", async () => {
    const titles = content.data.site.experience.activities.map((a) => a.title);
    assert.equal(titles.length, 7); assert.ok(titles.includes("Sensual Embodiment Workshop")); assert.ok(titles.includes("Rest, nourishment, and communion with nature"));
    assert.equal(content.data.site.portal, undefined);
    assert.ok(!JSON.stringify(content.data).toLowerCase().includes("yoni"));
    assert.match(content.data.site.host.bio, /^ESTAR is a multidisciplinary artist, Singing Yogini/);
    const b = content.data.site.brand;
    for (const u of [b.logoUrl, b.logoDarkUrl, content.data.site.host.photoUrl, "/media/brand/favicon.png"]) assert.equal((await fetch(BASE + u)).status, 200, u);
    assert.equal(b.logoUrl, "/media/brand/logo-light.png"); assert.equal(b.logoDarkUrl, "/media/brand/logo-dark.png");
  });
  await check("Day immersions are public with standard and early-bird prices; the early bird ends December 12, 2026", async () => {
    assert.deepEqual(content.data.retreat.immersions.map((i) => [i.name, i.days, i.price_cents, i.early_bird_price_cents, i.early_bird_ends]),
      [["One-Day Immersion", 1, 44400, 33300, "2026-12-12"], ["Two-Day Immersion", 2, 66600, 55500, "2026-12-12"]]);
    assert.match(content.data.site.immersions.earlyBirdNote, /ends December 12, 2026\.$/);
    const { earlyBirdPrice } = require("../lib/retreat");
    const imm = { early_bird_price_cents: 33300, early_bird_ends: "2026-12-12" };
    assert.equal(earlyBirdPrice(imm, "America/New_York", new Date("2026-12-13T04:30:00Z")), 33300, "still Dec 12 in Georgia");
    assert.equal(earlyBirdPrice(imm, "America/New_York", new Date("2026-12-13T05:30:00Z")), null, "Dec 13 in Georgia: early bird over");
    assert.match(content.data.site.immersions.includes, /ceremonies, embodiment practices, workshops, sisterhood gatherings and meals/);
    assert.ok(content.data.site.faqs.some((f) => f.id === "f11" && /without staying overnight/.test(f.q)));
  });
  await check("Estar's eleven FAQs are public in her order, with the heading; terms stay unconfirmed and off the page", async () => {
    assert.equal(content.data.retreat.terms, null);
    const f = content.data.site.faqs;
    assert.equal(f.length, 11); assert.equal(f[0].q, "When do eye arrive and depart?"); assert.equal(f[10].q, "What should eye bring?");
    assert.ok(!f.some((x) => /\[[^\]]+\]/.test(x.a)), "no placeholder answers left");
    assert.match(f.find((x) => x.id === "f8").a, /30% nonrefundable deposit/);
    assert.match(f.find((x) => x.id === "f9").a, /^All retreat deposits are nonrefundable/);
    assert.match(f.find((x) => x.id === "f10").a, /\n\* A bathing suit\n/);
    assert.equal(content.data.site.faqPage.intro, "Everything You Need to Know Before Entering the Sanctuary 🌺");
  });
  await check("Draft preview is refused without an admin session", async () => {
    const r = await visitor.get("/api/site?fn=content&preview=1");
    assert.equal(r.status, 401);
  });

  // ---------- Waiting list ----------
  await check("Cross-site POST without our headers is blocked", async () => {
    const r = await fetch(`${BASE}/api/admin`, { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ action: "status" }) });
    assert.equal(r.status, 403);
    assert.equal((await fetch(`${BASE}/api/site?fn=waitlist`, { method: "POST" })).status, 404, "the waiting list is gone");
    assert.equal((await fetch(`${BASE}/api/site?fn=me`)).status, 404, "the guest portal is gone");
  });

  // ---------- Admin access ----------
  await check("Unauthenticated visitor cannot use any admin action", async () => {
    for (const a of ["overview", "sales-list", "sale-save", "payment-add", "sales-csv", "rooms-list", "room-save", "content-publish", "staff-list", "audit-list"]) {
      const r = await visitor.admin(a); assert.equal(r.status, 401, a);
    }
  });
  await check("The owner signs in with ADMIN_EMAIL and ADMIN_PASSWORD; wrong passwords and the old setup flow are refused", async () => {
    assert.equal((await owner.admin("status")).data.state, "signed_out");
    assert.equal((await owner.admin("login", { email: "estar@example.com", password: "wrong-password-1" })).status, 400);
    assert.equal((await owner.admin("login", { email: "someone@example.com", password: "local-admin-password-123" })).status, 400);
    assert.equal((await owner.admin("setup", { setupToken: "x", name: "X", email: "x@example.com", password: "another-long-pass-1" })).status, 400);
    assert.equal((await owner.admin("code-verify", { code: "x" })).status, 400);
    assert.equal((await owner.admin("login", { email: " Estar@Example.com", password: "local-admin-password-123" })).status, 200);
    const st = (await owner.admin("status")).data;
    assert.equal(st.state, "ready"); assert.equal(st.admin.role, "owner"); assert.equal(st.admin.name, "Estar");
    assert.equal((await owner.admin("overview")).status, 200);
  });
  await check("An admin can optionally add an authenticator app", async () => {
    const b = await owner.admin("mfa-begin"); assert.ok(b.data.secret);
    const bad = await owner.admin("mfa-enable", { code: "000000" }); assert.equal(bad.status, 400);
    const ok = await owner.admin("mfa-enable", { code: sec.totpNow(b.data.secret) }); assert.equal(ok.status, 200);
    owner.totp = b.data.secret;
    const o = await owner.admin("overview"); assert.equal(o.status, 200);
    assert.equal(o.data.totals.sold, 0); assert.equal(o.data.totals.residential_tickets, 10);
  });
  await check("Once an authenticator app is on, sign-in also needs the app code", async () => {
    const c = new Client("10.1.0.9");
    assert.equal((await c.admin("login", { email: "estar@example.com", password: "local-admin-password-123" })).status, 200);
    assert.equal((await c.admin("status")).data.state, "mfa_verify");
    const r = await c.admin("overview"); assert.equal(r.status, 401); assert.equal(r.data.needMfa, true);
    assert.equal((await c.admin("mfa-begin")).status, 401);
    assert.equal((await c.admin("mfa-verify", { code: "000000" })).status, 400);
    assert.equal((await c.admin("mfa-verify", { code: sec.totpNow(owner.totp) })).status, 200);
    assert.equal((await c.admin("overview")).status, 200);
  });
  await check("Owner invites staff; staff accepts and signs in with their own email and password", async () => {
    const r = await owner.admin("staff-invite", { name: "Jadon", email: "jadon@example.com", role: "staff" });
    assert.equal(r.status, 200);
    const tok = r.data.inviteUrl.split("invite=")[1];
    assert.equal((await staff.admin("invite-accept", { token: tok, password: "staff-password-123" })).status, 200);
    assert.equal((await staff.admin("overview")).status, 200);
    assert.equal((await new Client().admin("invite-accept", { token: tok, password: "reuse-attempt-123" })).status, 400);
    const again = new Client("10.1.0.12");
    assert.equal((await again.admin("login", { email: "jadon@example.com", password: "staff-password-123" })).status, 200);
    assert.equal((await again.admin("status")).data.admin.role, "staff");
    assert.equal((await again.admin("login", { email: "jadon@example.com", password: "local-admin-password-123" })).status, 400, "the owner password only works for the owner email");
  });
  await check("The sofa beds are hidden from the public page but kept, with their details, in the admin area", async () => {
    const pub = (await visitor.get("/api/site?fn=content")).data.rooms;
    assert.equal(pub.length, 5); assert.ok(!pub.some((r) => /sofa/i.test(r.name)));
    const rooms = (await owner.admin("rooms-list")).data.rooms.filter((r) => /sofa/i.test(r.name));
    assert.equal(rooms.length, 2);
    for (const r of rooms) {
      assert.equal(r.visible, false); assert.equal(r.price_cents, 111100); assert.equal(r.guest_capacity, 1);
      assert.equal(r.bathroom, "Detached shared full bathroom"); assert.equal(r.photos.length, 6);
    }
  });
  await check("Staff permissions are enforced on the server", async () => {
    const rooms = (await staff.admin("rooms-list")).data.rooms;
    const em = rooms.find((r) => r.name === "Emerald");
    const base = { ...em, photos: em.photos };
    let r = await staff.admin("room-save", { ...base, price_cents: 100 }); assert.equal(r.status, 403);
    r = await staff.admin("room-save", { ...base, price_basis: "per_room" }); assert.equal(r.status, 403);
    r = await staff.admin("room-save", { ...base, beds: "One queen bed" }); assert.equal(r.status, 200);
    for (const [a, body] of [["retreat-save", { name: "X", timezone: "America/New_York" }], ["terms-save", {}], ["staff-invite", { name: "Y", email: "y@example.com" }], ["reservations-toggle", { open: true }], ["immersions-save", { enabled: false }], ["room-delete", { id: "room_sapphire" }], ["payment-links-save", { links: { "*": { full: "https://pay.example.com/x" } } }]]) {
      assert.equal((await staff.admin(a, body)).status, 403, a);
    }
  });
  await check("Owner price change is recorded in the change history", async () => {
    const rooms = (await owner.admin("rooms-list")).data.rooms;
    const ob = rooms.find((r) => r.name === "Obsidian");
    assert.equal((await owner.admin("room-save", { ...ob, price_cents: 279950 })).status, 200);
    const log = (await owner.admin("audit-list")).data.rows;
    const ev = log.find((a) => a.action === "room.price_changed" && a.entity_id === ob.id);
    assert.ok(ev, "no audit event"); assert.equal(ev.before.price_cents, 279900); assert.equal(ev.after.price_cents, 279950);
    assert.match(ev.actor_label, /Estar/);
    assert.ok(log.find((a) => a.action === "retreat.confirmed_details" && a.actor_label === "migration"), "no migration audit event");
    assert.ok(log.find((a) => a.action === "room.price_changed" && a.actor_label === "migration" && a.before.price_cents === 289900 && a.after.price_cents === 279900), "no audit event for aligning Obsidian");
    await owner.admin("room-save", { ...ob, price_cents: 279900 });
  });
  await check("Payments stay off while terms, contact or links are missing; rooms need no inventory", async () => {
    const r = await owner.admin("reservations-toggle", { open: true });
    assert.equal(r.status, 400);
    const c = r.data.checklist.items;
    assert.ok(c.find((i) => i.key === "dates" && i.ok)); assert.ok(c.find((i) => i.key === "venue" && i.ok));
    assert.ok(c.find((i) => i.key === "terms" && !i.ok));
    assert.ok(c.find((i) => i.key === "room:room_emerald" && i.ok), "Emerald has its price, tickets, beds and photos");
    assert.ok(!c.some((i) => /inventory/i.test(i.label + i.detail)));
    assert.ok(!c.find((i) => i.key.startsWith("diff:")), "Emerald and Obsidian share a price, so no difference note is needed");
    const ret = (await owner.admin("retreat-get")).data.retreat;
    assert.equal(ret.terms.deposit_percent, 30); assert.equal(ret.terms_confirmed, false);
    const refused = await owner.admin("immersions-save", { enabled: true, immersions: [{ id: "imm_x", name: "Test", days: 1, price_cents: 10000, early_bird_price_cents: 20000 }] });
    assert.equal(refused.status, 400); assert.match(refused.data.error, /early-bird price for Test must be lower/);
    assert.equal((await owner.admin("retreat-save", ret)).status, 200, "saving the retreat details leaves the immersions alone");
    assert.equal((await owner.admin("retreat-get")).data.retreat.immersions.length, 2);
  });
  await check("Payment links: owner only, https only, hidden from visitors until reservations open, and tracked on the checklist", async () => {
    let c = (await owner.admin("retreat-get")).data.checklist.items.find((i) => i.key === "payment_links");
    assert.ok(c && !c.ok && /Sapphire/.test(c.detail) && /One-Day Immersion/.test(c.detail));
    assert.equal((await owner.admin("payment-links-save", { links: { "*": { full: "http://pay.example.com/x" } } })).status, 400);
    const links = { "*": { deposit: "https://pay.example.com/deposit", full: "https://pay.example.com/full" },
      room_sapphire: { full: "https://pay.example.com/sapphire" }, imm_one_day: { deposit: "https://pay.example.com/nope", full: "https://pay.example.com/one-day" },
      imm_two_day: { full: "https://pay.example.com/two-day" }, not_an_option: { full: "https://pay.example.com/x" } };
    assert.equal((await owner.admin("payment-links-save", { links })).status, 200);
    const saved = (await owner.admin("retreat-get")).data;
    assert.equal(saved.retreat.payment_links.not_an_option, undefined);
    c = saved.checklist.items.find((i) => i.key === "payment_links"); assert.ok(c.ok, c.detail);
    const pub = (await visitor.get("/api/site?fn=content")).data.retreat;
    assert.deepEqual(pub.payLinks, {}); assert.equal(pub.depositPercent, 30);
    const { resolvedPayLinks } = require("../lib/retreat");
    const r = resolvedPayLinks({ day_pass_enabled: true, immersions: saved.retreat.immersions, payment_links: saved.retreat.payment_links }, [{ id: "room_sapphire" }, { id: "room_emerald" }]);
    assert.deepEqual(r.room_sapphire, { deposit: "https://pay.example.com/deposit", full: "https://pay.example.com/sapphire" });
    assert.deepEqual(r.room_emerald, { deposit: "https://pay.example.com/deposit", full: "https://pay.example.com/full" });
    assert.deepEqual(r.imm_one_day, { deposit: "", full: "https://pay.example.com/one-day" }, "immersions are paid in full");
  });
  await check("The Secure your spot section and Book a call wording are public, and the hero button says Secure your spot", async () => {
    const s = (await visitor.get("/api/site?fn=content")).data.site;
    assert.equal(s.reserve.heading, "Secure your spot"); assert.equal(s.reserve.callLabel, "Book a call");
    assert.equal(s.hero.primaryLabel, "Secure your spot");
    assert.equal(s.reserve.payLabel, "Secure your spot");
    assert.ok(!/waiting list/i.test(s.faqs.find((f) => f.id === "f8").a));
  });

  // ---------- Content ----------
  await check("New page copy is in the draft only, visible in preview but not on the public page", async () => {
    const pub = (await visitor.get("/api/site?fn=content")).data.site;
    assert.equal(pub.investments.heading, ""); assert.equal(pub.transformation.items.length, 0);
    const pre = (await owner.get("/api/site?fn=content&preview=1")).data.site;
    assert.equal(pre.investments.heading, "Your investment"); assert.equal(pre.transformation.items.length, 5);
    assert.match(pre.overview.body, /^Eye am creating a sanctuary/);
  });
  await check("Admin edits content, previews the draft, then publishes", async () => {
    const d = (await owner.admin("content-get")).data.draft;
    d.hero.title = "Return to yourself. (test edit)";
    assert.equal((await owner.admin("content-save", { draft: d })).status, 200);
    assert.notEqual((await visitor.get("/api/site?fn=content")).data.site.hero.title, d.hero.title);
    assert.equal((await owner.get("/api/site?fn=content&preview=1")).data.site.hero.title, d.hero.title);
    assert.equal((await owner.admin("content-publish")).status, 200);
    assert.equal((await visitor.get("/api/site?fn=content")).data.site.hero.title, d.hero.title);
  });
  await check("A held-back session (such as yoni steaming) cannot be published until the owner records the safety review", async () => {
    const od = (await owner.admin("content-get")).data.draft;
    od.experience.activities.push({ id: "y1", title: "Yoni steaming", description: "", published: false, reviewRequired: true, reviewDone: false });
    assert.equal((await owner.admin("content-save", { draft: od })).status, 200);
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
  // ---------- Tickets and payments ----------
  await check("Recording a payment sells a ticket; the room sells out at its guest count and can't be oversold", async () => {
    let r = await owner.admin("sale-save", { option_id: "room_sapphire", guest_name: "Ama Mensah", guest_email: "Ama@Example.com", plan: "deposit", first_payment_cents: 95970, paid_on: "2026-11-01" });
    assert.equal(r.status, 200);
    const list = (await owner.admin("sales-list")).data;
    const sale = list.sales.find((x) => x.id === r.data.id);
    assert.equal(sale.total_cents, 319900); assert.equal(sale.paid_cents, 95970); assert.equal(sale.balance_cents, 223930); assert.equal(sale.guest_email, "ama@example.com");
    const sap = list.options.find((o) => o.id === "room_sapphire");
    assert.equal(sap.sold, 1); assert.equal(sap.left, 0);
    r = await owner.admin("sale-save", { option_id: "room_sapphire", guest_name: "Second Guest", plan: "full", first_payment_cents: 319900 });
    assert.equal(r.status, 400); assert.match(r.data.error, /no tickets left/);
    const pub = (await visitor.get("/api/site?fn=content")).data.rooms.find((x) => x.id === "room_sapphire");
    assert.equal(pub.availability, "sold_out");
    const o = (await owner.admin("overview")).data.totals;
    assert.equal(o.residential_sold, 1); assert.equal(o.collected_cents, 95970); assert.equal(o.outstanding_cents, 223930);
  });
  await check("Installments and refunds update the balance; overpaying is refused", async () => {
    const sale = (await owner.admin("sales-list")).data.sales.find((x) => x.option_id === "room_sapphire" && x.status === "active");
    assert.equal((await owner.admin("payment-add", { sale_id: sale.id, amount_cents: 300000 })).status, 400, "more than the balance");
    assert.equal((await owner.admin("payment-add", { sale_id: sale.id, amount_cents: 100000, note: "2nd installment" })).status, 200);
    let x = (await owner.admin("sales-list")).data.sales.find((y) => y.id === sale.id);
    assert.equal(x.paid_cents, 195970); assert.equal(x.balance_cents, 123930); assert.equal(x.payments.length, 2);
    assert.equal((await owner.admin("payment-add", { sale_id: sale.id, kind: "refund", amount_cents: 5000 })).status, 200);
    x = (await owner.admin("sales-list")).data.sales.find((y) => y.id === sale.id);
    assert.equal(x.paid_cents, 190970); assert.equal(x.balance_cents, 128930);
    const refund = x.payments.find((p) => p.kind === "refund");
    assert.equal((await owner.admin("payment-delete", { id: refund.id })).status, 200);
    assert.equal((await owner.admin("sales-list")).data.sales.find((y) => y.id === sale.id).paid_cents, 195970);
  });
  await check("Canceling a ticket frees it for someone else; restoring is refused if it has been resold", async () => {
    const sale = (await owner.admin("sales-list")).data.sales.find((x) => x.option_id === "room_sapphire" && x.status === "active");
    assert.equal((await owner.admin("sale-cancel", { id: sale.id })).status, 200);
    assert.equal((await visitor.get("/api/site?fn=content")).data.rooms.find((x) => x.id === "room_sapphire").availability, "soon");
    assert.equal((await owner.admin("sale-save", { option_id: "room_sapphire", guest_name: "New Guest", plan: "full", first_payment_cents: 319900 })).status, 200);
    const back = await owner.admin("sale-cancel", { id: sale.id, restore: true });
    assert.equal(back.status, 400); assert.match(back.data.error, /no tickets left/);
  });
  await check("Day immersions are paid in full and sell out at their ticket limit", async () => {
    assert.deepEqual((await owner.admin("rooms-list")).data.immersions.map((i) => i.ticket_limit), [20, 20], "each day immersion has 20 tickets");
    assert.equal((await owner.admin("sale-save", { option_id: "imm_one_day", guest_name: "Day Guest", plan: "deposit", first_payment_cents: 1000 })).status, 400);
    const imms = (await owner.admin("rooms-list")).data.immersions.map((i) => (i.id === "imm_one_day" ? { ...i, ticket_limit: 1 } : i));
    assert.equal((await owner.admin("immersions-save", { enabled: true, immersions: imms })).status, 200);
    assert.equal((await visitor.get("/api/site?fn=content")).data.retreat.immersions.find((i) => i.id === "imm_one_day").sold_out, false);
    const sold = await owner.admin("sale-save", { option_id: "imm_one_day", guest_name: "Day Guest", plan: "full", first_payment_cents: 33300 });
    assert.equal(sold.status, 200);
    assert.equal((await owner.admin("sales-list")).data.sales.find((x) => x.id === sold.data.id).total_cents, 33300, "sold at the early-bird price");
    assert.equal((await visitor.get("/api/site?fn=content")).data.retreat.immersions.find((i) => i.id === "imm_one_day").sold_out, true);
    assert.equal((await owner.admin("sale-save", { option_id: "imm_one_day", guest_name: "Late Guest", plan: "full" })).status, 400);
    assert.equal((await owner.admin("rooms-list")).data.immersions.find((i) => i.id === "imm_one_day").sold, 1);
  });
  await check("The sales CSV lists guests and balances, protected against spreadsheet formula injection", async () => {
    assert.equal((await owner.admin("sale-save", { option_id: "room_moonstone", guest_name: "=HYPERLINK(\"x\")", plan: "deposit", first_payment_cents: 80970 })).status, 200);
    const csv = (await owner.admin("sales-csv")).data.csv;
    assert.equal(csv.split("\r\n")[0], "recorded_on,guest_name,guest_email,guest_phone,ticket,plan,price,paid,balance,status,notes");
    assert.ok(csv.includes("'=HYPERLINK")); assert.ok(/Moonstone,Deposit,2699\.00,809\.70,1889\.30,active/.test(csv));
  });
  await check("Unsubscribe link turns off marketing consent", async () => {
    const t = sec.sign({ e: "ama@example.com", k: "mkt" });
    const r = await fetch(`${BASE}/api/site?fn=unsubscribe&t=${encodeURIComponent(t)}`);
    assert.equal(r.status, 200); assert.match(await r.text(), /unsubscribed/);
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

  // ---------- Sign-in turned off (the default without ADMIN_REQUIRE_SIGNIN) ----------
  await check("With sign-in off, opening the admin goes straight in as the owner, and a warning shows in Integrations", async () => {
    const env = { ...process.env, PORT: String(PORT + 1), DATABASE_URL: "pglite:memory", DEV_UPLOAD_DIR: "/tmp/eg-test-uploads" };
    delete env.ADMIN_REQUIRE_SIGNIN;
    const open = spawn(process.execPath, [path.join(__dirname, "..", "tools", "devserver.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let olog = ""; open.stdout.on("data", (d) => (olog += d));
    try {
      for (let i = 0; i < 80 && !olog.includes("Dev server"); i++) await sleep(100);
      const c = new Client("10.2.0.1");
      const req = (action) => fetch(`http://localhost:${PORT + 1}/api/admin`, { method: "POST", headers: { Origin: `http://localhost:${PORT + 1}`, "Content-Type": "application/json", "X-Requested-With": "fetch", "X-Forwarded-For": c.ip }, body: JSON.stringify({ action }) }).then((r) => r.json().then((data) => ({ status: r.status, data })));
      const st = await req("status");
      assert.equal(st.data.state, "ready"); assert.equal(st.data.open, true); assert.equal(st.data.admin.role, "owner");
      assert.equal((await req("overview")).status, 200);
      const ig = (await req("integrations")).data.items.find((i) => i.name === "Admin sign-in");
      assert.ok(ig && !ig.ok && /anyone with the \/admin\/ link/.test(ig.detail));
      const pre = await fetch(`http://localhost:${PORT + 1}/api/site?fn=content&preview=1`);
      assert.equal(pre.status, 200, "Preview works without signing in"); assert.equal((await pre.json()).preview, true);
    } finally { open.kill(); }
  });
  console.log(results.join("\n"));
  console.log(`\n${passed} of ${results.length} checks passed.`);
  if (process.exitCode) console.log("\nServer log:\n" + log.slice(-3000));
})();
