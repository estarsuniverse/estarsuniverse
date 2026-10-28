# Admin guide

Open **/admin/**. Sign-in is currently turned off, so you go straight in as the owner (and so can anyone with the link). To require sign-in, add `ADMIN_REQUIRE_SIGNIN` with the value `true` in Vercel and redeploy; then sign in with your email and password. The owner uses the `ADMIN_EMAIL` and `ADMIN_PASSWORD` set in Vercel; staff use the password they chose from their invitation. If you've added an authenticator app in Settings, enter its code after your password.

The admin follows the landing page: what guests see, what they can buy, and what they've paid.

## The tabs

- **Overview.** Whether Secure your spot is open, tickets sold, money collected, balances still due, every ticket option with how many are left, and the checklist that has to be complete before payments can be turned on.
- **Landing page.** Every section of the public page, in the same order as the page (the numbered buttons at the top jump to each one): logo and header, hero and introduction, What you’ll take home, The Experience, the grounds, Investment, Your Stay, day immersion wording, Itinerary, Meet Estar, FAQs, testimonials and policies, contact, and Secure your spot with the Book a call link.
- **Tickets.** What guests can choose under Secure your spot.
  - **Rooms.** Click a room to edit its price, tickets, beds, bathroom, features, accessibility, description and photos. A room has **one ticket per guest**, so Moonstone (3 guests) has 3 tickets. Untick **Show on the public page** to stop offering a room (the sofa beds are hidden this way).
  - **Day immersions.** Name, days, price, optional early-bird price with its last day, and optional ticket limit (blank means no limit). After the early bird’s last day, the page shows only the standard price. Day immersions are always paid in full.
  - Each room and immersion shows how many tickets are sold. When they're all sold, it shows as sold out on the page and can't be chosen.
- **Payments.**
  - **Secure your spot is open/closed.** The checklist, and **Turn payments on**, which works once everything is complete. While it's off, the button on the page says "Payments open soon."
  - **Record a payment.** When a guest pays on your payment site, record it here: the ticket, their name and contact, deposit or paid in full, and the amount (filled in for you). Their ticket counts as sold right away.
  - **Guests and payments.** Everyone who has paid, with what they've paid and what's still due. Click a guest to add an installment, record a refund, remove a payment entered by mistake, or cancel their ticket (which frees it for someone else). **Export CSV** downloads the list.
  - **Payment links.** Where the Secure your spot button sends guests: a deposit link and a pay-in-full link for each room (the default links cover any room left blank), and a pay-in-full link for each day immersion.
  - **Payment terms.** Deposit, installments, fees, taxes, cancellation, transfer and refund wording, shown on the page once approved.
- **Settings.** Retreat dates, venue, the private address, staff access, connection status and the change history.

**Owners** can do everything. **Staff** can edit the landing page, room descriptions and photos, and record payments; only owners can change prices, tickets, day immersions, payment links, payment terms, retreat details or staff access.

## Draft, preview, publish

Changes on **Landing page** stay in draft until you publish them:

1. **Save draft** keeps your work. Nothing changes on the live page.
2. **Preview** opens the page with your draft.
3. **Publish** makes it live. The previous version is kept in the history.

Text in `[square brackets]` is highlighted on the page as a placeholder until it's replaced. When the content is approved, turn off the **awaiting approval** banner under Logo and header.

## Things the system won't let you do (on purpose)

- Turn payments on before the checklist is complete.
- Sell more tickets than a room has guests, or more than a day immersion's ticket limit.
- Take a deposit on a day immersion, or record more than a ticket's remaining balance.
- Publish a held-back session (such as yoni steaming) until an owner records the safety and suitability review.
- Publish a testimonial without recording permission.
- Show contact details until an owner marks them verified.
