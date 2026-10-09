// Admin area (single page). The server checks the session, MFA and role on every action;
// the hidden or disabled controls here are only a convenience.
(() => {
  const { esc, money, fmtDate, fmtDateTime } = EG;
  const app = document.getElementById("app");
  let ME = null;
  let TAB = "overview";
  const S = { unsaved: false };
  const isOwner = () => ME && ME.role === "owner";

  const TABS = [
    ["overview", "Overview"], ["waitlist", "Waiting List"], ["clients", "Clients"], ["rooms", "Rooms and Inventory"],
    ["bookings", "Bookings and Payments"], ["experience", "Client Experience"], ["content", "Content and Branding"],
    ["comms", "Communications"], ["settings", "Settings and Audit"],
  ];

  // ---------- helpers ----------
  async function call(action, body = {}) {
    try {
      const r = await EG.api("/api/admin", { action, ...body });
      if (r.me) ME = r.me;
      return r;
    } catch (e) {
      if (e.status === 401 && action !== "status") { S.unsaved = false; boot(); }
      throw e;
    }
  }
  let toastTimer;
  function toast(msg, err) {
    document.querySelectorAll(".toast").forEach((t) => t.remove());
    const t = document.createElement("div");
    t.className = `toast${err ? " err" : ""}`; t.setAttribute("role", err ? "alert" : "status"); t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), err ? 7000 : 3500);
  }
  const fail = (e) => toast(e.message, true);
  async function busy(btn, fn) {
    if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
    try { return await fn(); } catch (e) { fail(e); } finally { if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); } }
  }
  const getPath = (o, p) => p.split(".").reduce((x, k) => (x == null ? x : x[k]), o);
  function setPath(o, p, v) {
    const ks = p.split("."); let x = o;
    ks.slice(0, -1).forEach((k, i) => { if (x[k] == null) x[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; x = x[k]; });
    x[ks[ks.length - 1]] = v;
  }
  const uid = () => Math.random().toString(36).slice(2, 9);
  const dollars = (c) => (c == null ? "" : (c / 100).toFixed(2).replace(/\.00$/, ""));
  const toCents = (s) => { const t = String(s ?? "").replace(/[$,\s]/g, ""); if (t === "") return null; const n = Math.round(Number(t) * 100); return Number.isFinite(n) ? n : NaN; };
  const fileToB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
  function download(name, text) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function confirmBox(title, text, okLabel = "Confirm", danger) {
    return new Promise((resolve) => {
      const d = document.createElement("dialog");
      d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2><p>${esc(text)}</p><div class="row" style="justify-content:flex-end"><button class="btn btn-outline" value="no">Cancel</button><button class="btn ${danger ? "btn-danger" : "btn-primary"}" value="yes">${esc(okLabel)}</button></div></form>`;
      document.body.appendChild(d); d.showModal();
      d.addEventListener("close", () => { resolve(d.returnValue === "yes"); d.remove(); });
    });
  }
  function formDialog(title, fieldsHtml, okLabel = "Save") {
    return new Promise((resolve) => {
      const d = document.createElement("dialog");
      d.innerHTML = `<form method="dialog"><h2>${esc(title)}</h2>${fieldsHtml}<div class="row" style="justify-content:flex-end"><button class="btn btn-outline" value="no" formnovalidate>Cancel</button><button class="btn btn-primary" value="yes">${esc(okLabel)}</button></div></form>`;
      document.body.appendChild(d); d.showModal();
      d.addEventListener("close", () => {
        const out = d.returnValue === "yes" ? Object.fromEntries(new FormData(d.querySelector("form"))) : null;
        resolve(out); d.remove();
      });
    });
  }
  const tag = (txt, cls = "") => `<span class="tag ${cls}">${esc(txt)}</span>`;
  const ownerNote = () => (isOwner() ? "" : '<span class="owner-note"> (owner only)</span>');

  // ---------- auth screens ----------
  function authCard(inner) { app.innerHTML = `<div class="auth"><div class="auth-card">${inner}</div></div>`; }

  async function boot() {
    const inv = (location.hash.match(/invite=([\w-]+)/) || [])[1];
    if (inv) return inviteScreen(inv);
    let st;
    try { st = await call("status"); } catch (e) { return authCard(`<h1>Admin</h1><p class="form-error">${esc(e.message)}</p>`); }
    ME = st.admin || null;
    if (st.state === "setup") return setupScreen();
    if (st.state === "signed_out") return loginScreen();
    if (st.state === "mfa_enroll") return enrollScreen();
    if (st.state === "mfa_verify") return verifyScreen();
    shell();
  }

  function bindForm(id, fn) {
    const f = document.getElementById(id);
    f.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const err = f.querySelector(".form-error"); err.textContent = "";
      const btn = f.querySelector("button[type=submit]");
      btn.disabled = true;
      try { await fn(Object.fromEntries(new FormData(f)), f); } catch (e) { err.textContent = e.message; } finally { btn.disabled = false; }
    });
    const first = f.querySelector("input"); if (first) first.focus();
  }

  function setupScreen() {
    authCard(`<h1>Create the owner account</h1><p class="muted">This only appears once, before any admin exists. You’ll need the setup token from the Vercel environment variables.</p>
      <form id="f" novalidate>
        <label>Setup token<input type="password" name="setupToken" autocomplete="off" required></label>
        <label>Your name<input type="text" name="name" autocomplete="name" required></label>
        <label>Email<input type="email" name="email" autocomplete="email" required></label>
        <label>Password <span class="hint">(12+ characters)</span><input type="password" name="password" autocomplete="new-password" minlength="12" required></label>
        <label>Confirm password<input type="password" name="password2" autocomplete="new-password" required></label>
        <p class="form-error" role="alert"></p><button class="btn btn-primary" type="submit">Create owner account</button></form>`);
    bindForm("f", async (v) => {
      if (v.password !== v.password2) throw new Error("The passwords don’t match.");
      await call("setup", v); boot();
    });
  }

  function loginScreen() {
    authCard(`<h1>Admin sign in</h1><p class="muted">Embodied Godis Retreat</p>
      <form id="f" novalidate>
        <label>Email<input type="email" name="email" autocomplete="username" required></label>
        <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
        <p class="form-error" role="alert"></p><button class="btn btn-primary" type="submit">Continue</button></form>`);
    bindForm("f", async (v) => { await call("login", v); boot(); });
  }

  async function enrollScreen() {
    authCard(`<h1>Set up two-step sign-in</h1><p class="muted">Loading…</p>`);
    let r;
    try { r = await call("mfa-begin"); } catch (e) { return authCard(`<h1>Two-step sign-in</h1><p class="form-error">${esc(e.message)}</p>`); }
    authCard(`<h1>Set up two-step sign-in</h1>
      <p class="muted">Every admin uses an authenticator app (Google Authenticator, 1Password, Authy, or similar). Scan this code, then enter the 6-digit number it shows.</p>
      <div class="qr">${r.qr}</div>
      <p class="small muted" style="margin:10px 0 4px">Can’t scan? Enter this key in the app:</p><p class="secret">${esc(r.secret)}</p>
      <form id="f" novalidate><label>6-digit code<input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label>
      <p class="form-error" role="alert"></p><button class="btn btn-primary" type="submit">Turn on and continue</button></form>`);
    bindForm("f", async (v) => { await call("mfa-enable", v); boot(); });
  }

  function verifyScreen() {
    authCard(`<h1>Two-step sign-in</h1><p class="muted">Enter the 6-digit code from your authenticator app.</p>
      <form id="f" novalidate><label>Code<input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label>
      <p class="form-error" role="alert"></p><button class="btn btn-primary" type="submit">Sign in</button>
      <button class="linkish" type="button" id="other">Sign in as someone else</button></form>`);
    bindForm("f", async (v) => { await call("mfa-verify", v); boot(); });
    document.getElementById("other").onclick = async () => { await call("logout"); boot(); };
  }

  async function inviteScreen(tok) {
    let info;
    try { info = await call("invite-info", { token: tok }); } catch (e) { history.replaceState(null, "", "/admin/"); return authCard(`<h1>Invitation</h1><p class="form-error">${esc(e.message)}</p><p><a href="/admin/">Go to sign in</a></p>`); }
    authCard(`<h1>Welcome, ${esc(info.name)}</h1><p class="muted">Choose a password for ${esc(info.email)}. Next you’ll set up two-step sign-in.</p>
      <form id="f" novalidate><label>Password <span class="hint">(12+ characters)</span><input type="password" name="password" autocomplete="new-password" required></label>
      <label>Confirm password<input type="password" name="password2" autocomplete="new-password" required></label>
      <p class="form-error" role="alert"></p><button class="btn btn-primary" type="submit">Continue</button></form>`);
    bindForm("f", async (v) => {
      if (v.password !== v.password2) throw new Error("The passwords don’t match.");
      await call("invite-accept", { token: tok, password: v.password });
      history.replaceState(null, "", "/admin/"); boot();
    });
  }

  // ---------- shell ----------
  function shell() {
    app.innerHTML = `<div class="shell">
      <aside class="side on-dark"><div class="brand"><span>Embodied Godis Admin</span><button id="mobile-signout" type="button">Sign out</button></div><div class="sub">Empowered Wombman</div>
        <nav aria-label="Admin sections">${TABS.map(([id, l]) => `<button type="button" data-tab="${id}">${l}</button>`).join("")}</nav>
        <div class="me">${esc(ME.name)} · ${esc(ME.role)}<br><a href="/" target="_blank" rel="noopener" style="color:var(--bg)">View site</a> · <button class="linkish" id="signout" type="button">Sign out</button></div>
      </aside><main id="view" tabindex="-1"></main></div>`;
    app.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
    const so = async () => { await call("logout").catch(() => {}); ME = null; boot(); };
    document.getElementById("signout").onclick = so;
    document.getElementById("mobile-signout").onclick = so;
    const want = location.hash.slice(1);
    go(TABS.some((t) => t[0] === want) ? want : "overview", true);
  }

  async function go(tab, initial) {
    if (S.unsaved && !initial && !(await confirmBox("Leave without saving?", "You have unsaved changes on this tab.", "Leave", true))) return;
    S.unsaved = false;
    TAB = tab;
    history.replaceState(null, "", `#${tab}`);
    app.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false"));
    const v = document.getElementById("view");
    v.innerHTML = '<p class="muted">Loading…</p>';
    try { await VIEWS[tab](v); } catch (e) { v.innerHTML = `<div class="alert" role="alert">${esc(e.message)}</div>`; }
    if (!initial) v.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  const head = (title, sub, actions = "") => `<div class="head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="row">${actions}</div></div>`;
  window.addEventListener("beforeunload", (e) => { if (S.unsaved) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- Overview ----------
  async function vOverview(v) {
    const d = await call("overview");
    const w = d.waitlist, m = d.money;
    const t = (n, l, s = "") => `<div class="tile"><div class="l">${l}</div><div class="n">${n}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
    const c = d.checklist;
    v.innerHTML = head("Overview", esc(d.retreat.name), `<a class="btn btn-outline" href="/" target="_blank" rel="noopener">View public page</a>`)
      + (d.mail.failed ? `<div class="alert">${d.mail.failed} email${d.mail.failed === 1 ? "" : "s"} failed to send. <button class="linkish" data-go="comms">Review in Communications</button></div>` : "")
      + `<div class="tiles">
        ${t(w.total || 0, "Waiting list", `${w.week || 0} joined in the last 7 days`)}
        ${t(w.consented || 0, "Marketing opt-ins", "Agreed to updates and offerings")}
        ${t(w.activated || 0, "Portal activated", "Verified their email")}
        ${t(d.bookings.confirmed || 0, "Confirmed guests", `${d.bookings.pending || 0} pending`)}
        ${t(`${d.conversion}%`, "Conversion", "Confirmed bookings ÷ waiting list")}
        ${t(`${d.occupancy.sold} / ${d.occupancy.units}`, "Occupancy", "Units sold of units for sale")}
        ${t(money(m.collected, { cents: true }), "Collected payments", m.refunded ? `${money(m.refunded, { cents: true })} refunded` : "Net of refunds")}
        ${t(money(m.outstanding, { cents: true }), "Outstanding balances", m.overdue ? `${money(m.overdue, { cents: true })} overdue` : "Scheduled, not yet paid")}
      </div>
      <p class="small muted" style="margin-top:-12px">Collected payments are cash received, including deposits. They are tracked separately from earned revenue, which is recognized when the retreat takes place.</p>
      <div class="grid2">
        <div class="panel"><h2>Room interest</h2>${d.prefs.length ? `<ul class="checklist">${d.prefs.map((p) => `<li><span>${p.n}</span><span>${esc(p.room)}</span></li>`).join("")}</ul>` : '<p class="muted">No sign-ups yet.</p>'}</div>
        <div class="panel"><h2>Launch checklist</h2><p class="small muted">Paid reservations stay closed until every item is complete.</p>${checklistHtml(c)}</div>
      </div>`;
    v.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
  }
  const checklistHtml = (c) => `<ul class="checklist">${c.items.map((i) => `<li><span class="${i.ok ? "ok" : "no"}" aria-label="${i.ok ? "Done" : "Not done"}">${i.ok ? "✓" : "✕"}</span><span>${esc(i.label)}${i.detail ? `<br><small class="muted">${esc(i.detail)}</small>` : ""}</span></li>`).join("")}</ul>`;

  // ---------- Waiting list ----------
  S.wl = { search: "", room: "", consent: "", status: "", source: "" };
  async function vWaitlist(v) {
    const d = await call("waitlist-list", S.wl);
    const roomName = (id) => id === "any" ? "Any room" : !id || id === "undecided" ? "Not sure yet" : (d.rooms.find((r) => r.id === id) || {}).name || id;
    v.innerHTML = head("Waiting List", `${d.rows.length} ${d.rows.length === 1 ? "person" : "people"} shown`,
      `<button class="btn btn-outline" id="csv-all">Export CSV</button><button class="btn btn-outline" id="csv-mkt">Export marketing list</button>`)
      + `<p class="small muted">Exports include name, email, room preference, consent, source, tags and status. Intentions and staff notes are never exported. The marketing list only includes people who opted in.</p>
      <div class="filters" role="search">
        <input type="search" id="f-search" placeholder="Search name or email" value="${esc(S.wl.search)}" aria-label="Search name or email">
        <select id="f-room" aria-label="Room preference"><option value="">All rooms</option><option value="any">Any room</option><option value="undecided">Not sure yet</option>${d.rooms.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select>
        <select id="f-consent" aria-label="Marketing consent"><option value="">Any consent</option><option value="yes">Opted in</option><option value="no">Not opted in</option></select>
        <select id="f-status" aria-label="Status"><option value="">Active</option><option value="waiting">Waiting</option><option value="invited">Invited</option><option value="converted">Converted</option><option value="removed">Removed</option></select>
        <select id="f-source" aria-label="Source"><option value="">All sources</option>${d.sources.map((s) => `<option>${esc(s)}</option>`).join("")}</select>
      </div>
      <div class="table-wrap">${d.rows.length ? `<table><thead><tr><th>Joined</th><th>Name</th><th>Room preference</th><th>Marketing</th><th>Source</th><th>Portal</th><th>Status</th><th></th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr><td>${fmtDate(r.created_at)}</td><td><span class="name">${esc(r.name)}</span><small>${esc(r.email_display)}</small>${r.intention ? `<small>“${esc(r.intention.slice(0, 90))}${r.intention.length > 90 ? "…" : ""}”</small>` : ""}</td>
          <td>${esc(roomName(r.room_pref))}</td><td>${r.marketing_consent ? tag("Opted in", "ok") : tag("No")}<small>${esc(r.consent_version)}</small></td>
          <td>${esc(r.source || "")}${r.tags && Object.keys(r.tags).length ? `<small>${esc(Object.entries(r.tags).map(([k, x]) => `${k}=${x}`).join(", "))}</small>` : ""}</td>
          <td>${r.activated ? tag("Verified", "ok") : tag("Not yet")}</td><td>${esc(r.status)}${r.notes ? `<small>Note: ${esc(r.notes.slice(0, 60))}</small>` : ""}</td>
          <td><button class="iconbtn" data-edit="${esc(r.id)}">Edit</button></td></tr>`).join("")}</tbody></table>` : '<div class="empty">No one matches these filters yet.</div>'}</div>`;
    ["room", "consent", "status", "source"].forEach((k) => { const el = document.getElementById(`f-${k}`); el.value = S.wl[k]; el.onchange = () => { S.wl[k] = el.value; vWaitlist(v); }; });
    const sEl = document.getElementById("f-search"); let tmr;
    sEl.oninput = () => { clearTimeout(tmr); tmr = setTimeout(() => { S.wl.search = sEl.value; vWaitlist(v).then(() => { const n = document.getElementById("f-search"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 350); };
    document.getElementById("csv-all").onclick = (e) => busy(e.target, async () => { const r = await call("waitlist-csv", { ...S.wl, kind: "all" }); download(r.filename, r.csv); });
    document.getElementById("csv-mkt").onclick = (e) => busy(e.target, async () => { const r = await call("waitlist-csv", { ...S.wl, kind: "marketing" }); download(r.filename, r.csv); });
    v.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = async () => {
      const r = d.rows.find((x) => x.id === b.dataset.edit);
      const out = await formDialog(`Edit ${r.name}`, `${r.intention ? `<p class="small"><strong>Intention:</strong> ${esc(r.intention)}</p>` : ""}
        <label>Status<select name="status">${["waiting", "invited", "converted", "removed"].map((s) => `<option ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
        <label>Staff notes <span class="hint">(internal, never exported)</span><textarea name="notes" maxlength="2000">${esc(r.notes || "")}</textarea></label>`);
      if (!out) return;
      await busy(null, async () => { await call("waitlist-update", { id: r.id, ...out }); toast("Saved."); vWaitlist(v); });
    }));
  }

  // ---------- Clients ----------
  async function vClients(v) {
    const d = await call("clients-list");
    v.innerHTML = head("Clients", "Everyone on the waiting list or with a verified portal account.")
      + `<div class="table-wrap">${d.rows.length ? `<table><thead><tr><th>Name</th><th>Portal account</th><th>Waiting list</th><th>Booking</th><th>Last sign-in</th><th></th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr><td><span class="name">${esc(r.name || "")}</span><small>${esc(r.email)}</small></td>
          <td>${r.verified_at ? `${tag("Activated", "ok")}<small>${fmtDate(r.verified_at)}</small>` : tag("Not activated")}</td>
          <td>${r.lead_status ? esc(r.lead_status) : '<span class="muted">Not on list</span>'}${r.joined_at ? `<small>${fmtDate(r.joined_at)}</small>` : ""}</td>
          <td>${r.booking_status ? esc(r.booking_status) : '<span class="muted">None</span>'}</td>
          <td>${r.last_login_at ? fmtDateTime(r.last_login_at) : '<span class="muted">Never</span>'}</td>
          <td><div class="row"><button class="iconbtn" data-invite="${esc(r.email)}">${r.verified_at ? "Resend portal link" : "Send portal invitation"}</button>${isOwner() ? `<button class="iconbtn" data-email="${esc(r.email)}">Change email</button>` : ""}</div></td></tr>`).join("")}
        </tbody></table>` : '<div class="empty">No clients yet.</div>'}</div>
        <p class="small muted">A portal invitation asks the guest to sign in with her email and a one-time code. Name and email alone never unlock personal details.</p>`;
    v.querySelectorAll("[data-invite]").forEach((b) => (b.onclick = () => busy(b, async () => { await call("client-invite", { email: b.dataset.invite }); toast("Invitation sent."); })));
    v.querySelectorAll("[data-email]").forEach((b) => (b.onclick = async () => {
      const out = await formDialog("Change client email", `<p class="small">Only change an email after confirming the request with the guest from her current address. She will be signed out everywhere.</p>
        <label>Current email<input type="email" name="from" value="${esc(b.dataset.email)}" readonly></label>
        <label>New email<input type="email" name="to" required></label><label>Reason<input type="text" name="reason" maxlength="300" placeholder="For example: requested by phone on Oct 9, confirmed by reply"></label>`, "Change email");
      if (!out) return;
      await busy(null, async () => { await call("client-email-change", out); toast("Email changed."); vClients(v); });
    }));
  }

  // ---------- Rooms ----------
  async function vRooms(v) {
    const d = await call("rooms-list");
    S.rooms = d.rooms;
    S.roomPhotos = {};
    d.rooms.forEach((r) => (S.roomPhotos[r.id] = (r.photos || []).map((p) => ({ ...p }))));
    v.innerHTML = head("Rooms and Inventory", "Prices, price basis, real inventory and room details. Changes to prices and inventory are recorded in the change history.",
      isOwner() ? '<button class="btn btn-primary" id="add-room">Add a room</button>' : "")
      + `<div class="okbox small">Prices are stored exactly as entered. While a room’s price basis is “to be confirmed,” paid checkout stays off. Occupancy labels are shown to guests but never used to calculate capacity or revenue; set “Guest capacity” once confirmed.</div>
      <div id="new-room"></div>${d.rooms.map((r) => roomForm(r, d.basisLabels)).join("")}`;
    wireRoomForms(v, d.basisLabels);
    const add = document.getElementById("add-room");
    if (add) add.onclick = () => {
      const blank = { id: "", name: "", sort: (d.rooms.length + 1) * 10, price_cents: 0, price_basis: "unconfirmed", includes_admission: "unconfirmed", photos: [], visible: false, units: [] };
      S.roomPhotos[""] = [];
      document.getElementById("new-room").innerHTML = roomForm(blank, d.basisLabels, true);
      wireRoomForms(v, d.basisLabels);
      add.disabled = true;
    };
  }

  function roomForm(r, basis, isNew) {
    const own = isOwner() ? "" : "disabled";
    const ready = !r.id ? "" : [r.price_basis !== "unconfirmed", r.includes_admission !== "unconfirmed", r.guest_capacity, r.beds, r.inventory_confirmed, (r.photos || []).length].every(Boolean);
    const sel = (name, opts, val, dis) => `<select name="${name}" ${dis}>${opts.map(([k, l]) => `<option value="${k}" ${k === val ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const txt = (name, label, val, opts = {}) => `<label class="${opts.wide ? "wide" : ""}">${label}${opts.hint ? ` <span class="hint">${opts.hint}</span>` : ""}${opts.area ? `<textarea name="${name}" maxlength="${opts.max || 600}" ${opts.dis || ""}>${esc(val || "")}</textarea>` : `<input type="text" name="${name}" value="${esc(val || "")}" maxlength="${opts.max || 300}" ${opts.dis || ""}>`}</label>`;
    return `<details class="panel room-card" ${isNew ? "open" : ""} data-room="${esc(r.id)}">
      <summary><span><span class="title">${esc(r.name || "New room")}</span> ${r.id ? `<span class="muted">${money(r.price_cents)}</span>` : ""}</span>
        <span class="row">${r.id ? `${r.price_basis === "unconfirmed" ? tag("Basis to confirm", "warn") : tag(basis[r.price_basis], "ok")} ${ready ? tag("Ready to sell", "ok") : tag("Details needed", "warn")} ${r.visible ? "" : tag("Hidden")} ${tag(`${r.waitlist_interest || 0} interested`)}` : ""}</span></summary>
      <form class="form" novalidate>
        <div class="fgrid">
          ${txt("name", "Room name", r.name, { max: 80 })}
          <label>Price${ownerNote()}<div class="money">$<input type="text" name="price" inputmode="decimal" value="${dollars(r.price_cents)}" ${own}></div></label>
          <label>Price basis${ownerNote()}${sel("price_basis", Object.entries(basis).map(([k, l]) => [k, k === "unconfirmed" ? "To be confirmed" : l]), r.price_basis, own)}</label>
          <label>Includes retreat admission?${ownerNote()}${sel("includes_admission", [["unconfirmed", "To be confirmed"], ["yes", "Yes"], ["no", "No, sold separately"]], r.includes_admission, own)}</label>
          ${txt("occupancy_label", "Occupancy (shown to guests)", r.occupancy_label, { hint: "e.g. Double occupancy" })}
          <label>Guest capacity${ownerNote()} <span class="hint">(blank = to confirm)</span><input type="number" name="guest_capacity" min="1" max="20" value="${r.guest_capacity ?? ""}" ${own}></label>
          ${txt("beds", "Actual beds", r.beds, { hint: "e.g. One queen bed" })}
          ${txt("bathroom", "Bathroom access", r.bathroom, { hint: "e.g. Private en suite" })}
          ${txt("privacy", "Privacy", r.privacy, { hint: "e.g. Lockable door" })}
          ${txt("features", "Features", r.features)}
          <label>Display order<input type="number" name="sort" value="${r.sort ?? 0}" min="0" max="10000"></label>
          ${txt("accessibility", "Accessibility details", r.accessibility, { wide: true, area: true })}
          ${txt("difference_note", "What makes this room different", r.difference_note, { wide: true, area: true, hint: "Needed when two rooms look the same but are priced differently (for example Emerald and Obsidian)" })}
          ${txt("description", "Description", r.description, { wide: true, area: true, max: 2000 })}
        </div>
        <div><h3>Photos</h3><p class="small muted">Use real, approved photos of this room. Add a short description of each photo for screen readers.</p>
          <div class="thumbs" data-thumbs></div>
          <label class="iconbtn" style="display:inline-flex;margin-top:10px">Upload photo<input type="file" accept="image/jpeg,image/png,image/webp" data-photo-up class="sr-only"></label></div>
        <div class="row"><label class="check"><input type="checkbox" name="visible" ${r.visible ? "checked" : ""}> Show on the public page</label>
          <label class="check"><input type="checkbox" name="inventory_confirmed" ${r.inventory_confirmed ? "checked" : ""} ${own}> Inventory confirmed${ownerNote()}</label></div>
        ${r.id ? `<div class="units"><h3>Inventory units</h3><p class="small muted">Each unit is one sellable room or bed space. Add one per real unit; sold units are managed by their booking.</p>
          <div class="table-wrap"><table><thead><tr><th>Unit</th><th>Status</th><th></th></tr></thead><tbody>
          ${r.units.map((u) => `<tr data-unit="${esc(u.id)}"><td><input type="text" value="${esc(u.label)}" data-ulabel ${own} aria-label="Unit name"></td><td>${u.status === "sold" ? "Sold" : `<select data-ustatus ${own} aria-label="Unit status"><option value="available" ${u.status === "available" ? "selected" : ""}>Available</option><option value="blocked" ${u.status === "blocked" ? "selected" : ""}>Blocked (not for sale)</option></select>`}${u.held ? " <small>On hold</small>" : ""}</td>
            <td>${isOwner() && u.status !== "sold" ? '<div class="row"><button type="button" class="iconbtn" data-usave>Save</button><button type="button" class="iconbtn" data-udel>Remove</button></div>' : ""}</td></tr>`).join("")}
          </tbody></table></div>${isOwner() ? '<button type="button" class="iconbtn" data-uadd style="margin-top:8px">Add unit</button>' : ""}</div>` : ""}
        <div class="row" style="justify-content:space-between"><button class="btn btn-primary" type="submit">${r.id ? "Save room" : "Create room"}</button>${r.id && isOwner() ? '<button class="btn btn-danger" type="button" data-rdel>Delete room</button>' : ""}</div>
      </form></details>`;
  }

  function renderThumbs(card) {
    const id = card.dataset.room;
    const list = S.roomPhotos[id] || [];
    card.querySelector("[data-thumbs]").innerHTML = list.length ? list.map((p, i) => `<div class="thumb"><img src="${esc(p.url)}" alt="${esc(p.alt || "")}"><input type="text" value="${esc(p.alt || "")}" placeholder="Describe this photo" data-alt="${i}" aria-label="Photo ${i + 1} description"><div class="row">${i ? `<button type="button" class="iconbtn" data-left="${i}">Move first</button>` : '<span class="small muted">Main photo</span>'}<button type="button" class="iconbtn" data-prm="${i}">Remove</button></div></div>`).join("") : '<p class="small muted">No photos yet.</p>';
    card.querySelectorAll("[data-alt]").forEach((inp) => (inp.oninput = () => { list[+inp.dataset.alt].alt = inp.value; S.unsaved = true; }));
    card.querySelectorAll("[data-left]").forEach((b) => (b.onclick = () => { const [x] = list.splice(+b.dataset.left, 1); list.unshift(x); S.unsaved = true; renderThumbs(card); }));
    card.querySelectorAll("[data-prm]").forEach((b) => (b.onclick = () => { list.splice(+b.dataset.prm, 1); S.unsaved = true; renderThumbs(card); }));
  }

  function wireRoomForms(v, basis) {
    v.querySelectorAll(".room-card").forEach((card) => {
      if (card.dataset.wired) return; card.dataset.wired = "1";
      const id = card.dataset.room;
      const f = card.querySelector("form");
      renderThumbs(card);
      f.addEventListener("input", () => (S.unsaved = true));
      card.querySelector("[data-photo-up]").onchange = async (e) => {
        const file = e.target.files[0]; e.target.value = "";
        if (!file) return;
        await busy(null, async () => {
          const r = await call("upload", { contentType: file.type, dataBase64: await fileToB64(file) });
          S.roomPhotos[id].push({ url: r.url, alt: "" }); S.unsaved = true; renderThumbs(card); toast("Photo uploaded. Remember to save the room.");
        });
      };
      f.onsubmit = (ev) => {
        ev.preventDefault();
        const fd = new FormData(f);
        const room = S.rooms.find((x) => x.id === id) || {};
        const price = isOwner() ? toCents(fd.get("price")) : room.price_cents;
        if (price == null || Number.isNaN(price)) return toast("Enter a valid price.", true);
        const body = {
          id: id || undefined, name: fd.get("name"), sort: fd.get("sort"), price_cents: price,
          price_basis: isOwner() ? fd.get("price_basis") : room.price_basis, includes_admission: isOwner() ? fd.get("includes_admission") : room.includes_admission,
          occupancy_label: fd.get("occupancy_label"), guest_capacity: isOwner() ? fd.get("guest_capacity") : room.guest_capacity,
          beds: fd.get("beds"), bathroom: fd.get("bathroom"), privacy: fd.get("privacy"), features: fd.get("features"), accessibility: fd.get("accessibility"),
          difference_note: fd.get("difference_note"), description: fd.get("description"), photos: S.roomPhotos[id],
          visible: f.visible.checked, inventory_confirmed: isOwner() ? f.inventory_confirmed.checked : Boolean(room.inventory_confirmed),
        };
        busy(f.querySelector("button[type=submit]"), async () => { await call("room-save", body); S.unsaved = false; toast("Room saved."); vRooms(v); });
      };
      const del = card.querySelector("[data-rdel]");
      if (del) del.onclick = async () => { if (await confirmBox("Delete this room?", "This removes the room and its inventory. Rooms with bookings can’t be deleted; hide them instead.", "Delete", true)) busy(del, async () => { await call("room-delete", { id }); toast("Room deleted."); vRooms(v); }); };
      card.querySelectorAll("[data-unit]").forEach((tr) => {
        const uid_ = tr.dataset.unit;
        const save = tr.querySelector("[data-usave]"), rm = tr.querySelector("[data-udel]");
        if (save) save.onclick = () => busy(save, async () => { await call("unit-save", { id: uid_, label: tr.querySelector("[data-ulabel]").value, status: tr.querySelector("[data-ustatus]").value }); toast("Unit saved."); });
        if (rm) rm.onclick = async () => { if (await confirmBox("Remove this unit?", "It will no longer be available to sell.", "Remove", true)) busy(rm, async () => { await call("unit-delete", { id: uid_ }); vRooms(v); }); };
      });
      const addU = card.querySelector("[data-uadd]");
      if (addU) addU.onclick = async () => {
        const out = await formDialog("Add an inventory unit", `<label>Unit name<input type="text" name="label" required maxlength="80" placeholder="For example: Sapphire, or Moonstone bed 2"></label>`, "Add unit");
        if (out) busy(addU, async () => { await call("unit-save", { room_type_id: id, label: out.label, status: "available" }); vRooms(v); });
      };
    });
  }

  // ---------- Bookings and payments ----------
  async function vBookings(v) {
    const [rg, bl] = await Promise.all([call("retreat-get"), call("bookings-list")]);
    const r = rg.retreat, t = r.terms || {}, c = rg.checklist, own = isOwner() ? "" : "disabled";
    S.inst = (t.installments || []).map((x) => ({ ...x }));
    const ta = (name, label, hint) => `<label class="wide">${label}${hint ? ` <span class="hint">${hint}</span>` : ""}<textarea name="${name}" maxlength="4000" ${own}>${esc(t[name] || "")}</textarea></label>`;
    v.innerHTML = head("Bookings and Payments", "Reservation status, payment terms and reconciliation.")
      + `<div class="panel"><h2>Reservations are ${r.reservations_open ? "open" : "closed"}</h2>
          <p class="small muted">Lead status, account activation, booking status and payment status are tracked separately. A verified email is not a reservation, a checkout redirect is not proof of payment, and a room preference is not a hold. A booking is confirmed only by a verified payment event or an audited manual confirmation.</p>
          ${checklistHtml(c)}
          ${isOwner() ? `<div class="row" style="margin-top:12px"><button class="btn ${r.reservations_open ? "btn-danger" : "btn-primary"}" id="toggle-res" ${!r.reservations_open && !c.ready ? "disabled" : ""}>${r.reservations_open ? "Close reservations" : "Open reservations"}</button>${!c.ready ? '<span class="small muted">Complete the checklist to enable.</span>' : ""}</div>` : ""}</div>
        <div class="panel"><h2>Payment terms${ownerNote()}</h2><p class="small muted">Shown on the public page once confirmed. Bookings keep the terms they were sold with; editing these never changes an existing booking.</p>
          <form class="form" id="terms-form" novalidate><div class="fgrid">
            <label>Deposit amount<div class="money">$<input type="text" name="deposit" inputmode="decimal" value="${dollars(t.deposit_cents)}" ${own}></div></label>
            ${ta("deposit_text", "Deposit terms")}
            ${ta("fees_text", "Fees", "Any processing or service fees")}
            ${ta("taxes_text", "Taxes")}
            ${ta("installments_text", "Payment schedule (shown to guests)")}
            <div class="wide"><h3>Installments</h3><div id="inst"></div>${isOwner() ? '<button type="button" class="iconbtn" id="inst-add">Add installment</button>' : ""}
              <p class="small muted">Automatic future charges need the guest’s explicit authorization and arrive with checkout in Phase 2.</p></div>
            ${ta("cancellation_text", "Cancellation terms")}
            ${ta("transfer_text", "Transfer terms")}
            ${ta("refund_text", "Refund terms")}
          </div>
          <label class="check"><input type="checkbox" name="terms_confirmed" ${r.terms_confirmed ? "checked" : ""} ${own}> These payment terms are approved</label>
          <label class="check"><input type="checkbox" name="legal_confirmed" ${r.legal_confirmed ? "checked" : ""} ${own}> The agreement and policy text from the attorney is in place and approved</label>
          ${isOwner() ? '<div><button class="btn btn-primary" type="submit">Save payment terms</button></div>' : ""}</form></div>
        <div class="panel"><h2>Bookings</h2>${bl.rows.length ? `<div class="table-wrap"><table><thead><tr><th>Guest</th><th>Room</th><th>Status</th><th>Total</th><th>Confirmed by</th></tr></thead><tbody>${bl.rows.map((b) => `<tr><td><span class="name">${esc(b.name || "")}</span><small>${esc(b.email)}</small></td><td>${esc(b.room || "")}</td><td>${esc(b.status)}</td><td>${money(b.total_cents, { cents: true })}</td><td>${esc(b.confirmed_by || "")}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">No bookings yet. Paid reservations arrive in Phase 2, after the checklist above is complete.</p>'}</div>
        <div class="panel"><h2>Needs review</h2>${bl.review.length ? `<ul>${bl.review.map((x) => `<li>${esc(x.provider)} ${esc(x.provider_ref)}: ${money(x.amount_cents, { cents: true })}</li>`).join("")}</ul>` : '<p class="muted">Nothing to reconcile. Payments that can’t be matched to a booking will appear here instead of overselling a room.</p>'}</div>`;
    renderInst();
    const add = document.getElementById("inst-add");
    if (add) add.onclick = () => { S.inst.push({ label: "", amount_cents: null, percent: null, due_date: "" }); renderInst(); };
    const tog = document.getElementById("toggle-res");
    if (tog) tog.onclick = async () => {
      const open = !r.reservations_open;
      if (await confirmBox(open ? "Open reservations?" : "Close reservations?", open ? "Guests will be able to reserve rooms." : "Guests will no longer be able to start new reservations.", open ? "Open" : "Close", !open))
        busy(tog, async () => { await call("reservations-toggle", { open }); vBookings(v); });
    };
    const f = document.getElementById("terms-form");
    f.addEventListener("input", () => (S.unsaved = true));
    f.onsubmit = (ev) => {
      ev.preventDefault();
      const fd = new FormData(f);
      const dep = toCents(fd.get("deposit"));
      if (Number.isNaN(dep)) return toast("Enter a valid deposit amount.", true);
      const body = { deposit_cents: dep, installments: S.inst.map((i) => ({ ...i })), terms_confirmed: f.terms_confirmed.checked, legal_confirmed: f.legal_confirmed.checked };
      ["deposit_text", "fees_text", "taxes_text", "installments_text", "cancellation_text", "transfer_text", "refund_text"].forEach((k) => (body[k] = fd.get(k)));
      busy(f.querySelector("button[type=submit]"), async () => { await call("terms-save", body); S.unsaved = false; toast("Payment terms saved."); vBookings(v); });
    };
  }
  function renderInst() {
    const box = document.getElementById("inst"); if (!box) return;
    const own = isOwner() ? "" : "disabled";
    box.innerHTML = S.inst.length ? S.inst.map((i, n) => `<div class="fgrid" style="margin-bottom:8px" data-i="${n}">
      <label>Name<input type="text" data-k="label" value="${esc(i.label)}" ${own}></label>
      <label>Amount<div class="money">$<input type="text" data-k="amount" inputmode="decimal" value="${dollars(i.amount_cents)}" ${own}></div></label>
      <label>Or percent<input type="number" data-k="percent" min="0" max="100" value="${i.percent ?? ""}" ${own}></label>
      <label>Due date<input type="date" data-k="due_date" value="${esc(i.due_date || "")}" ${own}></label>
      ${isOwner() ? `<div style="align-self:end"><button type="button" class="iconbtn" data-irm="${n}">Remove</button></div>` : ""}</div>`).join("") : '<p class="small muted">No installments yet.</p>';
    box.querySelectorAll("[data-i]").forEach((row) => row.querySelectorAll("[data-k]").forEach((inp) => (inp.oninput = () => {
      const it = S.inst[+row.dataset.i], k = inp.dataset.k;
      if (k === "amount") it.amount_cents = toCents(inp.value); else if (k === "percent") it.percent = inp.value === "" ? null : Number(inp.value); else it[k] = inp.value;
    })));
    box.querySelectorAll("[data-irm]").forEach((b) => (b.onclick = () => { S.inst.splice(+b.dataset.irm, 1); renderInst(); }));
  }

  // ---------- Content editing (shared by Client Experience and Content and Branding) ----------
  const F = {
    text: (p, label, o = {}) => `<label class="${o.wide ? "wide" : ""}">${label}${o.hint ? ` <span class="hint">${o.hint}</span>` : ""}${o.area
      ? `<textarea data-path="${p}" rows="${o.rows || 3}" ${o.dis || ""}>${esc(getPath(S.draft, p) ?? "")}</textarea>`
      : `<input type="${o.type || "text"}" data-path="${p}" value="${esc(getPath(S.draft, p) ?? "")}" ${o.dis || ""}>`}</label>`,
    lines: (p, label, hint) => `<label class="wide">${label} <span class="hint">${hint || "One per line"}</span><textarea data-path="${p}" data-kind="lines" rows="4">${esc((getPath(S.draft, p) || []).join("\n"))}</textarea></label>`,
    bool: (p, label, o = {}) => `<label class="check"><input type="checkbox" data-path="${p}" data-kind="bool" ${getPath(S.draft, p) ? "checked" : ""} ${o.dis || ""}> ${label}</label>`,
    image: (p, label, hint) => { const u = getPath(S.draft, p); return `<div class="wide"><label>${label}${hint ? ` <span class="hint">${hint}</span>` : ""}</label><div class="imgfield">${u ? `<img src="${esc(u)}" alt="">` : '<span class="small muted">None yet</span>'}<input type="hidden" data-path="${p}" value="${esc(u || "")}"><label class="iconbtn">Upload<input type="file" class="sr-only" accept="image/jpeg,image/png,image/webp" data-upload="${p}"></label>${u ? `<button type="button" class="iconbtn" data-clear="${p}">Remove</button>` : ""}</div></div>`; },
  };
  function repeat(p, title, itemFn, blank, addLabel = "Add") {
    const list = getPath(S.draft, p) || [];
    return `<div class="repeat wide"><div class="repeat-head"><h3>${title}</h3><button type="button" class="iconbtn" data-add="${p}" data-blank='${esc(JSON.stringify(blank))}'>${addLabel}</button></div>
      <div class="repeat-list">${list.map((it, i) => `<div class="repeat"><div class="fgrid">${itemFn(`${p}.${i}`, it, i)}</div><div class="row">${i ? `<button type="button" class="iconbtn" data-up="${p}.${i}">Move up</button>` : ""}<button type="button" class="iconbtn" data-del="${p}.${i}">Remove</button></div></div>`).join("") || '<p class="small muted">None yet.</p>'}</div></div>`;
  }
  function sync(root) {
    root.querySelectorAll("[data-path]").forEach((el) => {
      const k = el.dataset.kind;
      const val = k === "bool" ? el.checked : k === "lines" ? el.value.split("\n").map((x) => x.trim()).filter(Boolean) : el.value;
      setPath(S.draft, el.dataset.path, val);
    });
  }
  async function loadContent() { S.content = await call("content-get"); S.draft = JSON.parse(JSON.stringify(S.content.draft)); }
  function pubbar() {
    const c = S.content;
    return `<div class="pubbar"><span class="state"><span class="dot ${c.dirty ? "dirty" : ""}"></span>${c.dirty ? `Draft has unpublished changes (saved ${fmtDateTime(c.draft_updated_at)}${c.draft_updated_by ? ` by ${esc(c.draft_updated_by)}` : ""})` : `Published ${fmtDateTime(c.published_at)}${c.published_by ? ` by ${esc(c.published_by)}` : ""}`}</span>
      <span class="row"><button class="btn btn-outline" data-act="save">Save draft</button><button class="btn btn-outline" data-act="preview">Preview</button><button class="btn btn-primary" data-act="publish">Publish</button>${c.dirty ? '<button class="iconbtn" data-act="discard">Discard draft</button>' : ""}</span></div>`;
  }
  function wireContent(v, rerender) {
    v.addEventListener("input", () => (S.unsaved = true));
    const save = async () => { sync(v); await call("content-save", { draft: S.draft }); S.unsaved = false; await loadContent(); };
    v.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => busy(b, async () => {
      const a = b.dataset.act;
      if (a === "save") { await save(); toast("Draft saved. Nothing is live until you publish."); rerender(); }
      if (a === "preview") { const w = window.open("about:blank", "_blank"); await save(); if (w) w.location = "/?preview=1"; rerender(); }
      if (a === "publish") { await save(); if (!(await confirmBox("Publish these changes?", "The public page and guest portal will update right away.", "Publish"))) return rerender(); await call("content-publish"); await loadContent(); toast("Published."); rerender(); }
      if (a === "discard") { if (!(await confirmBox("Discard the draft?", "Your unpublished changes will be replaced with what’s live now.", "Discard", true))) return; await call("content-discard"); S.unsaved = false; await loadContent(); rerender(); }
    })));
    v.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => { sync(v); const list = getPath(S.draft, b.dataset.add) || []; const item = JSON.parse(b.dataset.blank); if ("id" in item) item.id = uid(); list.push(item); setPath(S.draft, b.dataset.add, list); S.unsaved = true; rerender(true); }));
    v.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => { sync(v); const parts = b.dataset.del.split("."); const i = +parts.pop(); getPath(S.draft, parts.join(".")).splice(i, 1); S.unsaved = true; rerender(true); }));
    v.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => { sync(v); const parts = b.dataset.up.split("."); const i = +parts.pop(); const l = getPath(S.draft, parts.join(".")); [l[i - 1], l[i]] = [l[i], l[i - 1]]; S.unsaved = true; rerender(true); }));
    v.querySelectorAll("[data-clear]").forEach((b) => (b.onclick = () => { sync(v); setPath(S.draft, b.dataset.clear, ""); S.unsaved = true; rerender(true); }));
    v.querySelectorAll("[data-upload]").forEach((inp) => (inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      await busy(null, async () => { sync(v); const r = await call("upload", { contentType: file.type, dataBase64: await fileToB64(file) }); setPath(S.draft, inp.dataset.upload, r.url); S.unsaved = true; toast("Uploaded. Save the draft to keep it."); rerender(true); });
    }));
  }

  // ---------- Client Experience ----------
  async function vExperience(v, keep) {
    if (!keep) await loadContent();
    const y = window.scrollY;
    v.innerHTML = head("Client Experience", "Itinerary, guest portal content, packing list, forms and announcements.") + pubbar()
      + `<div class="panel"><h2>Itinerary</h2><div class="fgrid">${F.text("itinerary.heading", "Heading")}${F.text("itinerary.note", "Note shown above the schedule", { wide: true, area: true, rows: 2 })}
        ${repeat("itinerary.days", "Days", (p) => `${F.text(`${p}.label`, "Day label", { hint: "e.g. Day 1, or Friday, November 10" })}
          ${repeat(`${p}.sessions`, "Sessions", (sp) => `${F.text(`${sp}.time`, "Time", { hint: "e.g. 9:00 AM" })}${F.text(`${sp}.title`, "Session")}${F.text(`${sp}.description`, "Description", { wide: true, area: true, rows: 2 })}${F.bool(`${sp}.provisional`, "Provisional (shows a “Provisional” label)")}`, { id: "", time: "", title: "", description: "", provisional: true }, "Add session")}`,
          { id: "", label: "", sessions: [] }, "Add day")}</div></div>
      <div class="panel"><h2>Announcements</h2><p class="small muted">Public updates shown to everyone signed in to the portal, including the waiting list.</p><div class="fgrid">
        ${repeat("portal.announcements", "Announcements", (p) => `${F.text(`${p}.date`, "Date label")}${F.text(`${p}.title`, "Title")}${F.text(`${p}.body`, "Message", { wide: true, area: true })}`, { id: "", date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), title: "", body: "" }, "Add announcement")}</div></div>
      <div class="panel"><h2>Preparation (confirmed guests only)</h2><div class="fgrid">
        ${F.lines("portal.packingList", "Packing list")}
        ${F.text("portal.arrivalGuidance", "Arrival guidance", { wide: true, area: true, rows: 4, hint: "The exact address is set in Settings and shown only to confirmed guests" })}
        ${F.text("portal.preparation", "Preparation materials", { wide: true, area: true, rows: 4 })}</div></div>
      <div class="panel"><h2>Forms</h2><p class="small muted">Agreement text must come from the attorney. Online completion of forms arrives with reservations.</p><div class="fgrid">
        ${repeat("portal.forms", "Forms", (p) => `${F.text(`${p}.name`, "Form name")}${F.bool(`${p}.required`, "Required")}${F.text(`${p}.description`, "Description", { wide: true, area: true, rows: 2 })}`, { id: "", name: "", required: false, description: "" }, "Add form")}</div></div>
      <div class="panel"><h2>Portal text</h2><div class="fgrid">${F.text("portal.welcome", "Welcome line")}${F.text("portal.supportText", "Support message", { wide: true, area: true, rows: 2 })}</div></div>`;
    wireContent(v, (k) => vExperience(v, k));
    if (keep) window.scrollTo(0, y);
  }

  // ---------- Content and Branding ----------
  async function vContent(v, keep) {
    if (!keep) await loadContent();
    const y = window.scrollY;
    const own = isOwner() ? "" : "disabled";
    const w = S.draft.waitlist || {};
    v.innerHTML = head("Content and Branding", "Everything on the public page. Changes stay in draft until you publish.") + pubbar()
      + `<div class="panel"><h2>Brand</h2><div class="fgrid">${F.text("brand.orgName", "Business name")}${F.text("brand.retreatName", "Retreat name")}${F.text("brand.logoAlt", "Logo description", { hint: "for screen readers" })}
        ${F.image("brand.logoUrl", "Logo (for light backgrounds)", "Until uploaded, a text wordmark marked as a placeholder is shown")}${F.image("brand.logoDarkUrl", "Logo (for dark backgrounds)", "Used in the footer")}
        <div class="wide">${F.bool("previewBanner", "Show the “awaiting approval” banner on the public page")}</div></div></div>
      <div class="panel"><h2>Overview and hero</h2><div class="fgrid">${F.text("hero.kicker", "Small line above the title")}${F.text("hero.title", "Hero title", { wide: true })}${F.text("hero.sub", "Supporting line", { wide: true })}
        ${F.text("hero.primaryLabel", "Main button")}${F.text("hero.secondaryLabel", "Second button")}
        ${F.image("hero.imageUrl", "Hero photo", "Approved retreat imagery, landscape")}${F.text("hero.imageAlt", "Hero photo description", { wide: true, hint: "for screen readers" })}${F.text("hero.videoUrl", "Hero video (optional)", { wide: true, hint: "/media/pond.mp4 or an https link to an approved .mp4. Visitors who prefer reduced motion see the hero photo instead, and everyone gets a pause button" })}${F.image("hero.videoPosterUrl", "Video still", "Shown for a moment while the video loads; use the video\u2019s first frame")}
        ${F.text("overview.heading", "Overview heading")}${F.text("overview.signoff", "Sign-off")}${F.text("overview.body", "Overview letter", { wide: true, area: true, rows: 6, hint: "Use “Eye” in Estar’s voice. Blank line = new paragraph" })}</div>
        <p class="small muted">Dates and location are set in Settings and appear only once marked confirmed.</p></div>
      <div class="panel"><h2>The grounds</h2><p class="small muted">The first six photos make the gallery mosaic; all of them open in the photo viewer. Use only photos approved for this retreat.</p><div class="fgrid">${F.text("grounds.heading", "Heading")}${F.text("grounds.intro", "Introduction", { wide: true, area: true })}
        ${repeat("grounds.photos", "Photos", (p) => `${F.image(`${p}.url`, "Photo")}${F.text(`${p}.caption`, "Caption")}${F.text(`${p}.alt`, "Description for screen readers", { wide: true })}`, { id: "", url: "", caption: "", alt: "" }, "Add photo")}</div></div>
      <div class="panel"><h2>The Experience</h2><div class="fgrid">${F.text("experience.heading", "Heading")}${F.text("experience.welcomes", "Who the retreat welcomes", { wide: true, area: true })}${F.text("experience.participation", "Participation note", { wide: true, area: true, hint: "Keep: participation and touch are always optional" })}
        ${F.lines("experience.inclusions", "Included")}${F.lines("experience.exclusions", "Not included")}${F.text("experience.pendingNote", "Shown while no sessions are published", { wide: true })}
        ${repeat("experience.activities", "Sessions and rituals", (p, a) => `${F.text(`${p}.title`, "Title")}${F.text(`${p}.note`, "Note")}${F.text(`${p}.description`, "Description", { wide: true, area: true, rows: 2 })}
          ${a.reviewRequired ? `<div class="wide warn">Held back pending a separate safety and suitability review. It can’t be published until the owner records that the review is complete.</div>${F.bool(`${p}.reviewDone`, `Safety and suitability review completed${isOwner() ? "" : " (owner only)"}`, { dis: own })}` : ""}
          ${F.bool(`${p}.published`, "Publish (owner-approved, facilitators and delivery confirmed)")}`, { id: "", title: "", description: "", note: "", published: false }, "Add session")}</div></div>
      <div class="panel"><h2>Your Stay</h2><div class="fgrid">${F.text("stay.heading", "Heading")}${F.text("stay.intro", "Introduction", { wide: true, area: true })}${F.text("stay.sharedNote", "Shared room note", { wide: true, area: true })}</div><p class="small muted">Room details, prices and photos are edited in Rooms and Inventory.</p></div>
      <div class="panel"><h2>Meet Estar</h2><div class="fgrid">${F.text("host.heading", "Heading")}${F.text("host.name", "Name")}${F.text("host.title", "Title")}${F.image("host.photoUrl", "Photo")}${F.text("host.bio", "Approved biography", { wide: true, area: true, rows: 7 })}</div></div>
      <div class="panel"><h2>FAQs</h2><div class="fgrid">${repeat("faqs", "Questions", (p) => `${F.text(`${p}.q`, "Question", { wide: true })}${F.text(`${p}.a`, "Answer", { wide: true, area: true })}`, { id: "", q: "", a: "" }, "Add question")}</div></div>
      <div class="panel"><h2>Testimonials and policies</h2><div class="fgrid">${F.text("trust.heading", "Heading")}
        ${repeat("trust.testimonials", "Testimonials", (p) => `${F.text(`${p}.quote`, "Quote (exactly as approved)", { wide: true, area: true })}${F.text(`${p}.name`, "Name as she approved it")}${F.bool(`${p}.permission`, "We have her written permission")}${F.bool(`${p}.published`, "Publish (requires permission)")}`, { id: "", quote: "", name: "", permission: false, published: false }, "Add testimonial")}
        ${F.text("trust.policiesText", "Policies (privacy, refunds, conduct)", { wide: true, area: true, rows: 5, hint: "Text from the attorney" })}</div></div>
      <div class="panel"><h2>Contact</h2><div class="fgrid">${F.text("contact.email", "Support email", { type: "email" })}${F.text("contact.phone", "Phone")}${F.text("contact.responseTime", "Response expectation", { hint: "e.g. We reply within 2 business days." })}
        <div class="wide">${F.bool("contact.verified", `These contact details are verified and can be shown${isOwner() ? "" : " (owner only)"}`, { dis: own })}</div></div></div>
      <div class="panel"><h2>Waiting list</h2><div class="fgrid">${F.text("waitlist.heading", "Heading")}${F.text("waitlist.intro", "Introduction", { wide: true, area: true })}
        ${F.text("waitlist.privacyNotice", "Privacy notice", { wide: true, area: true })}${F.text("waitlist.consentText", "Marketing consent wording (checkbox starts unchecked)", { wide: true, area: true })}
        ${F.text("waitlist.successMessage", "Success message", { wide: true, area: true })}</div>
        <p class="small muted">Consent version: ${esc(w.consentVersion || "")} · Privacy version: ${esc(w.privacyVersion || "")}. Changing either wording creates a new version when published, so each sign-up records exactly what she agreed to.</p></div>`;
    wireContent(v, (k) => vContent(v, k));
    if (keep) window.scrollTo(0, y);
  }

  // ---------- Communications ----------
  S.mailStatus = "";
  async function vComms(v) {
    const [tl, el] = await Promise.all([call("templates-list"), call("emails-list", { status: S.mailStatus })]);
    const failed = el.rows.filter((r) => r.status === "failed").length;
    v.innerHTML = head("Communications", "Email templates and delivery history.")
      + `<div class="panel"><h2>Templates</h2><p class="small muted">Use {{name}}, {{portal_url}} and the other placeholders shown in each draft. Editing a campaign email turns it off until the owner approves it again. Marketing emails include an unsubscribe link and go only to people who opted in.</p>
        <div class="table-wrap"><table><thead><tr><th>Email</th><th>Type</th><th>Status</th><th>Last edited</th><th></th></tr></thead><tbody>
        ${tl.rows.map((t) => `<tr><td><span class="name">${esc(t.name)}</span><small>${esc(t.subject)}</small></td><td>${t.category === "campaign" ? "Marketing" : "Operational"}</td>
          <td>${t.enabled ? tag("On", "ok") : tag("Off (draft)", "warn")}${t.approved_at ? `<small>Approved ${fmtDate(t.approved_at)} by ${esc(t.approved_by || "")}</small>` : ""}</td>
          <td>${fmtDate(t.updated_at)}<small>${esc(t.updated_by || "")}</small></td><td><button class="iconbtn" data-tpl="${esc(t.key)}">Edit</button></td></tr>`).join("")}</tbody></table></div><div id="tpl-edit"></div></div>
      <div class="panel"><div class="head" style="margin-bottom:12px"><div><h2 style="margin:0">Delivery history</h2><p class="small">Failed emails retry automatically with increasing waits. You can also retry now.</p></div>
        <div class="row"><select id="mail-status" aria-label="Filter by status"><option value="">All</option><option value="queued">Queued</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="canceled">Canceled</option></select>${failed ? '<button class="btn btn-outline" id="retry-all">Retry all failed</button>' : ""}</div></div>
        <div class="table-wrap">${el.rows.length ? `<table><thead><tr><th>Created</th><th>To</th><th>Email</th><th>Status</th><th>Attempts</th><th></th></tr></thead><tbody>
        ${el.rows.map((r) => `<tr><td>${fmtDateTime(r.created_at)}</td><td>${esc(r.to_email)}</td><td>${esc(r.subject)}<small>${esc(r.template_key || "")}</small></td>
          <td>${r.status === "sent" ? tag("Sent", "ok") : r.status === "failed" ? tag(r.attempts >= el.maxAttempts ? "Failed (stopped)" : "Failed, will retry", "bad") : tag(r.status)}${r.last_error ? `<small>${esc(r.last_error)}</small>` : ""}${r.status === "failed" && r.attempts < el.maxAttempts ? `<small>Next try ${fmtDateTime(r.next_attempt_at)}</small>` : ""}</td>
          <td>${r.attempts}</td><td>${["failed", "queued"].includes(r.status) ? `<div class="row">${r.template_key !== "signin_code" ? `<button class="iconbtn" data-retry="${esc(r.id)}">Retry now</button>` : ""}<button class="iconbtn" data-cancel="${esc(r.id)}">Cancel</button></div>` : ""}</td></tr>`).join("")}</tbody></table>` : '<div class="empty">No emails yet.</div>'}</div></div>`;
    const ms = document.getElementById("mail-status"); ms.value = S.mailStatus; ms.onchange = () => { S.mailStatus = ms.value; vComms(v); };
    const ra = document.getElementById("retry-all"); if (ra) ra.onclick = () => busy(ra, async () => { const r = await call("email-retry", {}); toast(`${r.sent} of ${r.tried} sent.`); vComms(v); });
    v.querySelectorAll("[data-retry]").forEach((b) => (b.onclick = () => busy(b, async () => { const r = await call("email-retry", { id: b.dataset.retry }); toast(r.sent ? "Sent." : "Still failing. See the error for details.", !r.sent); vComms(v); })));
    v.querySelectorAll("[data-cancel]").forEach((b) => (b.onclick = () => busy(b, async () => { await call("email-cancel", { id: b.dataset.cancel }); vComms(v); })));
    v.querySelectorAll("[data-tpl]").forEach((b) => (b.onclick = () => editTemplate(v, tl.rows.find((t) => t.key === b.dataset.tpl))));
  }
  function editTemplate(v, t) {
    const box = document.getElementById("tpl-edit");
    const locked = ["signin_code", "staff_invite"].includes(t.key);
    box.innerHTML = `<div class="panel" style="margin-top:16px;border-top:4px solid var(--olive)"><h3>${esc(t.name)}</h3><form class="form" id="tpl-form" novalidate>
      <label>Subject<input type="text" name="subject" maxlength="200" value="${esc(t.subject)}"></label>
      <label>Email text <span class="hint">Blank line = new paragraph</span><textarea name="body" rows="9" maxlength="10000">${esc(t.body)}</textarea></label>
      <div class="row"><button class="btn btn-primary" type="submit">Save</button><button class="btn btn-outline" type="button" id="tpl-prev">Preview</button>
        ${isOwner() ? (t.enabled ? (locked ? '<span class="small muted">Required for sign-in; always on.</span>' : '<button class="btn btn-danger" type="button" id="tpl-off">Turn off</button>') : '<button class="btn btn-outline" type="button" id="tpl-on">Approve and turn on</button>') : '<span class="small muted">The owner approves and turns emails on.</span>'}
        <button class="iconbtn" type="button" id="tpl-close">Close</button></div>
      <iframe class="mailprev" id="tpl-frame" title="Email preview" hidden sandbox></iframe></form></div>`;
    const f = document.getElementById("tpl-form");
    f.addEventListener("input", () => (S.unsaved = true));
    f.onsubmit = (ev) => { ev.preventDefault(); busy(f.querySelector("button[type=submit]"), async () => { await call("template-save", { key: t.key, subject: f.subject.value, body: f.body.value }); S.unsaved = false; toast("Template saved."); vComms(v); }); };
    document.getElementById("tpl-prev").onclick = (e) => busy(e.target, async () => { const r = await call("template-preview", { key: t.key, subject: f.subject.value, body: f.body.value }); const fr = document.getElementById("tpl-frame"); fr.hidden = false; fr.srcdoc = `<p style="font-family:Arial;padding:0 16px"><strong>Subject:</strong> ${esc(r.subject)}</p>${r.html}`; });
    document.getElementById("tpl-close").onclick = () => { S.unsaved = false; box.innerHTML = ""; };
    const on = document.getElementById("tpl-on"), off = document.getElementById("tpl-off");
    if (on) on.onclick = () => busy(on, async () => { if (S.unsaved) return toast("Save your changes first.", true); await call("template-approve", { key: t.key, enabled: true }); toast("Approved and turned on."); vComms(v); });
    if (off) off.onclick = () => busy(off, async () => { await call("template-approve", { key: t.key, enabled: false }); toast("Turned off."); vComms(v); });
    box.scrollIntoView({ block: "start" });
  }

  // ---------- Settings and Audit ----------
  async function vSettings(v) {
    const [rg, sl, ig, al] = await Promise.all([call("retreat-get"), call("staff-list"), call("integrations"), call("audit-list", {})]);
    const r = rg.retreat, own = isOwner() ? "" : "disabled";
    S.audit = al.rows;
    v.innerHTML = head("Settings and Audit", `Environment: ${esc(ig.environment)}`)
      + `<div class="panel"><h2>Retreat details${ownerNote()}</h2><p class="small muted">Dates and location appear on the public page only once marked confirmed.</p>
        <form class="form" id="ret-form" novalidate><div class="fgrid">
          <label>Retreat name<input type="text" name="name" value="${esc(r.name)}" ${own}></label>
          <label>Timezone <span class="hint">(IANA name)</span><input type="text" name="timezone" value="${esc(r.timezone)}" ${own}></label>
          <label>Start date<input type="date" name="start_date" value="${esc(r.start_date || "")}" ${own}></label>
          <label>End date<input type="date" name="end_date" value="${esc(r.end_date || "")}" ${own}></label>
          <label>Number of nights<input type="number" name="nights" min="0" max="60" value="${r.nights ?? ""}" ${own}></label>
          <div style="align-self:end"><label class="check"><input type="checkbox" name="dates_confirmed" ${r.dates_confirmed ? "checked" : ""} ${own}> Dates confirmed</label></div>
          <label>Venue<input type="text" name="venue_name" value="${esc(r.venue_name || "")}" ${own}></label>
          <label>City and state<input type="text" name="venue_city" value="${esc(r.venue_city || "")}" ${own}></label>
          <div style="align-self:end"><label class="check"><input type="checkbox" name="venue_confirmed" ${r.venue_confirmed ? "checked" : ""} ${own}> Venue confirmed</label></div>
          <label class="wide">Exact address and arrival details <span class="hint">(confirmed guests only)</span><textarea name="private_address" ${own}>${esc(r.private_address || "")}</textarea></label>
          <div style="align-self:end"><label class="check"><input type="checkbox" name="day_pass_enabled" ${r.day_pass_enabled ? "checked" : ""} ${own}> Sell a day pass</label></div>
          <label>Day pass price<div class="money">$<input type="text" name="day_pass" inputmode="decimal" value="${dollars(r.day_pass_price_cents)}" ${own}></div></label>
        </div>${isOwner() ? '<div><button class="btn btn-primary" type="submit">Save retreat details</button></div>' : ""}</form></div>
      <div class="panel"><h2>Staff access</h2><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Two-step sign-in</th><th>Last sign-in</th><th></th></tr></thead><tbody>
        ${sl.rows.map((a) => `<tr><td><span class="name">${esc(a.name)}</span><small>${esc(a.email)}</small>${a.active ? "" : tag("Deactivated", "bad")}${a.invite_expires ? `<small>Invitation pending until ${fmtDateTime(a.invite_expires)}</small>` : ""}</td>
          <td>${isOwner() ? `<select data-role="${esc(a.id)}" aria-label="Role for ${esc(a.name)}"><option value="owner" ${a.role === "owner" ? "selected" : ""}>Owner</option><option value="staff" ${a.role === "staff" ? "selected" : ""}>Staff</option></select>` : esc(a.role)}</td>
          <td>${a.totp_enabled ? tag("On", "ok") : tag("Not set up", "warn")}</td><td>${a.last_login_at ? fmtDateTime(a.last_login_at) : "Never"}</td>
          <td>${isOwner() && a.id !== ME.id ? `<div class="row"><button class="iconbtn" data-active="${esc(a.id)}" data-on="${a.active ? 0 : 1}">${a.active ? "Deactivate" : "Reactivate"}</button><button class="iconbtn" data-mfa="${esc(a.id)}">Reset two-step</button></div>` : ""}</td></tr>`).join("")}
        </tbody></table></div>
        ${isOwner() ? `<form class="form" id="inv-form" style="margin-top:14px" novalidate><h3>Invite someone</h3><div class="fgrid"><label>Name<input type="text" name="name" required></label><label>Email<input type="email" name="email" required></label><label>Role<select name="role"><option value="staff">Staff</option><option value="owner">Owner</option></select></label><div style="align-self:end"><button class="btn btn-primary" type="submit">Send invitation</button></div></div><p class="small muted" id="inv-link"></p></form>` : ""}
        <p class="small muted">Owners can change roles, payment settings, prices and sensitive configuration. Staff can manage the waiting list, clients, room descriptions and photos, content and email drafts.</p></div>
      <div class="panel"><h2>Integrations</h2><ul class="checklist">${ig.items.map((i) => `<li><span class="${i.ok ? "ok" : "no"}">${i.ok ? "✓" : "✕"}</span><span>${esc(i.name)}<br><small class="muted">${esc(i.detail)}</small></span></li>`).join("")}</ul></div>
      <div class="panel"><h2>Change history</h2><div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody id="audit-rows"></tbody></table></div>
        <button class="iconbtn" id="audit-more" style="margin-top:10px">Load older</button></div>`;
    renderAudit();
    const rf = document.getElementById("ret-form");
    rf.addEventListener("input", () => (S.unsaved = true));
    rf.onsubmit = (ev) => {
      ev.preventDefault();
      const fd = new FormData(rf);
      const dp = toCents(fd.get("day_pass"));
      if (Number.isNaN(dp)) return toast("Enter a valid day pass price.", true);
      const body = Object.fromEntries(fd);
      ["dates_confirmed", "venue_confirmed", "day_pass_enabled"].forEach((k) => (body[k] = rf[k].checked));
      body.day_pass_price_cents = dp;
      busy(rf.querySelector("button[type=submit]"), async () => { await call("retreat-save", body); S.unsaved = false; toast("Retreat details saved."); vSettings(v); });
    };
    v.querySelectorAll("[data-role]").forEach((s) => (s.onchange = () => busy(null, async () => { const a = sl.rows.find((x) => x.id === s.dataset.role); await call("staff-update", { id: a.id, role: s.value, active: a.active }); toast("Role updated."); vSettings(v); })));
    v.querySelectorAll("[data-active]").forEach((b) => (b.onclick = () => busy(b, async () => { const a = sl.rows.find((x) => x.id === b.dataset.active); await call("staff-update", { id: a.id, role: a.role, active: b.dataset.on === "1" }); vSettings(v); })));
    v.querySelectorAll("[data-mfa]").forEach((b) => (b.onclick = async () => { if (await confirmBox("Reset two-step sign-in?", "They’ll be signed out and asked to set up their authenticator app again at next sign-in.", "Reset", true)) busy(b, async () => { await call("staff-reset-mfa", { id: b.dataset.mfa }); toast("Reset."); vSettings(v); }); }));
    const inv = document.getElementById("inv-form");
    if (inv) inv.onsubmit = (ev) => { ev.preventDefault(); busy(inv.querySelector("button"), async () => { const r = await call("staff-invite", Object.fromEntries(new FormData(inv))); document.getElementById("inv-link").innerHTML = `Invitation emailed. You can also share this private link (expires in 72 hours): <br><code>${esc(r.inviteUrl)}</code>`; toast("Invitation sent."); }); };
    document.getElementById("audit-more").onclick = (e) => busy(e.target, async () => { const last = S.audit[S.audit.length - 1]; if (!last) return; const r = await call("audit-list", { before: last.id }); S.audit.push(...r.rows); renderAudit(); if (!r.rows.length) e.target.hidden = true; });
  }
  function renderAudit() {
    const fmt = (o) => (o && Object.keys(o).length ? esc(JSON.stringify(o)).slice(0, 400) : "");
    document.getElementById("audit-rows").innerHTML = S.audit.map((a) => `<tr><td>${fmtDateTime(a.created_at)}</td><td>${esc(a.actor_label)}</td><td>${esc(a.action)}<small>${esc(a.entity || "")} ${esc(a.entity_id || "")}</small></td>
      <td>${a.before || a.after ? `<small>Before: ${fmt(a.before)}</small><small>After: ${fmt(a.after)}</small>` : ""}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">No changes yet.</td></tr>';
  }

  const VIEWS = { overview: vOverview, waitlist: vWaitlist, clients: vClients, rooms: vRooms, bookings: vBookings, experience: (v) => vExperience(v), content: (v) => vContent(v), comms: vComms, settings: vSettings };
  boot();
})();
