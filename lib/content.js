// Draft and published site content, and what each audience is allowed to see.
const { one } = require("./db");

async function getSite(which = "published") {
  const row = await one("SELECT draft, published, published_at, draft_updated_at FROM content WHERE key = 'site'");
  return row ? row[which] : {};
}

// Public page: no portal-only material, only approved activities and permitted testimonials.
function publicView(site) {
  const s = JSON.parse(JSON.stringify(site || {}));
  delete s.portal;
  if (s.experience) {
    s.experience.activities = (s.experience.activities || [])
      .filter((a) => a.published && (!a.reviewRequired || a.reviewDone))
      .map(({ id, title, description, note }) => ({ id, title, description, note }));
  }
  if (s.trust) s.trust.testimonials = (s.trust.testimonials || []).filter((t) => t.permission && t.published).map(({ id, quote, name }) => ({ id, quote, name }));
  if (s.contact && !s.contact.verified) s.contact = { verified: false };
  return s;
}

module.exports = { getSite, publicView };
