# Embodied Godis Retreat

The public retreat page, waiting list, guest portal and admin area for **Empowered Wombman**. It is hosted on Vercel and uses Postgres (through Vercel), Resend for email and, from Phase 2, Stripe.

This is **Phase 1** of the brief's build sequence:

- the branded public page
- room content you can edit
- a working waiting list
- verified guest sign-in
- a limited guest portal
- the staff dashboard

Paid reservations are built in Phase 2. They can only open after the launch checklist in the admin area is complete.

| Page | Address |
| --- | --- |
| Public retreat page | `/` |
| Draft preview (admins only) | `/?preview=1` |
| Guest portal | `/portal/` |
| Admin area | `/admin/` |

---

## How it is built

- **Plain JavaScript, no build step.** The pages in `public/` call three serverless functions:
  - `api/site.js` handles public pages and guests.
  - `api/admin.js` handles every admin action.
  - `api/cron.js` sends queued emails and cleans up old data.
- **Postgres.** Tables are created automatically from `migrations/` on first use. A fresh database is seeded with:
  - the retreat
  - the 7 rooms at the exact prices from the brief
  - draft content
  - email templates
- **Money** is stored as whole cents in USD. Each retreat has an explicit timezone. Every room, inventory unit and booking belongs to a retreat, so later seasonal events stay separate.
- **Security**
  - Guests sign in with a one-time code sent to their email. A name and email alone never unlock anything.
  - Admins sign in with an email and password. The owner's are `ADMIN_EMAIL` and `ADMIN_PASSWORD` in Vercel (the owner account is created on first sign-in, and those details always work for it). Staff are invited and choose their own password. Any admin can add an authenticator app as a second step, which is recommended before launch: with a password alone, anyone who learns it can sign in.
  - Every API action checks the session (and the authenticator step for admins who use one) and the role on the server.
  - Payment links (where **Secure your spot** goes) can only be changed by the owner, like prices.
  - Portal data is always looked up from the signed-in guest's own account, never from an ID the browser sends.
  - Rate limits, spam checks and origin checks apply to every form.
  - Private pages carry `noindex`.
  - Logs never include personal data.
- **Change history.** Changes to prices, inventory, payment terms, content, staff access and email templates are recorded with who made them and when.

### Data model

| Table | Purpose |
| --- | --- |
| `retreats` | Dates, venue, timezone, payment terms, launch flags |
| `room_types` | Price (cents), price basis, capacity, beds, bathroom, accessibility, photos |
| `inventory_units` | Each sellable room or bed space |
| `holds` | Expiring holds (Phase 2). A unique index allows one active hold per unit, so two buyers can never get the same unit |
| `waitlist_entries` | Name, email, room preference, intention, source, tags, consent version. Unique per retreat and email |
| `consent_events` | Every consent given or withdrawn, with version and source |
| `profiles`, `sessions`, `otp_codes` | Guest accounts and sign-in |
| `bookings`, `payment_obligations`, `transactions`, `webhook_events` | Phase 2 payments. Bookings keep a snapshot of the price and terms they were sold at |
| `form_submissions` | Guest forms (Phase 3) |
| `content`, `content_versions` | Draft and published site content, with history |
| `email_templates`, `email_jobs` | Templates, delivery queue, retries and history |
| `admins`, `audit_events` | Staff accounts and change history |

---

## Setting it up on Vercel

All accounts should be **owned by Empowered Wombman**, with collaborators added individually.

1. **Create the GitHub repository.** Make it under Empowered Wombman's GitHub account and push this folder to it.
2. **Import it into Vercel.** In Vercel, click Add New, then Project, and import the repository. No build settings are needed.
3. **Connect a database.** In the project's **Storage** tab, create a **Neon** Postgres database and connect it to the project. This adds `DATABASE_URL` automatically.
4. **Connect photo storage.** In the same **Storage** tab, create a **Blob** store and connect it. This adds `BLOB_READ_WRITE_TOKEN` automatically.
5. **Set up email.** In Resend:
   - Add and verify the sending domain (for example `empoweredwombman.com`) by adding the DNS records Resend shows.
   - Create an API key.
