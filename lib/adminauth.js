// Admin accounts: first-owner setup, password sign-in, required authenticator-app MFA, invitations.
const QRCode = require("qrcode");
const { q, one, tx } = require("./db");
const { UserError, send, clientIp, siteUrl } = require("./http");
const sec = require("./security");
const { normEmail, text } = require("./validate");
const { enforce } = require("./ratelimit");
const { audit } = require("./audit");
const sessions = require("./sessions");
const email = require("./email");

const ISSUER = "Empowered Wombman Admin";

function checkPassword(pw) {
  const s = String(pw || "");
  if (s.length < 12) throw new UserError("Use a password of at least 12 characters.", 400, { field: "password" });
  if (s.length > 200) throw new UserError("That password is too long.", 400, { field: "password" });
  return s;
}

const publicAdmin = (a) => a && ({ id: a.id, name: a.name, email: a.email, role: a.role });

async function sessionAdmin(req) {
  const s = await sessions.get(req, "admin");
  if (!s) return { s: null, a: null };
  const a = await one("SELECT * FROM admins WHERE id = $1 AND active", [s.subject_id]);
  return { s: a ? s : null, a };
}

// Used by every protected admin action.
async function requireAdmin(req) {
  const { s, a } = await sessionAdmin(req);
  if (!s || !a) throw new UserError("Please sign in.", 401, { signedOut: true });
  if (!s.mfa_ok || !a.totp_enabled) throw new UserError("Finish two-step sign-in first.", 401, { needMfa: true });
  return a;
}

function requireOwner(a) {
  if (a.role !== "owner") throw new UserError("Only the owner can do this.", 403);
}

async function status(req, res) {
  const n = (await one("SELECT count(*)::int AS n FROM admins")).n;
  if (n === 0) return send(res, 200, { state: "setup" });
  const { s, a } = await sessionAdmin(req);
  if (!s) return send(res, 200, { state: "signed_out" });
  if (!a.totp_enabled) return send(res, 200, { state: "mfa_enroll", admin: publicAdmin(a) });
  if (!s.mfa_ok) return send(res, 200, { state: "mfa_verify", admin: publicAdmin(a) });
  send(res, 200, { state: "ready", admin: publicAdmin(a) });
}

async function setup(req, res, b) {
  const want = process.env.SETUP_TOKEN;
  if (!want || want.length < 16) throw new UserError("Set a SETUP_TOKEN environment variable (16+ characters) in Vercel first.", 400);
  await enforce(`setup:${clientIp(req)}`, 10, 3600);
  if (!sec.safeEqual(String(b.setupToken || ""), want)) throw new UserError("That setup token is not correct.", 403);
  const em = normEmail(b.email);
  const name = text(b.name, { max: 100, required: true, label: "Name" });
  const pw = checkPassword(b.password);
  const adminId = sec.id("adm");
  await tx(async (t) => {
    const n = (await t.query("SELECT count(*)::int AS n FROM admins")).rows[0].n;
    if (n > 0) throw new UserError("The owner account already exists. Please sign in.", 409);
    await t.query(`INSERT INTO admins (id, email, name, role, pass_hash) VALUES ($1,$2,$3,'owner',$4)`, [adminId, em, name, sec.hashPassword(pw)]);
    await audit(t, { id: adminId, name, role: "owner" }, "admin.setup_owner", "admin", adminId, null, { email: em, name });
  });
  await sessions.create(req, res, "admin", adminId, false);
  send(res, 200, { ok: true });
}

async function login(req, res, b) {
  const em = normEmail(b.email);
  await enforce(`alogin:ip:${clientIp(req)}`, 30, 900, "Too many sign-in attempts. Please wait 15 minutes.");
  const a = await one("SELECT * FROM admins WHERE email = $1", [em]);
  const generic = new UserError("Email or password is not correct.", 400);
  if (!a || !a.active || !a.pass_hash) { sec.hashPassword("timing-pad"); throw generic; }
  if (a.locked_until && new Date(a.locked_until) > new Date()) throw new UserError("This account is locked for a few minutes after several failed attempts.", 429);
  if (!sec.verifyPassword(String(b.password || ""), a.pass_hash)) {
    await q(`UPDATE admins SET failed_logins = failed_logins + 1,
               locked_until = CASE WHEN failed_logins + 1 >= 8 THEN now() + interval '15 minutes' ELSE locked_until END
             WHERE id = $1`, [a.id]);
    throw generic;
  }
  await q("UPDATE admins SET failed_logins = 0, locked_until = NULL WHERE id = $1", [a.id]);
  await sessions.create(req, res, "admin", a.id, false);
  send(res, 200, { ok: true, next: a.totp_enabled ? "mfa_verify" : "mfa_enroll" });
}

