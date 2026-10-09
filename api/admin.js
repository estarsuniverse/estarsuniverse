// Admin API: POST /api/admin { action, ...fields }
// Sign-in actions are open; everything else requires a named admin, completed MFA, and the right role.
const { handler, send, readBody, checkOrigin, UserError } = require("../lib/http");
const auth = require("../lib/adminauth");
const { ACTIONS } = require("../lib/admin");

const OPEN = {
  status: (req, res) => auth.status(req, res),
  setup: (req, res, b) => auth.setup(req, res, b),
  login: (req, res, b) => auth.login(req, res, b),
  "mfa-begin": (req, res) => auth.mfaBegin(req, res),
  "mfa-enable": (req, res, b) => auth.mfaEnable(req, res, b),
  "mfa-verify": (req, res, b) => auth.mfaVerify(req, res, b),
  logout: (req, res) => auth.logout(req, res),
  "invite-info": (req, res, b) => auth.inviteInfo(req, res, b),
  "invite-accept": (req, res, b) => auth.inviteAccept(req, res, b),
};

module.exports = handler(async (req, res) => {
  if (req.method !== "POST") throw new UserError("Not found.", 404);
  checkOrigin(req);
  const b = await readBody(req);
  const action = String(b.action || "");
  if (OPEN[action]) return OPEN[action](req, res, b);
  const entry = ACTIONS[action];
  if (!entry) throw new UserError("Unknown action.", 400);
  const actor = await auth.requireAdmin(req);
  if (entry[1]) auth.requireOwner(actor);
  const out = await entry[0](actor, b, req);
  send(res, 200, { ...out, me: auth.publicAdmin(actor) });
});
