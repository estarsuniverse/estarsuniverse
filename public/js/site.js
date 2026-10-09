// Public retreat page: renders published content (or the draft, in admin preview).
(() => {
  const { esc, mark, paras, money, api } = EG;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const preview = params.get("preview") === "1";
  let formToken = "";
  let data;

  function brandHtml(b, dark) {
    const url = dark ? (b.logoDarkUrl || b.logoUrl) : b.logoUrl;
    if (url) return `<img src="${esc(url)}" alt="${esc(b.logoAlt || b.orgName)}">`;
    return `<span class="wordmark">${esc(b.orgName || "Empowered Wombman")}</span><span class="ph-tag" title="The real logo will replace this">Logo placeholder</span>`;
  }

  const tbd = (v, label = "To be confirmed") => (v ? mark(v) : `<span class="tbd">${label}</span>`);

  function render(d) {
    const s = d.site, r = d.retreat, b = s.brand || {};
    document.title = `${b.retreatName || r.name} | ${b.orgName || "Empowered Wombman"}`;
    if (preview || s.previewBanner) {
      $("preview-flag").hidden = false;
      $("preview-flag").innerHTML = preview
        ? "<strong>Draft preview.</strong> Only signed-in admins can see this version. Publish it from the admin area."
        : "<strong>Preview.</strong> Content on this page is awaiting approval. Highlighted text is a placeholder.";
    }
    $("brand").innerHTML = brandHtml(b, false);
    $("foot-brand").innerHTML = brandHtml(b, true);
    $("foot-tag").textContent = b.retreatName || "";

    // Hero
    const h = s.hero || {};
    $("hero-kicker").innerHTML = mark(h.kicker);
    $("hero-title").innerHTML = mark(h.title);
    $("hero-sub").innerHTML = mark(h.sub);
    $("hero-primary").textContent = h.primaryLabel || "Join the Waiting List";
    $("hero-secondary").textContent = h.secondaryLabel || "Explore the Experience";
    const when = [];
    when.push(r.dates ? esc(r.dates.end ? `${r.dates.start} to ${r.dates.end}` : r.dates.start) : "Dates to be announced");
    when.push(r.venue ? esc([r.venue.name, r.venue.city].filter(Boolean).join(", ")) : "Location to be announced");
    $("hero-when").innerHTML = when.map((w) => `<span>${w}</span>`).join('<span class="sep" aria-hidden="true"></span>');
    const hero = $("hero");
    if (h.videoUrl && !EG.reducedMotion()) {
      hero.classList.remove("no-media");
      const poster = h.videoPosterUrl || h.imageUrl;
      hero.insertAdjacentHTML("afterbegin", `<video class="hero-media" id="hero-video" autoplay muted loop playsinline preload="auto" aria-hidden="true" ${poster ? `poster="${esc(poster)}"` : ""}><source src="${esc(h.videoUrl)}" type="video/mp4">${h.videoWebmUrl ? `<source src="${esc(h.videoWebmUrl)}" type="video/webm">` : ""}</video>`);
      const vid = $("hero-video"), btn = $("hero-pause");
      btn.hidden = false;
      const setBtn = () => { const paused = vid.paused; btn.setAttribute("aria-pressed", String(paused)); btn.setAttribute("aria-label", paused ? "Play background video" : "Pause background video"); btn.innerHTML = paused ? "&#9654;" : "&#10074;&#10074;"; };
      btn.onclick = () => { vid.paused ? vid.play().catch(() => {}) : vid.pause(); };
      vid.addEventListener("play", setBtn); vid.addEventListener("pause", setBtn); setBtn();
    } else if (h.imageUrl) {
      hero.classList.remove("no-media");
      hero.insertAdjacentHTML("afterbegin", `<img class="hero-media" src="${esc(h.imageUrl)}" alt="${esc(h.imageAlt || "")}" fetchpriority="high">`);
    }

    // Overview
    const o = s.overview || {};
    $("ov-heading").innerHTML = mark(o.heading);
    $("ov-body").innerHTML = paras(o.body);
    $("ov-signoff").innerHTML = mark(o.signoff);
    const fact = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
    $("facts").innerHTML =
      fact("Dates", r.dates ? esc(r.dates.end ? `${r.dates.start} to ${r.dates.end}` : r.dates.start) : '<span class="tbd">To be announced</span>') +
      fact("Nights", r.dates && r.dates.nights != null ? esc(r.dates.nights) : '<span class="tbd">To be announced</span>') +
      fact("Location", r.venue ? esc([r.venue.name, r.venue.city].filter(Boolean).join(", ")) : '<span class="tbd">To be announced</span>') +
      fact("Rooms", r.reservationsOpen ? "Reservations are open" : "Not yet open. Join the waiting list to hear first.");

    // Grounds gallery
    const g = s.grounds || {};
    const photos = (g.photos || []).filter((p) => p.url);
    if (photos.length) {
      $("grounds").hidden = false;
      $("gr-heading").innerHTML = mark(g.heading || "The grounds");
      $("gr-intro").innerHTML = mark(g.intro);
      $("gr-grid").innerHTML = photos.slice(0, 6).map((p, i) => `<button type="button" data-lb="${i}" aria-label="Open photo: ${esc(p.caption || p.alt || "")}"><img src="${esc(p.url)}" alt="${esc(p.alt || "")}" loading="lazy">${p.caption ? `<span class="cap">${esc(p.caption)}</span>` : ""}</button>`).join("");
      const all = $("gr-all");
      if (photos.length > 6) { all.hidden = false; all.textContent = `See all ${photos.length} photos`; all.onclick = () => openLightbox(photos, 0); }
      document.querySelectorAll("[data-lb]").forEach((b) => (b.onclick = () => openLightbox(photos, +b.dataset.lb)));
    }

    // Experience
    const e = s.experience || {};
    $("exp-heading").innerHTML = mark(e.heading || "The Experience");
    $("exp-welcomes").innerHTML = paras(e.welcomes);
    $("exp-participation").innerHTML = mark(e.participation);
    $("exp-participation").hidden = !e.participation;
    $("exp-in").innerHTML = (e.inclusions || []).map((x) => `<li>${mark(x)}</li>`).join("") || '<li class="tbd">To be confirmed</li>';
    $("exp-out").innerHTML = (e.exclusions || []).map((x) => `<li>${mark(x)}</li>`).join("") || '<li class="tbd">To be confirmed</li>';
    const acts = e.activities || [];
    $("exp-activities").innerHTML = acts.length
      ? `<h3 style="margin-top:40px">Sessions and rituals</h3><div class="activities">${acts.map((a) => `<div class="activity"><h4>${mark(a.title)}</h4>${a.description ? `<p>${mark(a.description)}</p>` : ""}${a.note ? `<p><em>${mark(a.note)}</em></p>` : ""}</div>`).join("")}</div>`
      : `<p class="lede" style="margin-top:32px">${mark(e.pendingNote || "")}</p>`;

    // Stay
    const st = s.stay || {};
    $("stay-heading").innerHTML = mark(st.heading || "Your Stay");
    $("stay-intro").innerHTML = mark(st.intro);
    $("stay-shared").innerHTML = mark(st.sharedNote);
    $("stay-shared").hidden = !st.sharedNote;
    $("rooms").innerHTML = d.rooms.map(roomCard).join("");
    wireRooms();
    $("daypass").innerHTML = r.dayPass
      ? `<div class="terms-box"><h3>Day pass</h3><p><strong style="font-family:var(--serif);font-size:24px;font-weight:400">${money(r.dayPass.price_cents)}</strong> for a single day of the retreat, without lodging.</p></div>` : "";
    const t = r.terms;
    const termLabels = { deposit_text: "Deposit", installments_text: "Payment schedule", fees_text: "Fees", taxes_text: "Taxes", cancellation_text: "Cancellation", transfer_text: "Transfers", refund_text: "Refunds" };
    $("terms").innerHTML = t && Object.keys(t).length
      ? `<div class="terms-box"><h3>Package terms</h3><dl>${Object.entries(termLabels).filter(([k]) => t[k]).map(([k, l]) => `<dt>${l}</dt><dd>${mark(t[k])}</dd>`).join("")}</dl></div>` : "";

    // Itinerary
    const it = s.itinerary || {};
    $("it-heading").innerHTML = mark(it.heading || "Itinerary");
    $("it-note").innerHTML = mark(it.note);
    $("days").innerHTML = (it.days || []).map((day) => `<div class="day"><h3>${mark(day.label)}</h3>${(day.sessions || []).map((x) => `
      <div class="session"><span class="time">${esc(x.time || "Time to be confirmed")}</span><div><h4>${mark(x.title)} ${x.provisional ? '<span class="pill">Provisional</span>' : ""}</h4>${x.description ? `<p>${mark(x.description)}</p>` : ""}</div></div>`).join("")}</div>`).join("");

    // Host
    const ho = s.host || {};
    $("host-heading").innerHTML = mark(ho.heading || `Meet ${ho.name}`);
    $("tab-host").textContent = ho.heading || "Meet Estar";
    $("host-title").innerHTML = mark([ho.name, ho.title].filter(Boolean).join(", "));
    $("host-bio").innerHTML = paras(ho.bio);
    $("host-photo").innerHTML = ho.photoUrl ? `<img src="${esc(ho.photoUrl)}" alt="${esc(ho.name)}">` : "<span>Approved photo of Estar<br>coming soon</span>";

    // FAQs, trust, contact
    $("faq-list").innerHTML = (s.faqs || []).map((f) => `<details><summary>${mark(f.q)}</summary><div class="answer">${paras(f.a)}</div></details>`).join("");
    const tr = s.trust || {};
    const quotes = tr.testimonials || [];
    $("trust").innerHTML = (quotes.length ? `<h3 style="margin-top:48px">${mark(tr.heading || "Kind words")}</h3><div class="quotes">${quotes.map((q) => `<blockquote><p>“${mark(q.quote)}”</p><cite>${mark(q.name)}</cite></blockquote>`).join("")}</div>` : "")
      + (tr.policiesText ? `<div class="terms-box"><h3>Policies</h3>${paras(tr.policiesText)}</div>` : "");
    const c = s.contact || {};
    const contactBits = c.verified ? [c.email && `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`, c.phone && `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ""))}">${esc(c.phone)}</a>`].filter(Boolean) : [];
    $("contact-line").innerHTML = contactBits.length ? `Still have a question? Reach us at ${contactBits.join(" or ")}.${c.responseTime ? ` ${esc(c.responseTime)}` : ""}` : "";
    $("foot-links").innerHTML = [...contactBits, '<a href="/portal/">Guest Portal</a>', '<a href="#waitlist">Join the Waiting List</a>'].map((x) => `<span>${x}</span>`).join("");
    $("foot-fine").textContent = `© ${new Date().getFullYear()} ${b.orgName || "Empowered Wombman"}`;

    // Waiting list
    const w = s.waitlist || {};
    $("wl-heading").innerHTML = mark(w.heading || "Join the Waiting List");
    $("wl-intro").innerHTML = mark(w.intro);
    $("wl-privacy").innerHTML = mark(w.privacyNotice);
    $("wl-consent").innerHTML = mark(w.consentText);
    $("wl-done-msg").innerHTML = mark(w.successMessage);
    const sel = $("wl-room");
    sel.insertAdjacentHTML("beforeend", d.rooms.map((rm) => `<option value="${esc(rm.id)}">${esc(rm.name)} (${money(rm.price_cents)})</option>`).join(""));
    if (r.reservationsOpen) document.querySelector("#dock .dock-text").textContent = "Reservations are open";
  }

  function roomCard(rm) {
    const photos = rm.photos || [];
    const avail = rm.availability === "sold_out" ? '<span class="pill">Sold out</span>' : rm.availability === "open" ? '<span class="pill olive">Reservations open</span>' : '<span class="pill line">Waiting list open</span>';
    const cap = rm.guest_capacity ? `${rm.guest_capacity} ${rm.guest_capacity === 1 ? "guest" : "guests"}` : "";
    const adm = rm.includes_admission === "yes" ? "Includes retreat admission" : rm.includes_admission === "no" ? "Retreat admission is separate" : "";
    const row = (k, v, fallback) => `<div><dt>${k}</dt><dd>${v ? mark(v) : `<span class="tbd">${fallback || "To be confirmed"}</span>`}</dd></div>`;
    return `<article class="room" data-room="${esc(rm.id)}">
      <div class="room-photo">${photos.length ? `<img src="${esc(photos[0].url)}" alt="${esc(photos[0].alt || rm.name)}" loading="lazy">${photos.length > 1 ? `<span class="count">${photos.length} photos</span>` : ""}` : `<div class="nophoto">Real photos of this room<br>coming soon</div>`}</div>
      ${photos.length > 1 ? `<div class="room-thumbs">${photos.map((p, i) => `<button type="button" aria-pressed="${i === 0}" data-src="${esc(p.url)}" data-alt="${esc(p.alt || rm.name)}" aria-label="Show photo ${i + 1} of ${rm.name}"><img src="${esc(p.url)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
      <div class="room-body">
        <div class="room-head"><h3>${esc(rm.name)}</h3><div class="room-price"><strong>${money(rm.price_cents)}</strong><small>${esc(rm.price_basis_label)}${adm ? `. ${esc(adm)}` : ""}</small></div></div>
        <dl>
          ${row("Occupancy", rm.occupancy_label)}
          ${row("Guests", cap)}
          ${row("Beds", rm.beds)}
          ${row("Bathroom", rm.bathroom)}
          ${row("Privacy", rm.privacy)}
          ${row("Features", rm.features)}
          ${row("Accessibility", rm.accessibility)}
        </dl>
        ${rm.description ? `<div>${EG.paras(rm.description)}</div>` : ""}
        ${rm.difference_note ? `<p class="room-note">${mark(rm.difference_note)}</p>` : ""}
        <div class="room-foot">${avail}${rm.availability !== "sold_out" ? `<a class="btn btn-outline btn-small" href="#waitlist" data-pick="${esc(rm.id)}">Join the list for this room</a>` : ""}</div>
      </div>
    </article>`;
  }

  function wireRooms() {
    document.querySelectorAll(".room-thumbs button").forEach((btn) => btn.addEventListener("click", () => {
      const card = btn.closest(".room");
      const img = card.querySelector(".room-photo img");
      img.src = btn.dataset.src; img.alt = btn.dataset.alt;
      card.querySelectorAll(".room-thumbs button").forEach((x) => x.setAttribute("aria-pressed", String(x === btn)));
    }));
    document.querySelectorAll("[data-pick]").forEach((a) => a.addEventListener("click", () => { $("wl-room").value = a.dataset.pick; }));
  }

  // ---- Photo viewer ----
  let lb = { list: [], i: 0, opener: null };
  function showLb() {
    const p = lb.list[lb.i];
    $("lb-img").src = p.url; $("lb-img").alt = p.alt || "";
    $("lb-cap").textContent = p.caption || "";
    $("lb-count").textContent = `${lb.i + 1} of ${lb.list.length}`;
  }
  function openLightbox(list, i) {
    lb = { list, i, opener: document.activeElement };
    showLb();
    const d = $("lightbox");
    if (!d.open) d.showModal();
    $("lb-close").focus();
  }
  function wireLightbox() {
    const d = $("lightbox");
    const step = (n) => { lb.i = (lb.i + n + lb.list.length) % lb.list.length; showLb(); };
    $("lb-prev").onclick = () => step(-1);
    $("lb-next").onclick = () => step(1);
    $("lb-close").onclick = () => d.close();
    d.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") step(-1); if (e.key === "ArrowRight") step(1); });
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
    d.addEventListener("close", () => { if (lb.opener) lb.opener.focus(); });
  }

  // ---- Waiting list form ----
  function setFieldError(name, msg) {
    const input = document.querySelector(`#wl-form [name="${name}"]`);
    const out = $(`err-${name}`);
    if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
    if (out) out.textContent = msg || "";
  }

  function wireForm() {
    const form = $("wl-form"), btn = $("wl-submit");
    const ta = form.intention;
    ta.addEventListener("input", () => { $("wl-count").textContent = `${ta.value.length} / 500`; });
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      $("wl-error").textContent = "";
      setFieldError("name"); setFieldError("email");
      const name = form.name.value.trim(), email = form.email.value.trim();
      let bad = false;
      if (!name) { setFieldError("name", "Please enter your name."); bad = true; }
      if (!email) { setFieldError("email", "Please enter your email address."); bad = true; }
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setFieldError("email", "Please check your email address. It should look like name@example.com."); bad = true; }
      if (bad) { form.querySelector('[aria-invalid="true"]').focus(); return; }
      btn.disabled = true; btn.setAttribute("aria-busy", "true"); btn.textContent = "Joining…";
      const tags = {};
      ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"].forEach((k) => { if (params.get(k)) tags[k] = params.get(k); });
      try {
        const res = await api("/api/site?fn=waitlist", {
          name, email, room_pref: form.room_pref.value, intention: ta.value.trim(), marketing: form.marketing.checked,
          website: form.website.value, ft: formToken, tags, source: params.get("src") || "public_page",
        });
        $("wl-done-msg").innerHTML = mark(res.message);
        form.hidden = true;
        $("wl-done").hidden = false;
        $("wl-done").focus();
        document.body.classList.add("joined");
        $("dock").classList.remove("show");
        document.body.classList.remove("has-dock");
      } catch (e) {
        if (e.data && e.data.field) { setFieldError(e.data.field, e.message); form[e.data.field] && form[e.data.field].focus(); }
        else $("wl-error").textContent = e.message;
      } finally {
        btn.disabled = false; btn.removeAttribute("aria-busy"); btn.textContent = "Join the Waiting List";
      }
    });
  }

  // ---- Tabs and mobile dock ----
  function wireNav() {
    const links = [...document.querySelectorAll(".tabs a")];
    const ids = links.map((a) => a.getAttribute("href").slice(1));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((a) => a.setAttribute("aria-current", String(a.getAttribute("href") === `#${en.target.id}`)));
        const cur = links.find((a) => a.getAttribute("href") === `#${en.target.id}`);
        if (cur) cur.scrollIntoView({ block: "nearest", inline: "nearest", behavior: EG.reducedMotion() ? "auto" : "smooth" });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    ids.forEach((id) => { const el = $(id); if (el) io.observe(el); });

    const dock = $("dock");
    const hide = new Set();
    const dio = new IntersectionObserver((entries) => {
      entries.forEach((en) => (en.isIntersecting ? hide.add(en.target.id) : hide.delete(en.target.id)));
      const show = hide.size === 0 && !document.body.classList.contains("joined");
      dock.classList.toggle("show", show);
      document.body.classList.toggle("has-dock", !document.body.classList.contains("joined"));
    });
    ["hero", "waitlist"].forEach((id) => dio.observe($(id)));
  }

  async function load() {
    try {
      data = await api(`/api/site?fn=content${preview ? "&preview=1" : ""}`);
      formToken = data.formToken;
      render(data);
    } catch (e) {
      $("main").insertAdjacentHTML("afterbegin", `<div class="wrap" style="padding:24px 0"><p class="notice" role="alert">${esc(e.message)}</p></div>`);
    } finally {
      $("main").removeAttribute("aria-busy");
    }
    wireForm();
    wireNav();
    wireLightbox();
    if (location.hash && document.querySelector(location.hash)) document.querySelector(location.hash).scrollIntoView({ behavior: "instant" });
  }
  load();
})();