async function mfaBegin(req, res) {
  const { s, a } = await sessionAdmin(req);
  if (!s) throw new UserError("Please sign in.", 401, { signedOut: true });
  if (a.totp_enabled) throw new UserError("Two-step sign-in is already set up.");
  const secret = sec.newTotpSecret();
  await q("UPDATE admins SET totp_secret_enc = $1 WHERE id = $2", [sec.encrypt(secret), a.id]);
  const uri = `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(a.email)}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&digits=6&period=30`;
  const qr = await QRCode.toString(uri, { type: "svg", margin: 1, width: 220 });
  send(res, 200, { secret, qr });
}

async function mfaEnable(req, res, b) {
  const { s, a } = await sessionAdmin(req);
  if (!s) throw new UserError("Please sign in.", 401, { signedOut: true });
  if (!a.totp_secret_enc) throw new UserError("Start setup first.");
  await enforce(`mfa:${a.id}`, 10, 600);
  if (!sec.verifyTotp(sec.decrypt(a.totp_secret_enc), b.code)) throw new UserError("That code doesn’t match. Check the time on your phone and try the newest code.", 400, { field: "code" });
  await tx(async (t) => {
    await t.query("UPDATE admins SET totp_enabled = true, last_login_at = now() WHERE id = $1", [a.id]);
    await audit(t, a, "admin.mfa_enabled", "admin", a.id);
  });
  await sessions.markMfa(req);
  send(res, 200, { ok: true });
}

async function mfaVerify(req, res, b) {
  const { s, a } = await sessionAdmin(req);
  if (!s) throw new UserError("Please sign in.", 401, { signedOut: true });
  if (!a.totp_enabled) throw new UserError("Set up two-step sign-in first.");
  await enforce(`mfa:${a.id}`, 10, 600, "Too many codes tried. Please wait 10 minutes.");
  if (!sec.verifyTotp(sec.decrypt(a.totp_secret_enc), b.code)) throw new UserError("That code doesn’t match. Try the newest code in your authenticator app.", 400, { field: "code" });
  await q("UPDATE admins SET last_login_at = now() WHERE id = $1", [a.id]);
  await sessions.markMfa(req);
  send(res, 200, { ok: true });
}

async function logout(req, res) {
  await sessions.destroy(req, res, "admin");
  send(res, 200, { ok: true });
}

// ---- Staff invitations ----
async function invite(req, actor, b) {
  requireOwner(actor);
  const em = normEmail(b.email);
  const name = text(b.name, { max: 100, required: true, label: "Name" });
  const role = ["owner", "staff"].includes(b.role) ? b.role : "staff";
  const tok = sec.token(24);
  const base = siteUrl(req);
  const inviteUrl = `${base}/admin/#invite=${tok}`;
  const newId = sec.id("adm");
  const jobId = await tx(async (t) => {
    const exists = (await t.query("SELECT id FROM admins WHERE email = $1", [em])).rows[0];
    if (exists) throw new UserError("Someone with that email already has an admin account.");
    await t.query(
      `INSERT INTO admins (id, email, name, role, invite_hash, invite_expires) VALUES ($1,$2,$3,$4,$5, now() + interval '72 hours')`,
      [newId, em, name, role, sec.sha256(tok)]);
    await audit(t, actor, "admin.invited", "admin", newId, null, { email: em, name, role });
    return email.enqueue({ t, to: em, templateKey: "staff_invite", vars: { name, inviter: actor.name, role, invite_url: inviteUrl }, ref: "staff_invite" });
  });
  if (jobId) await email.attempt(jobId);
  return { ok: true, inviteUrl };
}

async function inviteInfo(req, res, b) {
  await enforce(`inv:${clientIp(req)}`, 30, 3600);
  const a = await one("SELECT name, email FROM admins WHERE invite_hash = $1 AND invite_expires > now() AND active", [sec.sha256(String(b.token || ""))]);
  if (!a) throw new UserError("This invitation link has expired or was already used. Ask the owner for a new one.", 400);
  send(res, 200, { name: a.name, email: a.email });
}

async function inviteAccept(req, res, b) {
  await enforce(`inv:${clientIp(req)}`, 30, 3600);
  const pw = checkPassword(b.password);
  const a = await one(
    `UPDATE admins SET pass_hash = $2, invite_hash = NULL, invite_expires = NULL, totp_enabled = false, totp_secret_enc = NULL
     WHERE invite_hash = $1 AND invite_expires > now() AND active RETURNING *`,
    [sec.sha256(String(b.token || "")), sec.hashPassword(pw)]);
  if (!a) throw new UserError("This invitation link has expired or was already used. Ask the owner for a new one.", 400);
  await q(`INSERT INTO audit_events (actor_id, actor_label, action, entity, entity_id) VALUES ($1,$2,'admin.invite_accepted','admin',$1)`, [a.id, `${a.name} (${a.role})`]);
  await sessions.create(req, res, "admin", a.id, false);
  send(res, 200, { ok: true });
}

module.exports = { status, setup, login, mfaBegin, mfaEnable, mfaVerify, logout, invite, inviteInfo, inviteAccept, requireAdmin, requireOwner, publicAdmin };
