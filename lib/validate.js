const { UserError } = require("./http");

// Practical email check: one @, a dot in the domain, no spaces, sane length.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function normEmail(v) {
  const e = String(v || "").trim().toLowerCase();
  if (!e) throw new UserError("Please enter your email address.", 400, { field: "email" });
  if (e.length > 254 || !EMAIL_RE.test(e)) throw new UserError("Please check your email address. It should look like name@example.com.", 400, { field: "email" });
  return e;
}

function text(v, { max = 200, required = false, field, label = "This field" } = {}) {
  const s = String(v ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (required && !s) throw new UserError(`${label} is required.`, 400, { field });
  if (s.length > max) throw new UserError(`${label} is too long (${max} characters max).`, 400, { field });
  return s;
}

function cents(v, { allowNull = false, label = "Amount" } = {}) {
  if ((v === null || v === "" || v === undefined) && allowNull) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100000000) throw new UserError(`${label} must be a whole number of cents, zero or more.`);
  return n;
}

function intOrNull(v, { min = 0, max = 1000, label = "Value" } = {}) {
  if (v === null || v === "" || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

function oneOf(v, list, label = "Value") {
  if (!list.includes(v)) throw new UserError(`${label} is not valid.`);
  return v;
}

function dateOrNull(v, label = "Date") {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) throw new UserError(`${label} must be a valid date.`);
  return v;
}

// Allows only http(s) URLs or site-relative paths, for images and links set in admin.
function url(v, label = "Link") {
  const s = String(v || "").trim();
  if (!s) return "";
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch {}
  throw new UserError(`${label} must start with https://`);
}

module.exports = { normEmail, text, cents, intOrNull, oneOf, dateOrNull, url };
