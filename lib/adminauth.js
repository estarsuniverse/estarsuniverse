// Admin accounts: sign-in with email and password. The owner can always sign in with ADMIN_EMAIL and ADMIN_PASSWORD
// from Vercel (the account is created on first sign-in). Any admin can add an authenticator app as a second step.
// Staff are invited by the owner and choose their own password.
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

const publicAdmin = (a) => a && ({ id: a.id, name: a.name, email: a.email, role: a.role, authenticator: Boolean(a.totp_enabled) });

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
  if (!s.mfa_ok) throw new UserError("Enter the code from your authenticator app first.", 401, { needMfa: true });
  return a;
}

// ---- The owner's sign-in from Vercel: ADMIN_EMAIL and ADMIN_PASSWORD ----
function envOwner() {
  const em = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || "";
  return em && pw.length >= 8 ? { email: em, password: pw } : null;
}

// Creates the owner account on first sign-in, and restores it if it was deactivated or demoted.
async function ensureEnvOwner(em) {
  return tx(async (t) => {
    let a = (await t.query("SELECT * FROM admins WHERE email = $1 FOR UPDATE", [em])).rows[0];
    if (!a) {
      const adminId = sec.id("adm");
      const name = text(process.env.ADMIN_NAME, { max: 100 }) || "Owner";
      a = (await t.query("INSERT INTO admins (id, email, name, role) VALUES ($1,$2,$3,'owner') RETURNING *", [adminId, em, name])).rows[0];
      await audit(t, { id: adminId, name, role: "owner" }, "admin.owner_created", "admin", adminId, null, { email: em, name });
    } else if (!a.active || a.role !== "owner") {
      a = (await t.query("UPDATE admins SET active = true, role = 'owner' WHERE id = $1 RETURNING *", [a.id])).rows[0];
      await audit(t, a, "admin.owner_restored", "admin", a.id);
    }
    return a;
  });
}

async function signIn(req, res, a) {
  await q("UPDATE admins SET failed_logins = 0, locked_until = NULL, last_login_at = CASE WHEN $2 THEN now() ELSE last_login_at END WHERE id = $1", [a.id, !a.totp_enabled]);
  await sessions.create(req, res, "admin", a.id, !a.totp_enabled);
  send(res, 200, { ok: true, next: a.totp_enabled ? "mfa_verify" : "ready" });
}

function requireOwner(a) {
  if (a.role !== "owner") throw new UserError("Only the owner can do this.", 403);
}

async function status(req, res) {
  const { s, a } = await sessionAdmin(req);
  const ownerSet = Boolean(envOwner());
  // A session that is waiting for a step this account doesn't have (left over from the old admin code) counts as signed out.
  if (!s || (!s.mfa_ok && !a.totp_enabled)) return send(res, 200, { state: "signed_out", ownerSet });
  if (!s.mfa_ok) return send(res, 200, { state: "mfa_verify", admin: publicAdmin(a) });
  send(res, 200, { state: "ready", admin: publicAdmin(a) });
}

async function login(req, res, b) {
  const em = normEmail(b.email);
  const pw = String(b.password || "");
  await enforce(`alogin:ip:${clientIp(req)}`, 30, 900, "Too many sign-in attempts. Please wait 15 minutes.");
  await enforce(`alogin:em:${em}`, 10, 900, "Too many sign-in attempts. Please wait 15 minutes.");
  const owner = envOwner();
  // Compare fixed-length hashes so the check takes the same time whatever is typed.
  if (owner && em === owner.email && sec.safeEqual(sec.sha256(pw), sec.sha256(owner.password))) return signIn(req, res, await ensureEnvOwner(em));
  const a = await one("SELECT * FROM admins WHERE email = $1", [em]);
  const generic = new UserError("Email or password is not correct.", 400);
  if (!a || !a.active || !a.pass_hash) { sec.hashPassword("timing-pad"); throw generic; }
  if (a.locked_until && new Date(a.locked_until) > new Date()) throw new UserError("This account is locked for a few minutes after several failed attempts.", 429);
  if (!sec.verifyPassword(pw, a.pass_hash)) {
    await q(`UPDATE admins SET failed_logins = failed_logins + 1,
               locked_until = CASE WHEN failed_logins + 1 >= 8 THEN now() + interval '15 minutes' ELSE locked_until END
             WHERE id = $1`, [a.id]);
    throw generic;
  }
  await signIn(req, res, a);
}

async function mfaBegin(req, res) {
  const { s, a } = await sessionAdmin(req);
  if (!s) throw new UserError("Please sign in.", 401, { signedOut: true });
  if (!s.mfa_ok) throw new UserError("Enter the code from your authenticator app first.", 401, { needMfa: true });
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
  if (!s.mfa_ok) throw new UserError("Enter the code from your authenticator app first.", 401, { needMfa: true });
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
  await sessions.create(req, res, "admin", a.id, true);
  send(res, 200, { ok: true });
}

module.exports = { status, login, mfaBegin, mfaEnable, mfaVerify, logout, invite, inviteInfo, inviteAccept, requireAdmin, requireOwner, publicAdmin };
