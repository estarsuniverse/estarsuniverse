// Shared browser helpers (public page, portal, admin).
window.EG = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Highlights [placeholders] so reviewers can see what still needs real content.
  const mark = (s) => esc(s).replace(/\[([^\]]{1,300})\]/g, '<mark class="ph" title="Placeholder: needs approved content">[$1]</mark>');
  const paras = (s) => String(s || "").split(/\n{2,}/).filter((p) => p.trim()).map((p) => `<p>${mark(p).replace(/\n/g, "<br>")}</p>`).join("");
  const money = (c, opts = {}) => c == null ? "" : (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: opts.cents ? 2 : (c % 100 ? 2 : 0) });
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";

  async function api(url, body) {
    const opts = body === undefined
      ? { headers: { "X-Requested-With": "fetch" }, credentials: "same-origin" }
      : { method: "POST", headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" }, credentials: "same-origin", body: JSON.stringify(body) };
    let r;
    try { r = await fetch(url, opts); } catch { throw Object.assign(new Error("We couldn’t reach the server. Check your connection and try again."), { network: true }); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || "Something went wrong. Please try again."), { status: r.status, data });
    return data;
  }

  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return { esc, mark, paras, money, fmtDate, fmtDateTime, api, reducedMotion };
})();
