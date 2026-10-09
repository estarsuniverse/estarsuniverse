// Hashing, tokens, encryption, and TOTP (authenticator app codes) using Node's crypto only.
const crypto = require("crypto");

function appSecret() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error("APP_SECRET must be set to a random string of at least 32 characters.");
  return s;
}

const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const hmac = (s) => crypto.createHmac("sha256", appSecret()).update(String(s)).digest("hex");
const token = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
const id = (prefix) => `${prefix}_${crypto.randomBytes(10).toString("base64url")}`;

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---- Passwords (scrypt) ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, s, k] = stored.split("$");
  const key = crypto.scryptSync(String(pw), Buffer.from(s, "base64"), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(k, "base64");
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}

// ---- Encryption at rest for TOTP secrets (AES-256-GCM) ----
function encKey() { return crypto.createHash("sha256").update("totp:" + appSecret()).digest(); }
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const data = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}
function decrypt(blob) {
  const [iv, tag, data] = String(blob).split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

// ---- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function hotp(secretB32, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}
function totpNow(secretB32, t = Date.now()) { return hotp(secretB32, Math.floor(t / 30000)); }
function verifyTotp(secretB32, code, t = Date.now()) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const step = Math.floor(t / 30000);
  for (const d of [-1, 0, 1]) if (safeEqual(hotp(secretB32, step + d), c)) return true;
  return false;
}
function newTotpSecret() { return base32Encode(crypto.randomBytes(20)); }

// ---- Signed values (form timing token, unsubscribe links) ----
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body).slice(0, 32)}`;
}
function unsign(tokenStr) {
  const [body, sig] = String(tokenStr || "").split(".");
  if (!body || !sig || !safeEqual(hmac(body).slice(0, 32), sig)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString("utf8")); } catch { return null; }
}

module.exports = { sha256, hmac, token, id, safeEqual, hashPassword, verifyPassword, encrypt, decrypt, newTotpSecret, verifyTotp, totpNow, sign, unsign };
