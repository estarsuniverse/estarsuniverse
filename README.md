# Embodied Godis Retreat

The public retreat landing page and admin area for **Empowered Wombman**. It is hosted on Vercel and uses Postgres (through Vercel).

- **The landing page** tells the story of the retreat and ends with **Secure your spot**: guests choose a room or day immersion, then the deposit or pay in full, and the button takes them to the payment link set in the admin.
- **The admin** mirrors the page: **Landing page** (every section, in page order), **Tickets** (rooms and day immersions; one ticket per guest), **Payments** (record each guest's payment and installments, balances, payment links and terms) and **Settings**. See `ADMIN_GUIDE.md`.

Payments are taken on an outside payment site. Recording them in the admin keeps tickets sold, sold-out status and balances up to date. The waiting list and guest portal from the first version have been retired (their records stay in the database).

| Page | Address |
| --- | --- |
| Public retreat page | `/` |
| Draft preview | `/?preview=1` |
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
- **Money** is stored as whole cents in USD. Each retreat has an explicit timezone. Every room, ticket sale and payment belongs to a retreat, so later seasonal events stay separate.
- **Security**
  - **Admin sign-in is currently off** (the owner's choice): anyone who opens `/admin/` can use the admin area as the owner, including guest details, prices and payment links. To require sign-in, add `ADMIN_REQUIRE_SIGNIN` = `true` in Vercel and redeploy. With it on, admins sign in with an email and password. The owner's are `ADMIN_EMAIL` and `ADMIN_PASSWORD` in Vercel (the owner account is created on first sign-in, and those details always work for it). Staff are invited and choose their own password. Any admin can add an authenticator app as a second step, which is recommended before launch: with a password alone, anyone who learns it can sign in.
  - Every API action checks the session (and the authenticator step for admins who use one) and the role on the server.
  - Payment links (where **Secure your spot** goes) can only be changed by the owner, like prices.
  - Rate limits, spam checks and origin checks apply to every form.
  - Private pages carry `noindex`.
  - Logs never include personal data.
- **Change history.** Changes to prices, tickets, payment links, payment terms, recorded payments, content and staff access are recorded with who made them and when.

### Data model

| Table | Purpose |
| --- | --- |
| `retreats` | Dates, venue, timezone, payment terms, launch flags |
| `room_types` | Price (cents), price basis, capacity, beds, bathroom, accessibility, photos |
| `ticket_sales` | One ticket for one guest: the room or day immersion, the guest's name and contact, deposit or paid in full, the price as sold, and active or canceled |
| `ticket_payments` | Each payment or refund toward a ticket, with its date; balances are the price less these |
| `sessions` | Admin sign-in sessions |
| `inventory_units`, `holds`, `waitlist_entries`, `consent_events`, `profiles`, `otp_codes`, `bookings`, `payment_obligations`, `transactions`, `webhook_events`, `form_submissions` | Retired with the waiting list, guest portal and built-in checkout; kept so earlier records are preserved |
| `content`, `content_versions` | Draft and published site content, with history |
| `email_templates`, `email_jobs` | Email templates and history from the waiting list (no longer sent) |
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
7. **Deploy.** Then open `/admin/`. Sign-in is off by default; with `ADMIN_REQUIRE_SIGNIN` set to `true`, sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`. To change the owner password, change `ADMIN_PASSWORD` in Vercel and redeploy. `SETUP_TOKEN` is no longer used and can be deleted.
8. **Invite staff.** The owner invites staff from **Settings**. Each person sets their own password. Deactivate them there when they leave the team.
9. **Check that everything is connected.** Open `/api/site?fn=health` on the live site. It lists each setting as present or missing, with how to fix it, and never shows the values. After you sign in, the **Integrations** list in Settings shows the same.

**Email retry schedule.** On Vercel's Hobby plan, scheduled jobs run once a day, so `vercel.json` sends retries daily. On the Pro plan, change the schedule to `*/15 * * * *` so failed emails retry every 15 minutes. Emails are also sent immediately when they are created, and staff can retry from **Communications** at any time.

**Commercial use.** Vercel's Hobby plan is for non-commercial use. Plan on Vercel Pro for the live site.

### Backups and restore

Neon keeps point-in-time history of the database, and you can restore to an earlier moment from the Neon console. The length of that history depends on the plan. For an extra copy, export a dump on a regular schedule with `pg_dump "$DATABASE_URL" > backup.sql`. You can also download the ticket sales from **Payments**, then **Export CSV**, at any time.

### Exporting data and revoking access

- **Ticket sales.** Download them from **Payments**, then **Export CSV**.
- **Full data.** Use `pg_dump`, or Neon's export tools.
- **Staff access.** Remove it in **Settings** by deactivating the person. They are signed out immediately.
- **Account access.** Remove collaborator access in GitHub, Vercel, Neon, Resend and Stripe from each service's team settings.

---

## Running it locally

```bash
npm install
npm run dev          # http://localhost:3000 (in-memory Postgres, fake email)
npm test             # 37 end-to-end acceptance checks
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
| Rooms | The 5 offered room prices are exact, with Emerald and Obsidian aligned at $2,799. Prices are per guest and include the full retreat experience, and each room's tickets (guests) match the confirmed details |
| Public page | The confirmed dates and venue are shown. Estar's seven experiences, her biography, portrait, logos and the day immersions (standard and early-bird prices) are public. The Experience photos load and each has a description. Held-back sessions (such as yoni steaming) are not public. The waiting list and guest portal are gone |
| Admin access | Unauthenticated requests are refused for every admin action. The owner signs in with `ADMIN_EMAIL` and `ADMIN_PASSWORD`; wrong passwords, other emails and the old setup and admin-code steps are refused. Once an admin adds an authenticator app, sign-in also needs its code |
| Roles | Staff can't change prices, price basis, tickets, day immersions, retreat settings, terms, staff, payment links or delete rooms. The owner can. Cross-site requests are blocked |
| Change history | Price changes are recorded with the before and after values and who made the change. The confirmed-details migration is recorded |
| Turning payments on | Blocked until dates, venue, terms, legal text, contact and a payment link for every option are in place; rooms need no inventory. Emerald and Obsidian share a price, so no difference note is needed. The 30% deposit is saved. Immersion early-bird prices must be below the standard price |
| Content | Draft, preview and publish work. The new page copy is in the draft only until published. A held-back session (such as yoni steaming) can't be published until the owner records the safety review. Testimonials need recorded permission. Unsafe links are rejected |
| Tickets and payments | Recording a payment sells a ticket, and a room sells out at its guest count (shown on the page) and can't be oversold. Installments and refunds update the balance, and overpaying is refused. Canceling frees a ticket. Day immersions are paid in full and sell out at their ticket limit. The sales CSV lists guests and balances and blocks spreadsheet formula injection. Unsubscribe links in earlier emails still work. The scheduled job needs its secret |
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

- ~~**Logo.**~~ **Done:** the Empowered Wombman emblem (`public/media/brand/`): the light-background version in the header, the black version in the footer, and the emblem as the browser tab icon, each beside the name (`migrations/018_logos_and_portrait.sql`). Replace them in **Landing page**.
- **Hero video.** The pond video (`public/media/pond.mp4`, with a WebM backup) plays in the header, with a pause button. Visitors who prefer reduced motion see the aerial photo instead. The video's first frame shows the entry gate, which has lettering on it. Confirm with Estar that she's comfortable showing it.
- ~~**Venue photos.**~~ **Done:** the venue photos in the grounds gallery and hero are approved for this retreat.
- **Room photos.** Sapphire, Tiger’s Eye, Emerald, Obsidian and Moonstone have photos cropped from the Peace on the Pond suites flyer (`public/media/rooms/`, `migrations/006_room_photos.sql`). Tiger’s Eye is the flyer’s Sunstone suite. Three of its four photos are now the full-size originals from peaceonthepond.com; the site has no photos of the other rooms, so their flyer crops are small and should be replaced with full-size originals in Tickets when available. Emerald and Moonstone also show the downstairs kitchenette (`migrations/008_downstairs_kitchenette_photo.sql`). The sofa beds show the downstairs living area, kitchenette and balcony with a jacuzzi, and Moonstone also shows the balcony (`migrations/011_downstairs_photos.sql`). Emerald and Moonstone also show the downstairs living area (`migrations/012_downstairs_living_photo.sql`).
- ~~**Retreat details.** Dates, year, nights and venue.~~ **Done:** March 6 to 10, 2027 (4 nights) at Peace on the Pond, Douglasville, Georgia (`migrations/002_confirmed_details.sql`). The timezone stays America/New_York; change it in Settings if needed.
- ~~**Price basis.**~~ **Done:** every room is priced per guest.
- ~~**Guest capacities.**~~ **Done:** Sapphire 1, Tiger’s Eye 2, Emerald 2, Obsidian 2, Moonstone 3, each sofa bed 1. No one shares a bed (`migrations/009_separate_beds.sql`).
- ~~**Event photos.**~~ **Done:** ten photos from Estar’s past gatherings are in The Experience gallery (`public/media/events/`, `migrations/003_event_photos.sql`). Edit them in Landing page, then The Experience, then Photos. Confirm everyone pictured has agreed to appear on the site.
- ~~**Beds, bathrooms and accessibility.**~~ **Done** (`migrations/007_room_beds_bathrooms.sql`; the sofa beds share Moonstone’s bathroom, `migrations/010_downstairs_bathroom_balcony.sql`). Room privacy is no longer shown.
- **Sofa beds.** The two downstairs queen sofa beds are no longer offered: they're hidden from the public page (`migrations/017_hide_sofa_beds.sql`) but kept in Tickets. Turn **visible** back on there to offer them again.
- ~~**Admission and Emerald/Obsidian pricing.**~~ **Done:** every room price includes the complete retreat experience, and Obsidian matches Emerald at $2,799 (`migrations/013_estar_confirmed_offer.sql`).
- **Secure your spot.** Guests pick a room or day immersion from a dropdown, then the 30% deposit or pay in full (immersions are pay in full), and the **Secure your spot** button goes to the payment link set in **Payments**. It works only once payments are turned on, which needs every checklist item, including a payment link for every option. Still needed: the payment links, and the **Book a call** link (Landing page, section 14). When a guest pays, record it in **Payments** so their ticket counts as sold.
- **Payment terms.** Agreed so far and saved in Payments: a 30% nonrefundable deposit, the balance in installments, transfers considered with advance notice and approval. Still needed before payments are turned on: installment deadlines, cancellation windows, refund terms, taxes and fees. Then mark the terms approved.
- ~~**Day immersions.**~~ **Done:** One-Day $444 and Two-Day $666, with early-bird prices of $333 and $555 (Tickets). 20 tickets each (`migrations/020_immersion_ticket_limits.sql`). Still needed: the early-bird deadline.
- ~~**Experience.**~~ **Done:** Estar's seven experiences are published. The schedule and specific ceremonies are still to be finalized in the itinerary.
- **Overview and copy.** New copy in Estar's voice is in the **draft** for her approval (`migrations/014_draft_copy.sql`): the overview letter, who the retreat welcomes, "What you'll take home", "Your investment" and a note on the pace of the days. Preview it at `/?preview=1` and publish from Landing page. Exclusions are still a placeholder.
- ~~**Bio and portrait.**~~ **Done:** Estar's biography and her portrait in Meet Estar (`public/media/estar-portrait.jpg`).
- **FAQs.** Payments, cancellation, meals and day immersions are answered. Arrival and departure, transport, dietary needs, accessibility, room sharing and packing still need answers.
- **Testimonials.** Approved testimonials with written permission.
- **Contact.** The verified support email, phone and response time.
- **Legal text.** Privacy policy, agreement and policy text from the attorney.
- **GoHighLevel.** Access to GoHighLevel, if it will be used. Until then, use the ticket sales CSV export.

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

**Automatic payment records.** Payments are taken on an outside site and recorded by hand in **Payments**. If that site can send a notification for each payment (a webhook), sales could be recorded automatically, so a room shows as sold out the moment its last ticket is paid for.

**Phase 3.** Online guest forms with protected private uploads, itinerary-change notices, consent-based campaigns, a GoHighLevel adapter (if access is approved) and reporting.
