// Guest portal: email one-time-code sign-in, then the guest's own records.
(() => {
  const { esc, mark, paras, money, fmtDate, api } = EG;
  const $ = (id) => document.getElementById(id);
  let email = "";
  let me = null;
  let resendTimer = null;

  const TABS = [
    ["retreat", "My Retreat"], ["stay", "My Stay"], ["payments", "Payments"], ["prepare", "Prepare"],
    ["itinerary", "Itinerary"], ["forms", "Forms"], ["support", "Support"],
  ];
  const LEAD = { waiting: "On the waiting list", invited: "On the waiting list (invited to the portal)", converted: "Reservation in progress", none: "Not on the waiting list yet" };
  const BOOK = { pending: "Reservation pending payment", confirmed: "Reservation confirmed" };

  function show(view) {
    $("auth").hidden = view !== "auth";
    $("portal").hidden = view !== "portal";
    $("loading").hidden = view !== "loading";
    $("signout").hidden = view !== "portal";
  }

  // ---------- Sign in ----------
  function startCountdown(sec = 45) {
    const btn = $("resend");
    clearInterval(resendTimer);
    let left = sec;
    btn.disabled = true;
    btn.textContent = `Send a new code (${left}s)`;
    resendTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) { clearInterval(resendTimer); btn.disabled = false; btn.textContent = "Send a new code"; return; }
      btn.textContent = `Send a new code (${left}s)`;
    }, 1000);
  }

  async function sendCode(form, errEl) {
    const btn = form.querySelector("button[type=submit]") || $("resend");
    errEl.textContent = "";
    btn.setAttribute("aria-busy", "true"); btn.disabled = true;
    try {
      const res = await api("/api/site?fn=auth-start", { email, name: $("start-form").name.value.trim() });
      $("verify-msg").innerHTML = `${esc(res.message)}<br><strong>${esc(email)}</strong>`;
      $("start-form").hidden = true;
      $("verify-form").hidden = false;
      $("verify-form").code.value = "";
      $("verify-form").code.focus();
      startCountdown();
    } catch (e) {
      errEl.textContent = e.message;
    } finally {
      btn.removeAttribute("aria-busy");
      if (btn.id !== "resend") btn.disabled = false;
    }
  }

  function wireAuth() {
    $("start-form").addEventListener("submit", (ev) => {
      ev.preventDefault();
      email = $("start-form").email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $("start-err").textContent = "Please check your email address."; $("start-form").email.setAttribute("aria-invalid", "true"); $("start-form").email.focus(); return; }
      $("start-form").email.setAttribute("aria-invalid", "false");
      sendCode($("start-form"), $("start-err"));
    });
    $("resend").addEventListener("click", () => sendCode($("verify-form"), $("verify-err")));
    $("change-email").addEventListener("click", () => {
      $("verify-form").hidden = true; $("start-form").hidden = false; $("start-form").email.focus();
    });
    $("verify-form").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = $("verify-form"), btn = f.querySelector("button[type=submit]");
      $("verify-err").textContent = "";
      const code = f.code.value.replace(/\D/g, "");
      if (code.length !== 6) { $("verify-err").textContent = "Enter the 6-digit code from your email."; f.code.focus(); return; }
      btn.disabled = true; btn.setAttribute("aria-busy", "true");
      try {
        await api("/api/site?fn=auth-verify", { email, code });
        await load();
      } catch (e) {
        $("verify-err").textContent = e.message;
        f.code.select();
      } finally { btn.disabled = false; btn.removeAttribute("aria-busy"); }
    });
    $("signout").addEventListener("click", async () => {
      try { await api("/api/site?fn=logout", {}); } catch {}
      me = null;
      $("start-form").hidden = false; $("verify-form").hidden = true;
      show("auth");
      $("start-form").email.focus();
    });
  }

  // ---------- Portal ----------
  function tabsHtml() {
    return TABS.map(([id, label], i) => `<button role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${label}</button>`).join("");
  }

  function selectTab(id, focus) {
    TABS.forEach(([t]) => {
      const on = t === id;
      const b = $(`tab-${t}`);
      b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
      $(`panel-${t}`).hidden = !on;
      if (on && focus) b.focus();
    });
    history.replaceState(null, "", `#${id}`);
  }

  function wireTabs() {
    const list = $("ptabs");
    list.addEventListener("click", (e) => { const b = e.target.closest("[role=tab]"); if (b) selectTab(b.id.slice(4)); });
    list.addEventListener("keydown", (e) => {
      const ids = TABS.map((t) => t[0]);
      const cur = ids.indexOf(document.activeElement.id.slice(4));
      if (cur < 0) return;
      let n = null;
      if (e.key === "ArrowRight") n = (cur + 1) % ids.length;
      if (e.key === "ArrowLeft") n = (cur - 1 + ids.length) % ids.length;
      if (e.key === "Home") n = 0;
      if (e.key === "End") n = ids.length - 1;
      if (n !== null) { e.preventDefault(); selectTab(ids[n], true); }
    });
  }

  const kv = (rows) => `<dl class="kv">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  const locked = (title, text) => `<div class="card locked"><div class="icon" aria-hidden="true">&#9675;</div><h3>${title}</h3><p class="muted">${text}</p></div>`;

  function roomOptions(selected) {
    const opts = [["undecided", "Not sure yet"], ["any", "Any room"], ...me.rooms.map((r) => [r.id, `${r.name} (${money(r.price_cents)}, ${r.basis})`])];
    return opts.map(([v, l]) => `<option value="${esc(v)}" ${v === (selected || "undecided") ? "selected" : ""}>${esc(l)}</option>`).join("");
  }

  function panelRetreat() {
    const r = me.retreat, w = me.waitlist, b = me.booking;
    const dates = r.dates ? esc(r.dates.end ? `${r.dates.start} to ${r.dates.end}` : r.dates.start) : '<span class="muted">To be announced</span>';
    const venue = r.venue ? esc([r.venue.name, r.venue.city].filter(Boolean).join(", ")) : '<span class="muted">To be announced</span>';
    let status, next;
    if (b) { status = BOOK[b.status] || b.status; next = b.status === "confirmed" ? "See Prepare for what to bring and how to arrive." : "Complete your payment to confirm your room."; }
    else if (w) { status = LEAD[w.status] || LEAD.waiting; next = r.reservationsOpen ? "Reservations are open. Watch your email for your invitation to reserve." : "We’ll email you when retreat details and reservations are ready. Nothing else is needed from you right now."; }
    else { status = LEAD.none; next = "Join the waiting list below to hear first when reservations open."; }
    const ann = me.portal.announcements || [];
    return `
      <div class="card lead">
        <div class="status-line"><span class="pill olive">${esc(status)}</span>${w && !b ? `<span class="muted">since ${fmtDate(w.created_at)}</span>` : ""}</div>
        <p><strong>Next step:</strong> ${esc(next)}</p>
        ${!b ? '<p class="muted" style="margin:0">Your email is verified, which lets you see your details here. This is not a reservation, and no payment has been taken.</p>' : ""}
      </div>
      ${!w && !b ? joinCard() : ""}
      <div class="card"><h3>Retreat details</h3>${kv([["Dates", dates], ["Nights", r.dates && r.dates.nights != null ? esc(r.dates.nights) : '<span class="muted">To be announced</span>'], ["Location", venue], r.privateAddress ? ["Address", esc(r.privateAddress)] : null])}</div>
      <div class="card"><h3>Updates</h3>${ann.length ? `<div class="stack">${ann.map((a) => `<div class="ann"><time>${esc(a.date || "")}</time><h4>${mark(a.title)}</h4>${paras(a.body)}</div>`).join("")}</div>` : '<p class="muted" style="margin:0">No updates yet. New announcements will appear here.</p>'}</div>`;
  }

  function joinCard() {
    return `<div class="card"><h3>Join the waiting list</h3>
      <form id="join-form" class="stack" novalidate>
        <label><span>Room preference <span class="req">(optional)</span></span><select name="room_pref">${roomOptions()}</select></label>
        <label><span>A short intention <span class="req">(optional)</span></span><textarea name="intention" maxlength="500" rows="3"></textarea></label>
        <p class="muted" style="font-size:14px;margin:0">${mark(me.waitlistText.privacyNotice)}</p>
        <label class="check"><input type="checkbox" name="marketing"><span>${mark(me.waitlistText.consentText)}</span></label>
        <p class="form-error" role="alert" id="join-err"></p>
        <div><button class="btn btn-primary" type="submit">Join the Waiting List</button></div>
      </form></div>`;
  }

  function panelStay() {
    const w = me.waitlist, b = me.booking;
    if (b) return `<div class="card lead"><h3>Your room</h3>${kv([["Room", esc(b.room || "")], ["Roommate preference", esc(b.roommate_pref || "None given")]])}</div>`;
    if (!w) return locked("No preferences yet", "Join the waiting list from My Retreat to share your room preference.");
    return `<div class="card lead"><h3>Your preferences</h3>
      <p class="muted">A room preference helps us plan. It is not a hold or a reservation.</p>
      <form id="pref-form" class="stack" novalidate>
        <label><span>Room preference</span><select name="room_pref">${roomOptions(w.room_pref)}</select></label>
        <label><span>Your intention <span class="req">(optional)</span></span><textarea name="intention" maxlength="500" rows="3">${esc(w.intention || "")}</textarea></label>
        <p class="form-error" role="alert" id="pref-err"></p>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><button class="btn btn-primary" type="submit">Save preferences</button><p class="saved" id="pref-ok" aria-live="polite"></p></div>
      </form></div>
      <div class="card"><h3>Rooms</h3><ul class="list-clean">${me.rooms.map((r) => `<li><strong>${esc(r.name)}</strong>: ${money(r.price_cents)} <span class="muted">(${esc(r.basis)}${r.occupancy_label ? `, ${esc(r.occupancy_label)}` : ""})</span></li>`).join("")}</ul>
      <p style="margin:12px 0 0"><a href="/#stay">See room details and photos</a></p></div>`;
  }

  function panelPayments() {
    const b = me.booking;
    if (!b) return `<div class="card lead"><h3>No payments</h3><p style="margin:0">Joining the waiting list is free. You haven’t been charged, and nothing is due. When reservations open, the full amount, any fees, refund terms and the payment schedule will be shown before you pay.</p></div>`;
    const paid = me.payments.filter((p) => p.status === "succeeded").reduce((n, p) => n + (p.kind === "refund" ? -p.amount_cents : p.amount_cents), 0);
    const due = me.obligations.filter((o) => ["due", "failed"].includes(o.status)).reduce((n, o) => n + o.amount_cents, 0);
    return `<div class="card lead"><h3>Summary</h3>${kv([["Package total", money(b.total_cents, { cents: true })], ["Paid so far", money(paid, { cents: true })], ["Remaining balance", money(due, { cents: true })]])}</div>
      <div class="card"><h3>Schedule</h3>${me.obligations.length ? `<ul class="list-clean">${me.obligations.map((o) => `<li><strong>${esc(o.label)}</strong>: ${money(o.amount_cents, { cents: true })} <span class="muted">due ${fmtDate(o.due_at)}, ${esc(o.status)}</span></li>`).join("")}</ul>` : '<p class="muted" style="margin:0">No scheduled payments.</p>'}</div>`;
  }

  function panelPrepare() {
    const p = me.portal;
    if (!p.prepareUnlocked) return locked("Opens after your reservation is confirmed", "Your packing list, arrival guidance and preparation materials will appear here once your room is confirmed.");
    return `<div class="card lead"><h3>What to bring</h3><ul class="list-clean">${(p.packingList || []).map((x) => `<li>${mark(x)}</li>`).join("")}</ul></div>
      <div class="card"><h3>Arriving</h3>${paras(p.arrivalGuidance)}${me.retreat.privateAddress ? `<p><strong>Address:</strong> ${esc(me.retreat.privateAddress)}</p>` : ""}</div>
      ${p.preparation ? `<div class="card"><h3>Preparing</h3>${paras(p.preparation)}</div>` : ""}`;
  }

  function panelItinerary() {
    const it = me.itinerary || {};
    return `<p class="notice">${mark(it.note || "")}</p>${(it.days || []).map((d) => `<div class="card"><h3>${mark(d.label)}</h3>${(d.sessions || []).map((s) => `<div class="session"><span class="time">${esc(s.time || "Time to be confirmed")}</span><div><h4>${mark(s.title)} ${s.provisional ? '<span class="pill">Provisional</span>' : ""}</h4>${s.description ? `<p class="muted" style="margin:0">${mark(s.description)}</p>` : ""}</div></div>`).join("")}</div>`).join("")}`;
  }

  function panelForms() {
    const label = { after_reservation: "Available after you reserve", not_started: "Not started", complete: "Complete" };
    return `<div class="card">${me.portal.forms.map((f) => `<div class="form-row"><div><strong>${esc(f.name)}</strong> ${f.required ? '<span class="pill line">Required</span>' : '<span class="pill line">Optional</span>'}<div class="muted" style="font-size:14.5px">${mark(f.description || "")}</div></div><span class="pill">${esc(label[f.status] || f.status)}</span></div>`).join("")}</div>`;
  }

  function panelSupport() {
    const c = me.contact;
    return `<div class="card lead"><h3>Get in touch</h3>${paras(me.portal.supportText)}
      ${c ? kv([c.email ? ["Email", `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`] : null, c.phone ? ["Phone", `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ""))}">${esc(c.phone)}</a>`] : null, c.responseTime ? ["Response time", esc(c.responseTime)] : null]) : '<p class="muted" style="margin:0">Our verified contact details will be listed here soon.</p>'}</div>
      <div class="card"><h3>Changing your email</h3><p style="margin:0">To change the email on your account, contact us from your current email address. We’ll confirm the change before updating it, and you’ll sign in with the new address afterwards.</p></div>`;
  }

  function renderPortal() {
    const name = me.profile.name ? me.profile.name.split(" ")[0] : "";
    $("p-welcome").textContent = name ? `Welcome, ${name}.` : (me.portal.welcome || "Welcome, sistar.");
    $("p-retreat").textContent = me.retreat.name;
    $("p-email").textContent = `Signed in as ${me.profile.email}`;
    $("ptabs").innerHTML = tabsHtml();
    const builders = { retreat: panelRetreat, stay: panelStay, payments: panelPayments, prepare: panelPrepare, itinerary: panelItinerary, forms: panelForms, support: panelSupport };
    $("panels").innerHTML = TABS.map(([id, label], i) => `<div class="panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" tabindex="0" ${i ? "hidden" : ""}><h2>${label}</h2>${builders[id]()}</div>`).join("");
    wireTabs();
    wirePanelForms();
    const want = location.hash.slice(1);
    if (TABS.some((t) => t[0] === want)) selectTab(want);
  }

  function wirePanelForms() {
    const pf = $("pref-form");
    if (pf) pf.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      $("pref-err").textContent = ""; $("pref-ok").textContent = "";
      const btn = pf.querySelector("button"); btn.disabled = true;
      try {
        await api("/api/site?fn=portal-update", { room_pref: pf.room_pref.value, intention: pf.intention.value.trim() });
        $("pref-ok").textContent = "Saved.";
        me.waitlist.room_pref = pf.room_pref.value; me.waitlist.intention = pf.intention.value.trim();
      } catch (e) { $("pref-err").textContent = e.message; } finally { btn.disabled = false; }
    });
    const jf = $("join-form");
    if (jf) jf.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      $("join-err").textContent = "";
      const btn = jf.querySelector("button"); btn.disabled = true;
      try {
        await api("/api/site?fn=portal-join", { room_pref: jf.room_pref.value, intention: jf.intention.value.trim(), marketing: jf.marketing.checked });
        await load();
      } catch (e) { $("join-err").textContent = e.message; btn.disabled = false; }
    });
  }

  async function load() {
    show("loading");
    try {
      me = await api("/api/site?fn=me");
      renderPortal();
      show("portal");
    } catch (e) {
      if (e.status === 401) { show("auth"); $("start-form").email.focus(); return; }
      $("loading").innerHTML = `<p class="notice" role="alert" style="margin:40px 0">${esc(e.message)}</p>`;
    }
  }

  wireAuth();
  load();
})();
