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
  - Admins have named accounts with owner or staff roles. After their own password, they enter a shared admin code (`ADMIN_PASSWORD` in Vercel). Any admin can optionally switch to an authenticator app instead. Note: a password plus a shared code are both things you know, so this is lighter than true two-factor sign-in. Turning on authenticator apps is the stronger option before launch.
  - Every API action checks the session, the second sign-in step and the role on the server.
  - Portal data is always looked up from the signed-in guest's own account, never from an ID the browser sends.
  - Rate limits, spam checks and origin checks apply to every form.
  - Private pages carry `noindex`.
  - Logs never include personal data.
- **Change history.** Changes to prices, inventory, payment terms, content, staff access and email templates are recorded with who made them and when.

### Data model

| Table | Purpose |
| --- | --- |
| `retreats` | Dates, venue, timezone, payment terms, launch flags |
| `room_types` | Price (cents), price basis, capacity, beds, bathroom, privacy, photos |
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
6. **Add environment variables.** Go to Settings, then Environment Variables, and add the values listed in `.env.example`:
   - `APP_SECRET`
   - `SETUP_TOKEN`
   - `ADMIN_PASSWORD` (the admin code)
   - `RESEND_API_KEY`
   - `EMAIL_FROM`
   - `CRON_SECRET`
   - `SITE_URL`
7. **Deploy.** Then open `/admin/`, create the owner account using the `SETUP_TOKEN`, and enter the admin code (`ADMIN_PASSWORD`). Once the owner exists you can delete `SETUP_TOKEN`.
8. **Invite staff.** The owner invites staff from **Settings and Audit**. Each person sets their own password and uses the admin code to finish signing in. Share the code privately, and change `ADMIN_PASSWORD` (then redeploy) whenever someone leaves the team.
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
npm test             # 42 end-to-end acceptance checks
```

Local testing works like this:

- **Setup token:** `local-setup-token-123`
- **Admin code:** `local-admin-code-123`
- **Fake emails:** viewable at `/dev/outbox`
- **Simulated email outage:** turn it on with `/dev/email-fail?on=1`

The dev server is for local testing only. It is never deployed.

---

## Acceptance checks covered by `npm test`

| Area | What is checked |
| --- | --- |
| Rooms | All 7 room prices match the brief exactly. Price basis starts unconfirmed, and capacity is never inferred from occupancy labels |
| Public page | Unconfirmed dates and venue, unapproved activities (including yoni steaming) and portal-only content are not public |
| Waiting list | Useful field errors. Calm success. Exactly one confirmation email. Duplicates, including different-case emails, get the same message with no second row or email. Bot submissions are dropped quietly. Simultaneous duplicate submissions save once. Floods hit a rate limit. If email delivery fails, the sign-up is still saved and the email is queued for retry |
| Guest sign-in | Wrong codes are refused with tries remaining. Used codes can't be reused. Resend is limited. A verified guest sees her correct waiting-list status, with no reservation or address |
| Guest data | A second guest cannot read or change the first guest's records, even with extra IDs in the URL or request. Sign-out works. Cross-site form posts are blocked |
| Admin access | Unauthenticated requests are refused for every admin action. First-owner setup needs the setup token and can run only once. Data stays locked until the admin code is entered, and a password alone can't skip it or add an authenticator app. Once an admin turns on an authenticator app, the shared code no longer works for that account |
| Roles | Staff can't change prices, price basis, retreat settings, terms, staff, email approvals, client emails or inventory. The owner can |
| Change history | Price changes are recorded with the before and after values and who made the change |
| Paid launch | Blocked while dates, terms, price basis or inventory are unconfirmed. The Emerald and Obsidian difference is flagged |
| Content | Draft, preview and publish work. The yoni steaming item can't be published until the owner records the safety review. Testimonials need recorded permission. Unsafe links are rejected |
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
- **Venue photos.** The grounds gallery and hero use venue photos supplied by Jadon. Confirm they are approved for this retreat, since the brief requires approved imagery.
- **Room photos.** Every room needs real photos of that room.
- **Retreat details.** Dates, year, nights, venue and timezone (Settings and Audit). They show publicly only when marked confirmed.
- **Room details.** For each room:
  - price basis
  - whether admission is included
  - guest capacity
  - actual beds
  - bathroom
  - privacy
  - accessibility
  - inventory
  - Moonstone's features
  - sofa-bed capacity and privacy
  - the Emerald and Obsidian difference note
- **Payment terms.** Taxes, fees, deposit, installments, cancellation, transfer and refunds (Bookings and Payments).
- **Day pass.** Whether to sell one, and at what price.
- **Experience.** Which sessions to publish. Yoni steaming is held back pending a separate safety review.
- **Overview and bio.** Approved overview copy, who the retreat welcomes, inclusions and exclusions, and Estar's bio and photo.
- **FAQs.** Answers to all of them.
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