6. **Add environment variables.** Go to Settings, then Environment Variables, and add:
   - `APP_SECRET`
   - `ADMIN_EMAIL` (the owner's sign-in email)
   - `ADMIN_PASSWORD` (the owner's sign-in password, 8+ characters)
   - `ADMIN_NAME` (optional; the owner's name in the change history)
   - `RESEND_API_KEY`
   - `EMAIL_FROM`
   - `CRON_SECRET`
   - `SITE_URL`
7. **Deploy.** Then open `/admin/` and sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. To change the owner password, change `ADMIN_PASSWORD` in Vercel and redeploy. `SETUP_TOKEN` is no longer used and can be deleted.
8. **Invite staff.** The owner invites staff from **Settings and Audit**. Each person sets their own password. Deactivate them there when they leave the team.
9. **Check that everything is connected.** Open `/api/site?fn=health` on the live site. It lists each setting as present or missing, with how to fix it, and never shows the values. After you sign in, the **Integrations** list in Settings and Audit shows the same.

**Email retry schedule.** On Vercel's Hobby plan, scheduled jobs run once a day, so `vercel.json` sends retries daily. On the Pro plan, change the schedule to `*/15 * * * *` so failed emails retry every 15 minutes. Emails are also sent immediately when they are created, and staff can retry from **Communications** at any time.

**Commercial use.** Vercel's Hobby plan is for non-commercial use. Plan on Vercel Pro for the live site.

### Backups and restore

Neon keeps point-in-time history of the database, and you can restore to an earlier moment from the Neon console. The length of that history depends on the plan. For an extra copy, export a dump on a regular schedule with `pg_dump "$DATABASE_URL" > backup.sql`. You can also download waiting-list exports from the admin area at any time.

### Exporting data and revoking access

- **Waiting list.** Download it from **Waiting List**, then **Export CSV**.
- **Full data.** Use `pg_dump`, or Neon's export tools.
- **Staff access.** Remove it in **Settings and Audit** by deactivating the person. They are signed out immediately.
- **Account access.** Remove collaborator access in GitHub, Vercel, Neon, Resend and Stripe from each service's team settings.

---

## Running it locally

```bash
npm install
npm run dev          # http://localhost:3000 (in-memory Postgres, fake email)
npm test             # 48 end-to-end acceptance checks
```

Local testing works like this:

- **Admin sign-in:** `estar@example.com` with password `local-admin-password-123`
- **Fake emails:** viewable at `/dev/outbox`
- **Simulated email outage:** turn it on with `/dev/email-fail?on=1`

The dev server is for local testing only. It is never deployed.

---

## Acceptance checks covered by `npm test`

| Area | What is checked |
| --- | --- |
| Rooms | All 7 room prices are exact, with Emerald and Obsidian aligned at $2,799. Prices are per guest and include the full retreat experience, and each room's guest capacity matches the confirmed details (never inferred from occupancy labels) |
| Public page | The confirmed dates and venue are shown. Estar's seven experiences, her biography and the day immersions (standard and early-bird prices) are public. The Experience photos load and each has a description. Held-back sessions (such as yoni steaming) and portal-only content are not public |
| Waiting list (API and guest portal) | Useful field errors. A day immersion can be chosen instead of a room. Calm success. Exactly one confirmation email. Duplicates, including different-case emails, get the same message with no second row or email. Bot submissions are dropped quietly. Simultaneous duplicate submissions save once. Floods hit a rate limit. If email delivery fails, the sign-up is still saved and the email is queued for retry |
| Guest sign-in | Wrong codes are refused with tries remaining. Used codes can't be reused. Resend is limited. A verified guest sees her correct waiting-list status, with no reservation or address |
| Guest data | A second guest cannot read or change the first guest's records, even with extra IDs in the URL or request. Sign-out works. Cross-site form posts are blocked |
| Admin access | Unauthenticated requests are refused for every admin action. The owner signs in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`; wrong passwords, other emails and the old setup and admin-code steps are refused. Once an admin adds an authenticator app, sign-in also needs its code |
| Roles | Staff can't change prices, price basis, retreat settings, terms, staff, email approvals, client emails, inventory or payment links. The owner can |
| Change history | Price changes are recorded with the before and after values and who made the change. The confirmed-details migration is recorded |
| Paid launch | Dates and venue pass. Still blocked while payment terms or inventory are unconfirmed. Emerald and Obsidian share a price, so no difference note is needed. The 30% deposit is saved. Immersion early-bird prices must be below the standard price |
| Content | Draft, preview and publish work. The new page copy is in the draft only until published. A held-back session (such as yoni steaming) can't be published until the owner records the safety review. Testimonials need recorded permission. Unsafe links are rejected |
| Exports | CSV exports contain only permitted fields, and intentions and staff notes are never exported. The marketing export contains only people who opted in. Spreadsheet formula injection is blocked |
| Email | Failed emails are visible and can be retried. Unsubscribe links work, and forged links are refused. The scheduled job needs its secret |
| Staff | Deactivated staff are signed out immediately. The last owner can't be demoted |

Contrast was measured for every text and background pair; see the header of `public/css/base.css`. All pairs pass WCAG AA. The pages also have:

- keyboard-accessible tabs and photo viewer
- visible focus states
- labelled fields with inline errors
- loading states
- reduced-motion support (the hero video is not played for visitors who prefer reduced motion, and everyone else gets a pause button)

---

## Remaining placeholders and decisions

All of these can be edited in the admin area. Text in `[square brackets]` is highlighted on the preview page until it's replaced.

- **Logo.** A text wordmark marked "Logo placeholder" is shown until the logo is uploaded in **Content and Branding**.
- **Hero video.** The pond video (`public/media/pond.mp4`, with a WebM backup) plays in the header, with a pause button. Visitors who prefer reduced motion see the aerial photo instead. The video's first frame shows the entry gate, which has lettering on it. Confirm with Estar that she's comfortable showing it.
- ~~**Venue photos.**~~ **Done:** the venue photos in the grounds gallery and hero are approved for this retreat.
- **Room photos.** Sapphire, Tiger’s Eye, Emerald, Obsidian and Moonstone have photos cropped from the Peace on the Pond suites flyer (`public/media/rooms/`, `migrations/006_room_photos.sql`). Tiger’s Eye is the flyer’s Sunstone suite. Three of its four photos are now the full-size originals from peaceonthepond.com; the site has no photos of the other rooms, so their flyer crops are small and should be replaced with full-size originals in Rooms and Inventory when available. Emerald and Moonstone also show the downstairs kitchenette (`migrations/008_downstairs_kitchenette_photo.sql`). The sofa beds show the downstairs living area, kitchenette and balcony with a jacuzzi, and Moonstone also shows the balcony (`migrations/011_downstairs_photos.sql`). Emerald and Moonstone also show the downstairs living area (`migrations/012_downstairs_living_photo.sql`).
- ~~**Retreat details.** Dates, year, nights and venue.~~ **Done:** March 6 to 10, 2027 (4 nights) at Peace on the Pond, Douglasville, Georgia (`migrations/002_confirmed_details.sql`). The timezone stays America/New_York; change it in Settings and Audit if needed.
- ~~**Price basis.**~~ **Done:** every room is priced per guest.
- ~~**Guest capacities.**~~ **Done:** Sapphire 1, Tiger’s Eye 2, Emerald 2, Obsidian 2, Moonstone 3, each sofa bed 1. No one shares a bed (`migrations/009_separate_beds.sql`).
- ~~**Event photos.**~~ **Done:** ten photos from Estar’s past gatherings are in The Experience gallery (`public/media/events/`, `migrations/003_event_photos.sql`). Edit them in Content and Branding, then The Experience, then Photos. Confirm everyone pictured has agreed to appear on the site.
- ~~**Beds, bathrooms and accessibility.**~~ **Done** (`migrations/007_room_beds_bathrooms.sql`; the sofa beds share Moonstone’s bathroom, `migrations/010_downstairs_bathroom_balcony.sql`). Room privacy is no longer shown.
- ~~**Admission and Emerald/Obsidian pricing.**~~ **Done:** every room price includes the complete retreat experience, and Obsidian matches Emerald at $2,799 (`migrations/013_estar_confirmed_offer.sql`).
- **Room inventory.** Confirm the sellable units for each room (Rooms and Inventory).
- **Reserve and payment.** The public page now has a **Reserve** section in place of the waiting-list form: guests choose a room or day immersion, then the 30% deposit or pay in full (immersions are pay in full), and **Secure your spot** goes to the payment link the owner sets in Bookings and Payments. It works only once reservations are open, which needs every launch checklist item, including a payment link for every option. Still needed: the payment links, and the **Book a call** link (Content and Branding, Reserve and Book a call). Paid rooms must be marked sold in Rooms and Inventory, because the outside payment site can't do that.
- **Payment terms.** Agreed so far and saved in Bookings and Payments: a 30% nonrefundable deposit, the balance in installments, transfers considered with advance notice and approval. Still needed before reservations open: installment deadlines, cancellation windows, refund terms, taxes and fees. Then mark the terms approved.
- ~~**Day immersions.**~~ **Done:** One-Day $444 and Two-Day $666, with early-bird prices of $333 and $555 (Settings and Audit). Still needed: the early-bird deadline or number of spots.
- ~~**Experience.**~~ **Done:** Estar's seven experiences are published. The schedule and specific ceremonies are still to be finalized in the itinerary.
- **Overview and copy.** New copy in Estar's voice is in the **draft** for her approval (`migrations/014_draft_copy.sql`): the overview letter, who the retreat welcomes, "What you'll take home", "Your investment" and a note on the pace of the days. Preview it at `/?preview=1` and publish from Content and Branding. Exclusions are still a placeholder.
- **Bio and portrait.** ~~Bio~~ **done**. Estar will send her official logo and a professional portrait.
- **FAQs.** Payments, cancellation, meals and day immersions are answered. Arrival and departure, transport, dietary needs, accessibility, room sharing and packing still need answers.
- **Testimonials.** Approved testimonials with written permission.
- **Contact.** The verified support email, phone and response time.
- **Legal text.** Privacy policy, agreement and policy text from the attorney.
- **Email templates.** Approval of every template. Booking, receipt, reminder, preparation and itinerary emails start turned off.
- **Payment provider.** Final confirmation of the provider (Stripe is the candidate).
- **GoHighLevel.** Access to GoHighLevel, if it will be used. Until then, use the CSV exports.

## Monthly service costs (approximate; check current pricing)

| Service | Plan | Approximate cost |
| --- | --- | --- |
| Vercel | Pro (required for commercial use) | About $20 per team member per month |
| Neon Postgres (through Vercel) | Free tier to start; paid from about $19 per month if usage grows | $0 to $19 |
| Vercel Blob | Usage-based. Included allowance on Pro | Usually $0 to a few dollars |
| Resend | Free up to about 3,000 emails per month; then about $20 per month | $0 to $20 |
| Stripe (Phase 2) | No monthly fee. About 2.9% + 30¢ per US card payment | Per transaction |

---

## What comes next

**Phase 2: paid reservations.** This starts after the checklist is complete and the terms are approved. It adds:

- Stripe Checkout with signature-verified webhooks
- idempotent event handling, including duplicate and out-of-order events
- expiring inventory holds, so two buyers can never reserve the same unit
- bookings that keep a snapshot of the price and terms they were sold at
- installment obligations
- receipts and refunds
- a "needs review" queue for payments that can't be matched

**Phase 3.** Online guest forms with protected private uploads, itinerary-change notices, consent-based campaigns, a GoHighLevel adapter (if access is approved) and reporting.
