// Public retreat page: renders published content (or the draft, in admin preview).
(() => {
  const { esc, mark, paras, money, api } = EG;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const preview = params.get("preview") === "1";
  let data;

  function brandHtml(b, dark) {
    const url = dark ? (b.logoDarkUrl || b.logoUrl) : b.logoUrl;
    // The logo is an emblem, so the name is written beside it (the image itself is decorative).
    if (url) return `<img class="logo-mark" src="${esc(url)}" alt=""><span class="wordmark">${esc(b.orgName || "Empowered Wombman")}</span>`;
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
    $("brand").classList.toggle("has-logo", Boolean(b.logoUrl));
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

    // What you'll take home (shown once it has items)
    const tf = s.transformation || {};
    const tfItems = (tf.items || []).filter((x) => x.title);
    if (tfItems.length) {
      $("transform").hidden = false;
      $("tf-heading").innerHTML = mark(tf.heading || "What you’ll take home");
      $("tf-intro").innerHTML = mark(tf.intro); $("tf-intro").hidden = !tf.intro;
      $("tf-items").innerHTML = tfItems.map((x) => `<div class="tf-item"><h3>${mark(x.title)}</h3>${x.text ? `<p>${mark(x.text)}</p>` : ""}</div>`).join("");
    }

    // Grounds gallery
    const g = s.grounds || {};
    if (gallery(g.photos, "gr-grid", "gr-all")) {
      $("grounds").hidden = false;
      $("gr-heading").innerHTML = mark(g.heading || "The grounds");
      $("gr-intro").innerHTML = mark(g.intro);
    }

    // Experience
    const e = s.experience || {};
    $("exp-heading").innerHTML = mark(e.heading || "The Experience");
    $("exp-welcomes").innerHTML = paras(e.welcomes);
    $("exp-participation").innerHTML = mark(e.participation);
    $("exp-participation").hidden = !e.participation;
    $("exp-gallery").hidden = !gallery(e.photos, "exp-grid", "exp-all");
    $("exp-in").innerHTML = (e.inclusions || []).map((x) => `<li>${mark(x)}</li>`).join("") || '<li class="tbd">To be confirmed</li>';
    $("exp-out").innerHTML = (e.exclusions || []).map((x) => `<li>${mark(x)}</li>`).join("") || '<li class="tbd">To be confirmed</li>';
    const acts = e.activities || [];
    $("exp-activities").innerHTML = acts.length
      ? `<h3 style="margin-top:40px">Sessions and rituals</h3><div class="activities">${acts.map((a) => `<div class="activity"><h4>${mark(a.title)}</h4>${a.description ? `<p>${mark(a.description)}</p>` : ""}${a.note ? `<p><em>${mark(a.note)}</em></p>` : ""}</div>`).join("")}</div>`
      : `<p class="lede" style="margin-top:32px">${mark(e.pendingNote || "")}</p>`;
    $("exp-rhythm").innerHTML = mark(e.rhythm); $("exp-rhythm").hidden = !e.rhythm;

    // Stay
    const st = s.stay || {};
    $("stay-heading").innerHTML = mark(st.heading || "Your Stay");
    $("stay-intro").innerHTML = mark(st.intro);
    $("stay-shared").innerHTML = mark(st.sharedNote);
    $("stay-shared").hidden = !st.sharedNote;
    $("rooms").innerHTML = d.rooms.map(roomCard).join("");
    wireRooms();
    // Investment summary (shown once it has a heading); day immersions sit there, or under the rooms without it.
    const inv = s.investments || {};
    const showInv = Boolean(inv.heading);
    $("investment").hidden = !showInv; $("tab-inv").hidden = !showInv;
    $(showInv ? "inv-immersions" : "daypass").innerHTML = immersionsHtml(r.immersions || [], s.immersions || {});
    if (showInv) {
      $("inv-heading").innerHTML = mark(inv.heading);
      $("inv-intro").innerHTML = mark(inv.intro); $("inv-intro").hidden = !inv.intro;
      $("inv-rooms").innerHTML = d.rooms.map((rm) => `<li><a href="#room-${esc(rm.id)}"><span class="inv-name">${esc(rm.name)}</span>
        <span class="inv-meta">${[rm.guest_capacity && `${rm.guest_capacity} ${rm.guest_capacity === 1 ? "guest" : "guests"}`, rm.beds].filter(Boolean).map(esc).join(" · ")}</span>
        <span class="inv-price">${money(rm.price_cents)} <small>${esc(rm.price_basis_label)}</small></span></a></li>`).join("");
      $("inv-pay").innerHTML = (inv.paymentNote ? `<p>${mark(inv.paymentNote)}</p>` : "")
        + '<a class="btn btn-primary" href="#reserve">Secure your spot</a>';
    }
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
    $("foot-links").innerHTML = [...contactBits, '<a href="/portal/">Guest Portal</a>', '<a href="#reserve">Secure your spot</a>'].map((x) => `<span>${x}</span>`).join("");
    $("foot-fine").textContent = `© ${new Date().getFullYear()} ${b.orgName || "Empowered Wombman"}`;

    // Reserve
    renderReserve(d);
    $("dock-text").textContent = r.reservationsOpen ? "Reservations are open" : "Reservations open soon";
  }

  function immersionsHtml(list, c) {
    if (!list.length) return "";
    return `<div class="immersions"><h3>${mark(c.heading || "Day immersions")}</h3>${c.intro ? `<p class="imm-intro">${mark(c.intro)}</p>` : ""}
      <div class="imm-grid">${list.map((i) => `<div class="imm-card"><h4>${esc(i.name)}</h4>
        <p class="imm-price"><strong>${money(i.price_cents)}</strong>${i.days ? ` <small>${i.days} ${i.days === 1 ? "day" : "days"}, per guest</small>` : ""}</p>
        ${i.early_bird_price_cents != null ? `<p class="imm-eb"><span class="pill olive">${esc(c.earlyBirdLabel || "Early bird")}</span> ${money(i.early_bird_price_cents)}</p>` : ""}</div>`).join("")}</div>
      ${c.includes ? `<p>${mark(c.includes)}</p>` : ""}${c.note ? `<p class="imm-note">${mark(c.note)}</p>` : ""}
      ${list.some((i) => i.early_bird_price_cents != null) && c.earlyBirdNote ? `<p class="imm-note">${mark(c.earlyBirdNote)}</p>` : ""}</div>`;
  }

  function roomCard(rm) {
    const photos = rm.photos || [];
    const avail = rm.availability === "sold_out" ? '<span class="pill">Sold out</span>' : rm.availability === "open" ? '<span class="pill olive">Available</span>' : '<span class="pill line">Opening soon</span>';
    const cap = rm.guest_capacity ? `${rm.guest_capacity} ${rm.guest_capacity === 1 ? "guest" : "guests"}` : "";
    const adm = rm.includes_admission === "yes" ? "Includes the full retreat experience" : rm.includes_admission === "no" ? "Retreat admission is separate" : "";
    const row = (k, v, fallback) => `<div><dt>${k}</dt><dd>${v ? mark(v) : `<span class="tbd">${fallback || "To be confirmed"}</span>`}</dd></div>`;
    return `<article class="room" id="room-${esc(rm.id)}" data-room="${esc(rm.id)}">
      <div class="room-photo">${photos.length ? `<img src="${esc(photos[0].url)}" alt="${esc(photos[0].alt || rm.name)}" loading="lazy">${photos.length > 1 ? `<span class="count">${photos.length} photos</span>` : ""}` : `<div class="nophoto">Real photos of this room<br>coming soon</div>`}</div>
      ${photos.length > 1 ? `<div class="room-thumbs">${photos.map((p, i) => `<button type="button" aria-pressed="${i === 0}" data-src="${esc(p.url)}" data-alt="${esc(p.alt || rm.name)}" aria-label="Show photo ${i + 1} of ${rm.name}"><img src="${esc(p.url)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
      <div class="room-body">
        <div class="room-head"><h3>${esc(rm.name)}</h3><div class="room-price"><strong>${money(rm.price_cents)}</strong><small>${esc(rm.price_basis_label)}${adm ? `. ${esc(adm)}` : ""}</small></div></div>
        <dl>
          ${row("Occupancy", rm.occupancy_label)}
          ${row("Guests", cap)}
          ${row("Beds", rm.beds)}
          ${row("Bathroom", rm.bathroom)}
          ${row("Features", rm.features)}
          ${row("Accessibility", rm.accessibility)}
        </dl>
        ${rm.description ? `<div>${EG.paras(rm.description)}</div>` : ""}
        ${rm.difference_note ? `<p class="room-note">${mark(rm.difference_note)}</p>` : ""}
        <div class="room-foot">${avail}${rm.availability !== "sold_out" ? `<a class="btn btn-outline btn-small" href="#reserve" data-pick="${esc(rm.id)}">Choose this room</a>` : ""}</div>
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
    document.querySelectorAll("[data-pick]").forEach((a) => a.addEventListener("click", () => {
      const o = rs.opts.find((x) => x.id === a.dataset.pick);
      if (o && !o.sold) selectOption(o.id);
    }));
  }

  // Photo mosaic: the first six photos, with "See all" opening the viewer. Returns false when there are none.
  function gallery(list, gridId, allId) {
    const photos = (list || []).filter((p) => p.url);
    if (!photos.length) return false;
    const grid = $(gridId);
    grid.innerHTML = photos.slice(0, 6).map((p, i) => `<button type="button" data-lb="${i}" aria-label="Open photo: ${esc(p.caption || p.alt || "")}"><img src="${esc(p.url)}" alt="${esc(p.alt || "")}" loading="lazy">${p.caption ? `<span class="cap">${esc(p.caption)}</span>` : ""}</button>`).join("");
    const all = $(allId);
    if (photos.length > 6) { all.hidden = false; all.textContent = `See all ${photos.length} photos`; all.onclick = () => openLightbox(photos, 0); }
    grid.querySelectorAll("[data-lb]").forEach((b) => (b.onclick = () => openLightbox(photos, +b.dataset.lb)));
    return true;
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
  // ---- Reserve: choose a room or immersion, then how to pay ----
  const rs = { opts: [], option: null, plan: null, r: null, c: {} };
  const guests = (n) => (n ? `${n} ${n === 1 ? "guest" : "guests"}` : "");

  function renderReserve(d) {
    const r = d.retreat, c = d.site.reserve || {};
    Object.assign(rs, { r, c });
    $("rs-heading").innerHTML = mark(c.heading || "Secure your spot");
    $("rs-intro").innerHTML = mark(c.intro); $("rs-intro").hidden = !c.intro;
    rs.opts = d.rooms.map((rm) => ({ id: rm.id, room: true, name: rm.name, price: rm.price_cents, early: null,
      meta: [guests(rm.guest_capacity), rm.beds].filter(Boolean).join(" · "), sold: rm.availability === "sold_out" }))
      .concat((r.immersions || []).map((i) => ({ id: i.id, room: false, name: i.name, price: i.price_cents, early: i.early_bird_price_cents,
        meta: `${i.days ? `${i.days} ${i.days === 1 ? "day" : "days"}, ` : ""}no overnight stay`, sold: false })));
    const opt = (o) => `<option value="${esc(o.id)}" ${o.sold ? "disabled" : ""}>${esc(o.name)} · ${o.sold ? "Sold out"
      : `${money(o.price)} per guest${o.early != null ? ` (early bird ${money(o.early)})` : ""}`}</option>`;
    const rooms = rs.opts.filter((o) => o.room), imms = rs.opts.filter((o) => !o.room);
    $("rs-option").insertAdjacentHTML("beforeend", `<optgroup label="Residential stays">${rooms.map(opt).join("")}</optgroup>`
      + (imms.length ? `<optgroup label="Day immersions">${imms.map(opt).join("")}</optgroup>` : ""));
    $("rs-option").onchange = (e) => selectOption(e.target.value);
    $("rs-closed").innerHTML = mark(c.closedNote); $("rs-closed").hidden = r.reservationsOpen || !c.closedNote;
    const call = c.callUrl && /^https?:\/\//.test(c.callUrl);
    $("rs-call").hidden = !call;
    if (call) {
      $("rs-call-heading").innerHTML = mark(c.callHeading || "Prefer to talk first?");
      $("rs-call-text").innerHTML = mark(c.callText); $("rs-call-text").hidden = !c.callText;
      $("rs-call-btn").textContent = c.callLabel || "Book a call"; $("rs-call-btn").href = c.callUrl;
    }
    updatePay();
  }

  function selectOption(id) {
    const o = rs.opts.find((x) => x.id === id);
    rs.option = o || null;
    $("rs-option").value = o ? o.id : "";
    $("rs-option-detail").textContent = o ? o.meta : ""; $("rs-option-detail").hidden = !o;
    $("rs-plan-step").hidden = !o;
    if (!o) return updatePay();
    const pct = rs.r.depositPercent;
    const plans = o.room && pct ? ["deposit", "full"] : ["full"];
    if (!plans.includes(rs.plan)) rs.plan = plans[0];
    const dep = Math.round((o.price * pct) / 100);
    const label = { deposit: rs.c.depositLabel || "Pay the deposit", full: rs.c.fullLabel || "Pay in full" };
    const amount = { deposit: money(dep), full: money(o.price) };
    rs.planNote = {
      deposit: `The balance of ${money(o.price - dep)} is paid in installments before the retreat.`,
      full: o.early != null ? `Early-bird price of ${money(o.early)} while it lasts.` : "",
    };
    $("rs-plan").innerHTML = plans.map((p) => `<option value="${p}" ${p === rs.plan ? "selected" : ""}>${esc(label[p])}${p === "deposit" ? ` (${pct}%)` : ""}: ${amount[p]}</option>`).join("");
    $("rs-plan").onchange = (e) => { rs.plan = e.target.value; updatePay(); };
    updatePay();
  }

  function updatePay() {
    const btn = $("rs-pay"), o = rs.option, open = rs.r && rs.r.reservationsOpen;
    const links = (rs.r && rs.r.payLinks) || {};
    const link = o ? ((links[o.id] || {})[rs.plan] || (o.room ? (links["*"] || {})[rs.plan] : "")) : "";
    $("rs-plan-detail").textContent = o ? rs.planNote[rs.plan] : ""; $("rs-plan-detail").hidden = !(o && rs.planNote[rs.plan]);
    if (!o) $("rs-summary").textContent = "Choose an option to see your total.";
    if (o) {
      const pct = rs.r.depositPercent, dep = Math.round((o.price * pct) / 100);
      $("rs-summary").innerHTML = `${esc(o.name)}: ${rs.plan === "deposit" ? `${money(dep)} deposit today` : `${money(o.price)} today`}, per guest.`;
    }
    const ready = Boolean(o && open && link);
    btn.setAttribute("aria-disabled", String(!ready));
    if (ready) btn.href = link; else btn.removeAttribute("href");
    btn.textContent = ready ? (rs.c.payLabel || "Secure your spot") : !open ? (rs.c.closedLabel || "Payments open soon") : o ? "Payment link coming soon" : (rs.c.payLabel || "Secure your spot");
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
        // Scroll only the tab strip sideways. scrollIntoView would also scroll the page and fight the visitor's own scrolling.
        const strip = cur && cur.closest("ul");
        if (strip) {
          const left = cur.offsetLeft - strip.offsetLeft, right = left + cur.offsetWidth;
          const to = left < strip.scrollLeft ? left : right > strip.scrollLeft + strip.clientWidth ? right - strip.clientWidth : null;
          if (to !== null) strip.scrollTo({ left: to, behavior: EG.reducedMotion() ? "auto" : "smooth" });
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    ids.forEach((id) => { const el = $(id); if (el) io.observe(el); });

    const dock = $("dock");
    const hide = new Set();
    const dio = new IntersectionObserver((entries) => {
      entries.forEach((en) => (en.isIntersecting ? hide.add(en.target.id) : hide.delete(en.target.id)));
      dock.classList.toggle("show", hide.size === 0);
      document.body.classList.add("has-dock");
    });
    ["hero", "reserve"].forEach((id) => dio.observe($(id)));
  }

  async function load() {
    try {
      data = await api(`/api/site?fn=content${preview ? "&preview=1" : ""}`);
      render(data);
    } catch (e) {
      $("main").insertAdjacentHTML("afterbegin", `<div class="wrap" style="padding:24px 0"><p class="notice" role="alert">${esc(e.message)}</p></div>`);
    } finally {
      $("main").removeAttribute("aria-busy");
    }
    wireNav();
    wireLightbox();
    if (location.hash && document.querySelector(location.hash)) document.querySelector(location.hash).scrollIntoView({ behavior: "instant" });
  }
  load();
})();
