// Admin area (single page). The server checks the session, MFA and role on every action;
// the hidden or disabled controls here are only a convenience.
(() => {
  const { esc, money, fmtDate, fmtDateTime } = EG;
  const app = document.getElementById("app");
  let ME = null;
  let OPEN = false;   // sign-in is turned off (ADMIN_REQUIRE_SIGNIN not set)
  let TAB = "overview";
  const S = { unsaved: false };
  const isOwner = () => ME && ME.role === "owner";

  const TABS = [["overview", "Overview"], ["page", "Landing page"], ["tickets", "Tickets"], ["payments", "Payments"], ["settings", "Settings"]];

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
    OPEN = Boolean(st.open);
    if (st.state === "signed_out") return loginScreen(st.ownerSet);
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

  function loginScreen(ownerSet) {
    authCard(`<h1>Admin sign in</h1><p class="muted">Embodied Godis Retreat</p>
      ${ownerSet === false ? '<p class="form-error">The owner sign-in isn’t set up yet. In Vercel, add ADMIN_EMAIL and ADMIN_PASSWORD (8+ characters) under Settings, Environment Variables, then redeploy.</p>' : ""}
      <form id="f" novalidate>
        <label>Email<input type="email" name="email" autocomplete="username" required></label>
        <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
        <p class="form-error" role="alert"></p><button class="btn btn-primary" type="submit">Sign in</button></form>`);
    bindForm("f", async (v) => { await call("login", v); boot(); });
  }

  async function enrollScreen() {
    authCard(`<h1>Set up two-step sign-in</h1><p class="muted">Loading…</p>`);
    let r;
    try { r = await call("mfa-begin"); } catch (e) { return authCard(`<h1>Two-step sign-in</h1><p class="form-error">${esc(e.message)}</p>`); }
    authCard(`<h1>Use an authenticator app</h1>
      <p class="muted">Optional. An authenticator app (Google Authenticator, 1Password, Authy, or similar) adds a second step after your password. Scan this code, then enter the 6-digit number it shows.</p>
      <div class="qr">${r.qr}</div>
      <p class="small muted" style="margin:10px 0 4px">Can’t scan? Enter this key in the app:</p><p class="secret">${esc(r.secret)}</p>
      <form id="f" novalidate><label>6-digit code<input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label>
      <p class="form-error" role="alert"></p><button class="btn btn-primary" type="submit">Turn on and continue</button>
      <button class="linkish" type="button" id="cancel-enroll">Cancel</button></form>`);
    document.getElementById("cancel-enroll").onclick = () => boot();
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
    authCard(`<h1>Welcome, ${esc(info.name)}</h1><p class="muted">Choose a password for ${esc(info.email)}.</p>
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
    if (OPEN) ["signout", "mobile-signout"].forEach((id) => (document.getElementById(id).hidden = true));
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
    const t = (n, l, sub = "") => `<div class="tile"><div class="l">${l}</div><div class="n">${n}</div>${sub ? `<div class="s">${sub}</div>` : ""}</div>`;
    const tt = d.totals, c = d.checklist;
    const left = (o) => (o.tickets == null ? "No limit" : o.left === 0 ? tag("Sold out", "warn") : `${o.left} left`);
    v.innerHTML = head("Overview", esc(d.retreat.name), `<a class="btn btn-outline" href="/" target="_blank" rel="noopener">View the landing page</a>`)
      + `<div class="tiles">
        ${t(d.retreat.reservations_open ? "Open" : "Closed", "Secure your spot", d.retreat.reservations_open ? "Guests can pay now" : "Payments open soon")}
        ${t(`${tt.residential_sold} / ${tt.residential_tickets}`, "Residential tickets sold", "One ticket per guest")}
        ${t(tt.sold, "All tickets sold", "Rooms and day immersions")}
        ${t(money(tt.collected_cents, { cents: true }), "Collected", "All payments recorded, less refunds")}
        ${t(money(tt.outstanding_cents, { cents: true }), "Balances due", "Still to be paid on active tickets")}
      </div>
      <div>
        <div class="panel"><h2>Tickets</h2><div class="table-wrap"><table><thead><tr><th>Option</th><th>Price</th><th>Sold</th><th>Available</th></tr></thead><tbody>
          ${d.options.filter((o) => o.visible).map((o) => `<tr><td>${esc(o.name)}</td><td>${money(o.price_cents)}</td><td>${o.sold}${o.tickets != null ? ` of ${o.tickets}` : ""}</td><td>${left(o)}</td></tr>`).join("")}
          </tbody></table></div><p class="small muted">Record each guest’s payment in <button class="linkish" data-go="payments">Payments</button>; tickets sold and sold-out status update automatically.</p></div>
        <div class="panel"><h2>Before opening Secure your spot</h2><p class="small muted">The payment button stays off until every item is complete.</p>${checklistHtml(c)}</div>
      </div>`;
    v.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
  }
  const checklistHtml = (c) => `<ul class="checklist">${c.items.map((i) => `<li><span class="${i.ok ? "ok" : "no"}" aria-label="${i.ok ? "Done" : "Not done"}">${i.ok ? "✓" : "✕"}</span><span>${esc(i.label)}${i.detail ? `<br><small class="muted">${esc(i.detail)}</small>` : ""}</span></li>`).join("")}</ul>`;

  async function vTickets(v) {
    const d = await call("rooms-list");
    S.rooms = d.rooms;
    S.roomPhotos = {};
    d.rooms.forEach((r) => (S.roomPhotos[r.id] = (r.photos || []).map((p) => ({ ...p }))));
    v.innerHTML = head("Tickets", "Every room and day immersion guests can choose under Secure your spot. A room has one ticket per guest. Tickets sold come from the payments you record.",
      isOwner() ? '<button class="btn btn-primary" id="add-room">Add a room</button>' : "")
      + `<div class="okbox small">Prices are stored exactly as entered and are per guest. A room sells out when all of its tickets (guests) are sold; hide a room to stop offering it.</div>
      <div id="new-room"></div>${d.rooms.map((r) => roomForm(r, d.basisLabels)).join("")}
      <div class="panel"><h2>Day immersions${ownerNote()}</h2><p class="small muted">For guests who join without staying overnight; always paid in full. Leave the ticket limit blank for no limit, and the early-bird price blank to offer only the standard price. After the early bird’s last day, the page shows only the standard price. Their wording is edited in Landing page.</p>
        <form class="form" id="imm-form" novalidate><label class="check"><input type="checkbox" name="enabled" ${d.immersions_enabled ? "checked" : ""} ${isOwner() ? "" : "disabled"}> Offer day immersions</label>
          <div id="imm"></div>${isOwner() ? '<div class="row"><button type="button" class="iconbtn" id="imm-add">Add immersion</button><button class="btn btn-primary" type="submit">Save day immersions</button></div>' : ""}</form></div>`;
    S.imm = (d.immersions || []).map((x) => ({ ...x }));
    renderImm();
    const ia = document.getElementById("imm-add");
    if (ia) ia.onclick = () => { S.imm.push({ id: "", name: "", days: 1, price_cents: null, early_bird_price_cents: null, ticket_limit: null, sold: 0 }); renderImm(); };
    const imf = document.getElementById("imm-form");
    imf.addEventListener("input", () => (S.unsaved = true));
    imf.onsubmit = (ev) => {
      ev.preventDefault();
      if (S.imm.some((i) => Number.isNaN(i.price_cents) || Number.isNaN(i.early_bird_price_cents))) return toast("Enter valid immersion prices.", true);
      busy(imf.querySelector("button[type=submit]"), async () => {
        await call("immersions-save", { enabled: imf.enabled.checked, immersions: S.imm.map(({ sold, ...i }) => i) });
        S.unsaved = false; toast("Day immersions saved."); vTickets(v);
      });
    };
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
    const ready = !r.id ? "" : [r.price_basis !== "unconfirmed", r.includes_admission !== "unconfirmed", r.guest_capacity, r.beds, (r.photos || []).length].every(Boolean);
    const sel = (name, opts, val, dis) => `<select name="${name}" ${dis}>${opts.map(([k, l]) => `<option value="${k}" ${k === val ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    const txt = (name, label, val, opts = {}) => `<label class="${opts.wide ? "wide" : ""}">${label}${opts.hint ? ` <span class="hint">${opts.hint}</span>` : ""}${opts.area ? `<textarea name="${name}" maxlength="${opts.max || 600}" ${opts.dis || ""}>${esc(val || "")}</textarea>` : `<input type="text" name="${name}" value="${esc(val || "")}" maxlength="${opts.max || 300}" ${opts.dis || ""}>`}</label>`;
    return `<details class="panel room-card" ${isNew ? "open" : ""} data-room="${esc(r.id)}">
      <summary><span><span class="title">${esc(r.name || "New room")}</span> ${r.id ? `<span class="muted">${money(r.price_cents)}</span>` : ""}</span>
        <span class="row">${r.id ? `${r.price_basis === "unconfirmed" ? tag("Basis to confirm", "warn") : tag(basis[r.price_basis], "ok")} ${ready ? tag("Ready to sell", "ok") : tag("Details needed", "warn")} ${r.visible ? "" : tag("Hidden")} ${tag(`${r.sold || 0} of ${r.guest_capacity ?? "?"} sold`, r.guest_capacity && r.sold >= r.guest_capacity ? "warn" : "")}` : ""}</span></summary>
      <form class="form" novalidate>
        <div class="fgrid">
          ${txt("name", "Room name", r.name, { max: 80 })}
          <label>Price${ownerNote()}<div class="money">$<input type="text" name="price" inputmode="decimal" value="${dollars(r.price_cents)}" ${own}></div></label>
          <label>Price basis${ownerNote()}${sel("price_basis", Object.entries(basis).map(([k, l]) => [k, k === "unconfirmed" ? "To be confirmed" : l]), r.price_basis, own)}</label>
          <label>Includes retreat admission?${ownerNote()}${sel("includes_admission", [["unconfirmed", "To be confirmed"], ["yes", "Yes"], ["no", "No, sold separately"]], r.includes_admission, own)}</label>
          ${txt("occupancy_label", "Occupancy (shown to guests)", r.occupancy_label, { hint: "e.g. Double occupancy" })}
          <label>Tickets (guests)${ownerNote()} <span class="hint">(one per guest)</span><input type="number" name="guest_capacity" min="1" max="20" value="${r.guest_capacity ?? ""}" ${own}></label>
          ${txt("beds", "Actual beds", r.beds, { hint: "e.g. One queen bed" })}
          ${txt("bathroom", "Bathroom access", r.bathroom, { hint: "e.g. Private en suite" })}
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
</div>
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
          beds: fd.get("beds"), bathroom: fd.get("bathroom"), features: fd.get("features"), accessibility: fd.get("accessibility"),
          difference_note: fd.get("difference_note"), description: fd.get("description"), photos: S.roomPhotos[id],
          visible: f.visible.checked,
        };
        busy(f.querySelector("button[type=submit]"), async () => { await call("room-save", body); S.unsaved = false; toast("Room saved."); vTickets(v); });
      };
      const del = card.querySelector("[data-rdel]");
      if (del) del.onclick = async () => { if (await confirmBox("Delete this room?", "This removes the room. Rooms with sales recorded can’t be deleted; hide them instead.", "Delete", true)) busy(del, async () => { await call("room-delete", { id }); toast("Room deleted."); vTickets(v); }); };
    });
  }

  // ---------- Bookings and payments ----------
  async function vPayments(v) {
    const [rg, sl, rl] = await Promise.all([call("retreat-get"), call("sales-list"), call("rooms-list")]);
    const r = rg.retreat, t = r.terms || {}, c = rg.checklist, own = isOwner() ? "" : "disabled";
    S.inst = (t.installments || []).map((x) => ({ ...x }));
    const ta = (name, label, hint) => `<label class="wide">${label}${hint ? ` <span class="hint">${hint}</span>` : ""}<textarea name="${name}" maxlength="4000" ${own}>${esc(t[name] || "")}</textarea></label>`;
    const pct = sl.deposit_percent;
    const optLabel = (o) => `${o.name} · ${money(o.price_cents)}${o.early_bird ? " early bird" : ""}${o.tickets != null ? ` · ${o.left} left` : ""}`;
    const forSale = sl.options.filter((o) => o.visible);
    v.innerHTML = head("Payments", "Record each guest’s payment, track balances, and set where the Secure your spot button sends guests.", '<button class="btn btn-outline" id="sales-csv">Export CSV</button>')
      + `<div class="panel"><h2>Secure your spot is ${r.reservations_open ? "open" : "closed"}</h2>
          <p class="small muted">${r.reservations_open ? "Guests can choose an option and pay now." : "The button on the landing page says “Payments open soon.” It can be turned on once everything below is complete."}</p>
          ${checklistHtml(c)}
          ${isOwner() ? `<div class="row" style="margin-top:12px"><button class="btn ${r.reservations_open ? "btn-danger" : "btn-primary"}" id="toggle-res" ${!r.reservations_open && !c.ready ? "disabled" : ""}>${r.reservations_open ? "Turn payments off" : "Turn payments on"}</button>${!r.reservations_open && !c.ready ? '<span class="small muted">Complete the checklist to enable.</span>' : ""}</div>` : ""}</div>
        <div class="panel"><h2>Record a payment</h2><p class="small muted">When a guest pays on your payment site, record it here. Their ticket counts as sold right away, and the room or immersion shows as sold out when its tickets are gone.</p>
          <form class="form" id="sale-form" novalidate><div class="fgrid">
            <label class="wide">Ticket<select name="option_id" required><option value="">Choose a room or day immersion</option>
              <optgroup label="Rooms">${forSale.filter((o) => o.kind === "room").map((o) => `<option value="${esc(o.id)}" ${o.left === 0 ? "disabled" : ""}>${esc(optLabel(o))}</option>`).join("")}</optgroup>
              <optgroup label="Day immersions">${forSale.filter((o) => o.kind === "immersion").map((o) => `<option value="${esc(o.id)}" ${o.left === 0 ? "disabled" : ""}>${esc(optLabel(o))}</option>`).join("")}</optgroup></select></label>
            <label>Guest name<input type="text" name="guest_name" maxlength="120" required autocomplete="off"></label>
            <label>Email <span class="hint">(optional)</span><input type="email" name="guest_email" autocomplete="off"></label>
            <label>Phone <span class="hint">(optional)</span><input type="text" name="guest_phone" maxlength="40" autocomplete="off"></label>
            <label>Paid by<select name="plan"><option value="deposit">${pct ? `Deposit (${pct}%)` : "Deposit"}</option><option value="full">Paid in full</option></select></label>
            <label>Amount paid<div class="money">$<input type="text" name="amount" inputmode="decimal"></div></label>
            <label>Date paid<input type="date" name="paid_on" value="${new Date().toISOString().slice(0, 10)}"></label>
            <label class="wide">Notes <span class="hint">(optional, for example the payment site’s receipt number)</span><input type="text" name="notes" maxlength="1000"></label>
          </div><p class="small muted" id="sale-hint"></p><div><button class="btn btn-primary" type="submit">Record payment</button></div></form></div>
        <div class="panel"><h2>Guests and payments</h2>
          <div class="tiles" style="margin-bottom:12px"><div class="tile"><div class="l">Collected</div><div class="n">${money(sl.totals.collected_cents, { cents: true })}</div></div><div class="tile"><div class="l">Balances due</div><div class="n">${money(sl.totals.outstanding_cents, { cents: true })}</div></div><div class="tile"><div class="l">Tickets sold</div><div class="n">${sl.totals.sold}</div></div></div>
          ${sl.sales.length ? sl.sales.map((x) => saleCard(x)).join("") : '<p class="muted">No payments recorded yet.</p>'}</div>
        <div class="panel"><h2>Payment links${ownerNote()}</h2><p class="small muted">Where the Secure your spot button sends guests (your payment site). Rooms can be paid by deposit or in full; day immersions are paid in full. Leave a room blank to use the default links. The button only works while payments are turned on. When a guest pays, record it above so their ticket counts as sold.</p>
          <form class="form" id="links-form" novalidate><div class="table-wrap"><table><thead><tr><th>Option</th><th>Deposit link</th><th>Pay in full link</th></tr></thead><tbody>
            ${[["*", "Default for every room", false], ...rl.rooms.filter((x) => x.visible).map((x) => [x.id, x.name, false]), ...(r.immersions || []).map((i) => [i.id, i.name, true])].map(([id, name, imm]) => {
              const l = (r.payment_links || {})[id] || {};
              return `<tr><td>${esc(name)}</td><td>${imm ? '<span class="small muted">Paid in full</span>' : `<input type="url" data-link="${esc(id)}" data-k="deposit" value="${esc(l.deposit || "")}" placeholder="https://" aria-label="${esc(name)} deposit link" ${own}>`}</td>
                <td><input type="url" data-link="${esc(id)}" data-k="full" value="${esc(l.full || "")}" placeholder="https://" aria-label="${esc(name)} pay in full link" ${own}></td></tr>`;
            }).join("")}</tbody></table></div>
          ${isOwner() ? '<div><button class="btn btn-primary" type="submit">Save payment links</button></div>' : ""}</form></div>
        <div class="panel"><h2>Payment terms${ownerNote()}</h2><p class="small muted">Shown on the landing page once approved.</p>
          <form class="form" id="terms-form" novalidate><div class="fgrid">
            <label>Deposit amount<div class="money">$<input type="text" name="deposit" inputmode="decimal" value="${dollars(t.deposit_cents)}" ${own}></div></label>
            <label>Or deposit percent<input type="number" name="deposit_percent" min="1" max="100" value="${t.deposit_percent ?? ""}" ${own}></label>
            ${ta("deposit_text", "Deposit terms")}
            ${ta("fees_text", "Fees", "Any processing or service fees")}
            ${ta("taxes_text", "Taxes")}
            ${ta("installments_text", "Payment schedule (shown to guests)")}
            <div class="wide"><h3>Installments</h3><div id="inst"></div>${isOwner() ? '<button type="button" class="iconbtn" id="inst-add">Add installment</button>' : ""}
              <p class="small muted">Installment due dates guests should know about. Payments themselves are taken on your payment site.</p></div>
            ${ta("cancellation_text", "Cancellation terms")}
            ${ta("transfer_text", "Transfer terms")}
            ${ta("refund_text", "Refund terms")}
          </div>
          <label class="check"><input type="checkbox" name="terms_confirmed" ${r.terms_confirmed ? "checked" : ""} ${own}> These payment terms are approved</label>
          <label class="check"><input type="checkbox" name="legal_confirmed" ${r.legal_confirmed ? "checked" : ""} ${own}> The agreement and policy text from the attorney is in place and approved</label>
          ${isOwner() ? '<div><button class="btn btn-primary" type="submit">Save payment terms</button></div>' : ""}</form></div>`;
    wireSales(v, sl, pct);
    renderInst();
    const add = document.getElementById("inst-add");
    if (add) add.onclick = () => { S.inst.push({ label: "", amount_cents: null, percent: null, due_date: "" }); renderInst(); };
    const tog = document.getElementById("toggle-res");
    if (tog) tog.onclick = async () => {
      const open = !r.reservations_open;
      if (await confirmBox(open ? "Turn payments on?" : "Turn payments off?", open ? "The Secure your spot button will send guests to your payment links." : "The Secure your spot button will say “Payments open soon” again.", open ? "Turn on" : "Turn off", !open))
        busy(tog, async () => { await call("reservations-toggle", { open }); vPayments(v); });
    };
    const lf = document.getElementById("links-form");
    lf.addEventListener("input", () => (S.unsaved = true));
    lf.onsubmit = (ev) => {
      ev.preventDefault();
      const links = {};
      lf.querySelectorAll("[data-link]").forEach((inp) => { (links[inp.dataset.link] ||= {})[inp.dataset.k] = inp.value.trim(); });
      busy(lf.querySelector("button[type=submit]"), async () => { await call("payment-links-save", { links }); S.unsaved = false; toast("Payment links saved."); vPayments(v); });
    };
    const f = document.getElementById("terms-form");
    f.addEventListener("input", () => (S.unsaved = true));
    f.onsubmit = (ev) => {
      ev.preventDefault();
      const fd = new FormData(f);
      const dep = toCents(fd.get("deposit"));
      if (Number.isNaN(dep)) return toast("Enter a valid deposit amount.", true);
      const body = { deposit_cents: dep, deposit_percent: fd.get("deposit_percent"), installments: S.inst.map((i) => ({ ...i })), terms_confirmed: f.terms_confirmed.checked, legal_confirmed: f.legal_confirmed.checked };
      ["deposit_text", "fees_text", "taxes_text", "installments_text", "cancellation_text", "transfer_text", "refund_text"].forEach((k) => (body[k] = fd.get(k)));
      busy(f.querySelector("button[type=submit]"), async () => { await call("terms-save", body); S.unsaved = false; toast("Payment terms saved."); vPayments(v); });
    };
  }
  // One guest's ticket: what it cost, what's been paid, and every payment toward it.
  function saleCard(x) {
    const canceled = x.status === "canceled";
    return `<details class="panel sale-card${canceled ? " canceled" : ""}" data-sale="${esc(x.id)}"><summary>
      <span><span class="title">${esc(x.guest_name)}</span> <span class="muted">${esc(x.option_name)}</span></span>
      <span class="row">${canceled ? tag("Canceled") : x.balance_cents > 0 ? tag(`${money(x.balance_cents, { cents: true })} due`, "warn") : tag("Paid in full", "ok")}
        <span class="muted">${money(x.paid_cents, { cents: true })} of ${money(x.total_cents, { cents: true })}</span></span></summary>
      <p class="small">${[x.guest_email && `<a href="mailto:${esc(x.guest_email)}">${esc(x.guest_email)}</a>`, x.guest_phone && esc(x.guest_phone), x.plan === "deposit" ? "Deposit plan" : "Paid in full plan", `recorded ${fmtDate(x.created_at)}`].filter(Boolean).join(" · ")}${x.notes ? `<br>${esc(x.notes)}` : ""}</p>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Payment</th><th>Amount</th><th></th></tr></thead><tbody>
        ${x.payments.length ? x.payments.map((p) => `<tr><td>${fmtDate(p.paid_on)}</td><td>${p.kind === "refund" ? "Refund" : "Payment"}${p.note ? ` · ${esc(p.note)}` : ""}</td><td>${p.kind === "refund" ? "−" : ""}${money(p.amount_cents, { cents: true })}</td>
          <td><button type="button" class="iconbtn" data-pdel="${esc(p.id)}">Remove</button></td></tr>`).join("") : '<tr><td colspan="4" class="muted">No payments yet.</td></tr>'}</tbody></table></div>
      ${canceled ? "" : `<form class="form pay-form" novalidate><div class="fgrid">
        <label>Amount<div class="money">$<input type="text" name="amount" inputmode="decimal" value="${x.balance_cents > 0 ? dollars(x.balance_cents) : ""}"></div></label>
        <label>Date<input type="date" name="paid_on" value="${new Date().toISOString().slice(0, 10)}"></label>
        <label>Type<select name="kind"><option value="payment">Payment</option><option value="refund">Refund</option></select></label>
        <label>Note <span class="hint">(optional)</span><input type="text" name="note" maxlength="200" placeholder="For example: 2nd installment"></label>
      </div><div class="row"><button class="btn btn-primary" type="submit">Add payment</button></div></form>`}
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn ${canceled ? "btn-outline" : "btn-danger"}" data-cancel="${canceled ? "restore" : "cancel"}">${canceled ? "Restore ticket" : "Cancel ticket"}</button></div>
    </details>`;
  }

  function wireSales(v, sl, pct) {
    const f = document.getElementById("sale-form");
    const hint = document.getElementById("sale-hint");
    const fill = () => {
      const o = sl.options.find((x) => x.id === f.option_id.value);
      const plan = f.plan;
      if (o && o.kind === "immersion") plan.value = "full";
      plan.querySelector('[value="deposit"]').disabled = Boolean(o && o.kind === "immersion");
      if (!o) { hint.textContent = ""; return; }
      const amt = plan.value === "deposit" && pct ? Math.round((o.price_cents * pct) / 100) : o.price_cents;
      f.amount.value = dollars(amt);
      hint.textContent = plan.value === "deposit" ? `Ticket price ${money(o.price_cents)}; the balance of ${money(o.price_cents - amt, { cents: true })} will show as due.` : `Ticket price ${money(o.price_cents)}.`;
    };
    f.option_id.onchange = fill; f.plan.onchange = fill;
    f.addEventListener("input", () => (S.unsaved = true));
    f.onsubmit = (ev) => {
      ev.preventDefault();
      const amount = toCents(f.amount.value);
      if (!f.option_id.value) return toast("Choose a room or day immersion.", true);
      if (Number.isNaN(amount)) return toast("Enter a valid amount.", true);
      busy(f.querySelector("button[type=submit]"), async () => {
        await call("sale-save", { option_id: f.option_id.value, guest_name: f.guest_name.value, guest_email: f.guest_email.value, guest_phone: f.guest_phone.value,
          plan: f.plan.value, first_payment_cents: amount, paid_on: f.paid_on.value, notes: f.notes.value });
        S.unsaved = false; toast("Payment recorded."); vPayments(v);
      });
    };
    v.querySelectorAll("[data-sale]").forEach((card) => {
      const id = card.dataset.sale;
      const pf = card.querySelector(".pay-form");
      if (pf) pf.onsubmit = (ev) => {
        ev.preventDefault();
        const amount = toCents(pf.amount.value);
        if (!amount || Number.isNaN(amount)) return toast("Enter a valid amount.", true);
        busy(pf.querySelector("button[type=submit]"), async () => { await call("payment-add", { sale_id: id, amount_cents: amount, paid_on: pf.paid_on.value, kind: pf.kind.value, note: pf.note.value }); S.unsaved = false; toast(pf.kind.value === "refund" ? "Refund recorded." : "Payment recorded."); vPayments(v); });
      };
      card.querySelectorAll("[data-pdel]").forEach((b) => (b.onclick = async () => {
        if (await confirmBox("Remove this payment?", "Use this to correct a mistake. To record money returned to a guest, add a refund instead.", "Remove", true))
          busy(b, async () => { await call("payment-delete", { id: b.dataset.pdel }); vPayments(v); });
      }));
      const cb = card.querySelector("[data-cancel]");
      cb.onclick = async () => {
        const restore = cb.dataset.cancel === "restore";
        if (await confirmBox(restore ? "Restore this ticket?" : "Cancel this ticket?", restore ? "It will count as sold again." : "The ticket is freed for someone else. Payments stay on record; add a refund if money was returned.", restore ? "Restore" : "Cancel ticket", !restore))
          busy(cb, async () => { await call("sale-cancel", { id, restore }); vPayments(v); });
      };
    });
    document.getElementById("sales-csv").onclick = (e) => busy(e.target, async () => { const r = await call("sales-csv"); download(r.filename, r.csv); });
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

  function renderImm() {
    const box = document.getElementById("imm"); if (!box) return;
    const own = isOwner() ? "" : "disabled";
    box.innerHTML = S.imm.length ? S.imm.map((i, n) => `<div class="fgrid" style="margin-bottom:8px" data-m="${n}">
      <label>Name<input type="text" name="imm_name_${n}" data-k="name" value="${esc(i.name)}" ${own}></label>
      <label>Days<input type="number" name="imm_days_${n}" data-k="days" min="1" max="14" value="${i.days ?? ""}" ${own}></label>
      <label>Price<div class="money">$<input type="text" name="imm_price_${n}" data-k="price" inputmode="decimal" value="${dollars(i.price_cents)}" ${own}></div></label>
      <label>Early-bird price <span class="hint">(optional)</span><div class="money">$<input type="text" name="imm_eb_${n}" data-k="eb" inputmode="decimal" value="${dollars(i.early_bird_price_cents)}" ${own}></div></label>
      <label>Early bird ends <span class="hint">(last day)</span><input type="date" name="imm_ebend_${n}" data-k="ebend" value="${esc(i.early_bird_ends || "")}" ${own}></label>
      <label>Ticket limit <span class="hint">(blank = no limit; ${i.sold || 0} sold)</span><input type="number" name="imm_limit_${n}" data-k="limit" min="0" max="10000" value="${i.ticket_limit ?? ""}" ${own}></label>
      ${isOwner() ? `<div style="align-self:end"><button type="button" class="iconbtn" data-mrm="${n}">Remove</button></div>` : ""}</div>`).join("") : '<p class="small muted">No immersions yet.</p>';
    box.querySelectorAll("[data-m]").forEach((row) => row.querySelectorAll("[data-k]").forEach((inp) => (inp.oninput = () => {
      const it = S.imm[+row.dataset.m], k = inp.dataset.k;
      if (k === "price") it.price_cents = toCents(inp.value); else if (k === "eb") it.early_bird_price_cents = toCents(inp.value);
      else if (k === "ebend") it.early_bird_ends = inp.value || null;
      else if (k === "days" || k === "limit") it[k === "days" ? "days" : "ticket_limit"] = inp.value === "" ? null : Number(inp.value); else it[k] = inp.value;
    })));
    box.querySelectorAll("[data-mrm]").forEach((b) => (b.onclick = () => { S.imm.splice(+b.dataset.mrm, 1); S.unsaved = true; renderImm(); }));
  }

  // ---------- Content editing (Landing page) ----------
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
      if (a === "publish") { await save(); if (!(await confirmBox("Publish these changes?", "The public page will update right away.", "Publish"))) return rerender(); await call("content-publish"); await loadContent(); toast("Published."); rerender(); }
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

  // ---------- Landing page: every section, in the same order as the page ----------
  const PAGE_SECTIONS = ["Logo and header", "Hero and introduction", "What you’ll take home", "The Experience", "The grounds", "Investment", "Your Stay", "Day immersions (wording)", "Itinerary", "Meet Estar", "FAQs", "Testimonials and policies", "Contact", "Secure your spot and Book a call"];
  async function vPage(v, keep) {
    if (!keep) await loadContent();
    const y = window.scrollY;
    const own = isOwner() ? "" : "disabled";
    v.innerHTML = head("Landing page", "Every section of the public page, from top to bottom. Changes stay in draft until you publish; Preview shows the page with your draft.") + pubbar()
      + `<nav class="page-nav" aria-label="Page sections">${PAGE_SECTIONS.map((n, i) => `<button type="button" class="iconbtn" data-jump="pg-${i + 1}">${i + 1}. ${esc(n)}</button>`).join("")}</nav>
      <div class="panel" id="pg-1"><h2>Logo and header</h2><div class="fgrid">${F.text("brand.orgName", "Business name")}${F.text("brand.retreatName", "Retreat name")}${F.text("brand.logoAlt", "Logo description", { hint: "for screen readers" })}
        ${F.image("brand.logoUrl", "Logo (for light backgrounds)", "Shown in the header, beside the business name")}${F.image("brand.logoDarkUrl", "Logo (for dark backgrounds)", "Used in the footer")}
        <div class="wide">${F.bool("previewBanner", "Show the “awaiting approval” banner on the public page")}</div></div></div>
      <div class="panel" id="pg-2"><h2>Hero and introduction</h2><div class="fgrid">${F.text("hero.kicker", "Small line above the title")}${F.text("hero.title", "Hero title", { wide: true })}${F.text("hero.sub", "Supporting line", { wide: true })}
        ${F.text("hero.primaryLabel", "Main button")}${F.text("hero.secondaryLabel", "Second button")}
        ${F.image("hero.imageUrl", "Hero photo", "Approved retreat imagery, landscape")}${F.text("hero.imageAlt", "Hero photo description", { wide: true, hint: "for screen readers" })}${F.text("hero.videoUrl", "Hero video (optional)", { wide: true, hint: "/media/pond.mp4 or an https link to an approved .mp4. Visitors who prefer reduced motion see the hero photo instead, and everyone gets a pause button" })}${F.image("hero.videoPosterUrl", "Video still", "Shown for a moment while the video loads; use the video\u2019s first frame")}
        ${F.text("overview.heading", "Overview heading")}${F.text("overview.signoff", "Sign-off")}${F.text("overview.body", "Overview letter", { wide: true, area: true, rows: 6, hint: "Use “Eye” in Estar’s voice. Blank line = new paragraph" })}</div>
        <p class="small muted">Dates and location are set in Settings and appear only once marked confirmed.</p></div>
      <div class="panel" id="pg-3"><h2>What you’ll take home</h2><p class="small muted">Shown under the overview once it has at least one item.</p><div class="fgrid">${F.text("transformation.heading", "Heading")}${F.text("transformation.intro", "Introduction", { wide: true, area: true })}
        ${repeat("transformation.items", "Items", (p) => `${F.text(`${p}.title`, "Title")}${F.text(`${p}.text`, "Text", { wide: true, area: true, rows: 2 })}`, { id: "", title: "", text: "" }, "Add item")}</div></div>
      <div class="panel" id="pg-4"><h2>The Experience</h2><div class="fgrid">${F.text("experience.heading", "Heading")}${F.text("experience.welcomes", "Who the retreat welcomes", { wide: true, area: true })}${F.text("experience.participation", "Participation note", { wide: true, area: true, hint: "Keep: participation and touch are always optional" })}
        ${F.lines("experience.inclusions", "Included")}${F.lines("experience.exclusions", "Not included")}${F.text("experience.pendingNote", "Shown while no sessions are published", { wide: true })}
        ${F.text("experience.rhythm", "Pace of the days", { wide: true, area: true, hint: "Shown under the sessions. Leave blank to hide" })}
        ${repeat("experience.photos", "Photos", (p) => `${F.image(`${p}.url`, "Photo")}${F.text(`${p}.caption`, "Caption")}${F.text(`${p}.alt`, "Description for screen readers", { wide: true })}`, { id: "", url: "", caption: "", alt: "" }, "Add photo")}
        <p class="wide small muted">The first six photos make the gallery mosaic; all of them open in the photo viewer. The gallery is hidden when there are no photos.</p>
        ${repeat("experience.activities", "Sessions and rituals", (p, a) => `${F.text(`${p}.title`, "Title")}${F.text(`${p}.note`, "Note")}${F.text(`${p}.description`, "Description", { wide: true, area: true, rows: 2 })}
          ${a.reviewRequired ? `<div class="wide warn">Held back pending a separate safety and suitability review. It can’t be published until the owner records that the review is complete.</div>${F.bool(`${p}.reviewDone`, `Safety and suitability review completed${isOwner() ? "" : " (owner only)"}`, { dis: own })}` : ""}
          ${F.bool(`${p}.published`, "Publish (owner-approved, facilitators and delivery confirmed)")}`, { id: "", title: "", description: "", note: "", published: false }, "Add session")}</div></div>
      <div class="panel" id="pg-5"><h2>The grounds</h2><p class="small muted">The first six photos make the gallery mosaic; all of them open in the photo viewer. Use only photos approved for this retreat.</p><div class="fgrid">${F.text("grounds.heading", "Heading")}${F.text("grounds.intro", "Introduction", { wide: true, area: true })}
        ${repeat("grounds.photos", "Photos", (p) => `${F.image(`${p}.url`, "Photo")}${F.text(`${p}.caption`, "Caption")}${F.text(`${p}.alt`, "Description for screen readers", { wide: true })}`, { id: "", url: "", caption: "", alt: "" }, "Add photo")}</div></div>
      <div class="panel" id="pg-6"><h2>Investment</h2><p class="small muted">A short list of every room and immersion with its price, shown before Your Stay once it has a heading. Prices come from Tickets.</p><div class="fgrid">${F.text("investments.heading", "Heading", { hint: "Leave blank to hide the section" })}${F.text("investments.intro", "What every room includes", { wide: true, area: true })}${F.text("investments.paymentNote", "Deposit and payment plan", { wide: true, area: true })}</div></div>
      <div class="panel" id="pg-7"><h2>Your Stay</h2><div class="fgrid">${F.text("stay.heading", "Heading")}${F.text("stay.intro", "Introduction", { wide: true, area: true })}${F.text("stay.sharedNote", "Shared room note", { wide: true, area: true })}</div><p class="small muted">Room details, prices and photos are edited in Tickets.</p></div>
      <div class="panel" id="pg-8"><h2>Day immersions (wording)</h2><p class="small muted">The wording around the immersions. Their names, prices and ticket limits are set in Tickets.</p><div class="fgrid">${F.text("immersions.heading", "Heading")}${F.text("immersions.earlyBirdLabel", "Early-bird label")}${F.text("immersions.intro", "Introduction", { wide: true, area: true, rows: 2 })}${F.text("immersions.includes", "What’s included", { wide: true, area: true, rows: 2 })}${F.text("immersions.note", "Note", { wide: true })}${F.text("immersions.earlyBirdNote", "Early-bird note", { wide: true, area: true, rows: 2, hint: "Shown when an immersion has an early-bird price" })}</div></div>
      <div class="panel" id="pg-9"><h2>Itinerary</h2><div class="fgrid">${F.text("itinerary.heading", "Heading")}${F.text("itinerary.note", "Note shown above the schedule", { wide: true, area: true, rows: 2 })}
        ${repeat("itinerary.days", "Days", (p) => `${F.text(`${p}.label`, "Day label", { hint: "e.g. Day 1, or Friday, November 10" })}
          ${repeat(`${p}.sessions`, "Sessions", (sp) => `${F.text(`${sp}.time`, "Time", { hint: "e.g. 9:00 AM" })}${F.text(`${sp}.title`, "Session")}${F.text(`${sp}.description`, "Description", { wide: true, area: true, rows: 2 })}${F.bool(`${sp}.provisional`, "Provisional (shows a “Provisional” label)")}`, { id: "", time: "", title: "", description: "", provisional: true }, "Add session")}`,
          { id: "", label: "", sessions: [] }, "Add day")}</div></div>
      <div class="panel" id="pg-10"><h2>Meet Estar</h2><div class="fgrid">${F.text("host.heading", "Heading")}${F.text("host.name", "Name")}${F.text("host.title", "Title")}${F.image("host.photoUrl", "Photo")}${F.text("host.bio", "Approved biography", { wide: true, area: true, rows: 7 })}</div></div>
      <div class="panel" id="pg-11"><h2>FAQs</h2><div class="fgrid">${F.text("faqPage.heading", "Heading")}${F.text("faqPage.intro", "Line under the heading", { wide: true })}<p class="wide small muted">In an answer, a blank line starts a new paragraph, and lines starting with “* ” make a bulleted list.</p>${repeat("faqs", "Questions", (p) => `${F.text(`${p}.q`, "Question", { wide: true })}${F.text(`${p}.a`, "Answer", { wide: true, area: true })}`, { id: "", q: "", a: "" }, "Add question")}</div></div>
      <div class="panel" id="pg-12"><h2>Testimonials and policies</h2><div class="fgrid">${F.text("trust.heading", "Heading")}
        ${repeat("trust.testimonials", "Testimonials", (p) => `${F.text(`${p}.quote`, "Quote (exactly as approved)", { wide: true, area: true })}${F.text(`${p}.name`, "Name as she approved it")}${F.bool(`${p}.permission`, "We have her written permission")}${F.bool(`${p}.published`, "Publish (requires permission)")}`, { id: "", quote: "", name: "", permission: false, published: false }, "Add testimonial")}
        ${F.text("trust.policiesText", "Policies (privacy, refunds, conduct)", { wide: true, area: true, rows: 5, hint: "Text from the attorney" })}</div></div>
      <div class="panel" id="pg-13"><h2>Contact</h2><div class="fgrid">${F.text("contact.email", "Support email", { type: "email" })}${F.text("contact.phone", "Phone")}${F.text("contact.responseTime", "Response expectation", { hint: "e.g. We reply within 2 business days." })}
        <div class="wide">${F.bool("contact.verified", `These contact details are verified and can be shown${isOwner() ? "" : " (owner only)"}`, { dis: own })}</div></div></div>
      <div class="panel" id="pg-14"><h2>Secure your spot and Book a call</h2><p class="small muted">The section where guests choose a room or immersion and pay. Prices come from Tickets; where the button sends guests is set in Payments.</p><div class="fgrid">
        ${F.text("reserve.heading", "Heading")}${F.text("reserve.payLabel", "Payment button")}${F.text("reserve.intro", "Introduction", { wide: true, area: true, rows: 2 })}
        ${F.text("reserve.depositLabel", "Deposit option")}${F.text("reserve.fullLabel", "Pay in full option")}
        ${F.text("reserve.closedLabel", "Button while payments are closed")}${F.text("reserve.closedNote", "Note while payments are closed", { wide: true, area: true, rows: 2 })}
        <div class="wide"><h3>Book a call</h3></div>${F.text("reserve.callHeading", "Heading")}${F.text("reserve.callLabel", "Button")}${F.text("reserve.callText", "Text", { wide: true, area: true, rows: 2 })}
        ${F.text("reserve.callUrl", "Booking link", { wide: true, hint: "Your scheduling page, starting with https://. Leave blank to hide" })}</div></div>`;
    wireContent(v, (k) => vPage(v, k));
    v.querySelectorAll("[data-jump]").forEach((b) => (b.onclick = () => document.getElementById(b.dataset.jump).scrollIntoView({ block: "start" })));
    if (keep) window.scrollTo(0, y);
  }

  // ---------- Settings ----------
  async function vSettings(v) {
    const [rg, sl, ig, al] = await Promise.all([call("retreat-get"), call("staff-list"), call("integrations"), call("audit-list", {})]);
    const r = rg.retreat, own = isOwner() ? "" : "disabled";
    S.audit = al.rows;
    v.innerHTML = head("Settings", `Environment: ${esc(ig.environment)}`)
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

        </div>${isOwner() ? '<div><button class="btn btn-primary" type="submit">Save retreat details</button></div>' : ""}</form></div>
      <div class="panel"><h2>Staff access</h2><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Two-step sign-in</th><th>Last sign-in</th><th></th></tr></thead><tbody>
        ${sl.rows.map((a) => `<tr><td><span class="name">${esc(a.name)}</span><small>${esc(a.email)}</small>${a.active ? "" : tag("Deactivated", "bad")}${a.invite_expires ? `<small>Invitation pending until ${fmtDateTime(a.invite_expires)}</small>` : ""}</td>
          <td>${isOwner() ? `<select data-role="${esc(a.id)}" aria-label="Role for ${esc(a.name)}"><option value="owner" ${a.role === "owner" ? "selected" : ""}>Owner</option><option value="staff" ${a.role === "staff" ? "selected" : ""}>Staff</option></select>` : esc(a.role)}</td>
          <td>${a.totp_enabled ? tag("Authenticator app", "ok") : tag("Password", "ok")}</td><td>${a.last_login_at ? fmtDateTime(a.last_login_at) : "Never"}</td>
          <td>${isOwner() && a.id !== ME.id ? `<div class="row"><button class="iconbtn" data-active="${esc(a.id)}" data-on="${a.active ? 0 : 1}">${a.active ? "Deactivate" : "Reactivate"}</button>${a.totp_enabled ? `<button class="iconbtn" data-mfa="${esc(a.id)}">Remove authenticator app</button>` : ""}</div>` : ""}</td></tr>`).join("")}
        </tbody></table></div>
        ${isOwner() ? `<form class="form" id="inv-form" style="margin-top:14px" novalidate><h3>Invite someone</h3><div class="fgrid"><label>Name<input type="text" name="name" required></label><label>Email<input type="email" name="email" required></label><label>Role<select name="role"><option value="staff">Staff</option><option value="owner">Owner</option></select></label><div style="align-self:end"><button class="btn btn-primary" type="submit">Send invitation</button></div></div><p class="small muted" id="inv-link"></p></form>` : ""}
        <p class="small muted">Owners can change roles, payment settings, prices and sensitive configuration. Staff can manage the waiting list, clients, room descriptions and photos, content and email drafts.</p></div>
      ${OPEN ? '<div class="panel"><h2>Admin sign-in is off</h2><p class="small muted">Anyone who opens /admin/ can use the admin area as the owner, including guest details, prices and payment links. To require sign-in again, add ADMIN_REQUIRE_SIGNIN with the value true in Vercel (Settings, Environment Variables) and redeploy; you then sign in with ADMIN_EMAIL and ADMIN_PASSWORD.</p></div>' : `<div class="panel"><h2>Your sign-in</h2><p class="small muted">You sign in with your email and password${ME.authenticator ? ", then a code from your authenticator app" : ""}. The owner can always sign in with ADMIN_EMAIL and ADMIN_PASSWORD from Vercel; change ADMIN_PASSWORD there to change it.</p>
        ${ME.authenticator ? "" : '<button class="btn btn-outline" id="use-app">Optional: add an authenticator app</button>'}</div>`}
      <div class="panel"><h2>Integrations</h2><ul class="checklist">${ig.items.map((i) => `<li><span class="${i.ok ? "ok" : "no"}">${i.ok ? "✓" : "✕"}</span><span>${esc(i.name)}<br><small class="muted">${esc(i.detail)}</small></span></li>`).join("")}</ul></div>
      <div class="panel"><h2>Change history</h2><div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody id="audit-rows"></tbody></table></div>
        <button class="iconbtn" id="audit-more" style="margin-top:10px">Load older</button></div>`;
    renderAudit();
    const ua = document.getElementById("use-app"); if (ua) ua.onclick = () => enrollScreen();
    const rf = document.getElementById("ret-form");
    rf.addEventListener("input", () => (S.unsaved = true));
    rf.onsubmit = (ev) => {
      ev.preventDefault();
      const fd = new FormData(rf);
      const body = Object.fromEntries(fd);
      ["dates_confirmed", "venue_confirmed"].forEach((k) => (body[k] = rf[k].checked));
      busy(rf.querySelector("button[type=submit]"), async () => { await call("retreat-save", body); S.unsaved = false; toast("Retreat details saved."); vSettings(v); });
    };
    v.querySelectorAll("[data-role]").forEach((s) => (s.onchange = () => busy(null, async () => { const a = sl.rows.find((x) => x.id === s.dataset.role); await call("staff-update", { id: a.id, role: s.value, active: a.active }); toast("Role updated."); vSettings(v); })));
    v.querySelectorAll("[data-active]").forEach((b) => (b.onclick = () => busy(b, async () => { const a = sl.rows.find((x) => x.id === b.dataset.active); await call("staff-update", { id: a.id, role: a.role, active: b.dataset.on === "1" }); vSettings(v); })));
    v.querySelectorAll("[data-mfa]").forEach((b) => (b.onclick = async () => { if (await confirmBox("Remove their authenticator app?", "They’ll be signed out and will sign in with just their password at their next sign-in.", "Remove", true)) busy(b, async () => { await call("staff-reset-mfa", { id: b.dataset.mfa }); toast("Removed."); vSettings(v); }); }));
    const inv = document.getElementById("inv-form");
    if (inv) inv.onsubmit = (ev) => { ev.preventDefault(); busy(inv.querySelector("button"), async () => { const r = await call("staff-invite", Object.fromEntries(new FormData(inv))); document.getElementById("inv-link").innerHTML = `Invitation emailed. You can also share this private link (expires in 72 hours): <br><code>${esc(r.inviteUrl)}</code>`; toast("Invitation sent."); }); };
    document.getElementById("audit-more").onclick = (e) => busy(e.target, async () => { const last = S.audit[S.audit.length - 1]; if (!last) return; const r = await call("audit-list", { before: last.id }); S.audit.push(...r.rows); renderAudit(); if (!r.rows.length) e.target.hidden = true; });
  }
  function renderAudit() {
    const fmt = (o) => (o && Object.keys(o).length ? esc(JSON.stringify(o)).slice(0, 400) : "");
    document.getElementById("audit-rows").innerHTML = S.audit.map((a) => `<tr><td>${fmtDateTime(a.created_at)}</td><td>${esc(a.actor_label)}</td><td>${esc(a.action)}<small>${esc(a.entity || "")} ${esc(a.entity_id || "")}</small></td>
      <td>${a.before || a.after ? `<small>Before: ${fmt(a.before)}</small><small>After: ${fmt(a.after)}</small>` : ""}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">No changes yet.</td></tr>';
  }

  const VIEWS = { overview: vOverview, page: (v) => vPage(v), tickets: vTickets, payments: vPayments, settings: vSettings };
  boot();
})();
