-- Estar's FAQs, in her words and order (draft and published), with the heading and the line under it.
-- Replaces the earlier placeholder answers.

CREATE FUNCTION pg_temp.estar_faqs(c jsonb) RETURNS jsonb LANGUAGE sql AS $fn$
SELECT jsonb_set(jsonb_set(c, '{faqPage}', $faqpage${"heading": "Frequently Asked Questions", "intro": "Everything You Need to Know Before Entering the Sanctuary 🌺"}$faqpage$::jsonb, true), '{faqs}', $faq$[
 {
  "id": "f1",
  "q": "When do eye arrive and depart?",
  "a": "Our residential retreat guests are invited to arrive at 1:00 PM on Day One, with departure at 2:00 PM on the final day.\n\nOur Day Immersions take place on Days Two and Three, creating an opportunity for our local Atlanta community to experience the magic of the sanctuary without staying overnight.\n\nTo preserve the intimacy of our gathering, only 20 Day Immersion spaces are available each day.\n\nGuests may select either our One-Day Immersion ($444) or Two-Day Immersion ($666), with access to the corresponding day’s experiences outlined in our itinerary."
 },
 {
  "id": "f2",
  "q": "How do eye get there?",
  "a": "Our sanctuary is nestled in Douglasville, Georgia, approximately 22 miles from Hartsfield-Jackson Atlanta International Airport.\n\nGuests may arrange transportation through Uber or another rideshare service. Additional transportation assistance may also be available upon request for an additional fee.\n\nDetailed arrival instructions and the retreat address will be shared with confirmed guests."
 },
 {
  "id": "f3",
  "q": "What meals are included?",
  "a": "Nourishment is an essential part of our experience!\n\nOur retreat will feature thoughtfully prepared meals from talented chefs, including nourishing plant-based creations and special dining experiences.\n\nResidential guests can look forward to breakfast, lunch, and dinner throughout the retreat, with light bites upon arrival and a special departure brunch or lunch, according to our final itinerary.\n\nDay Immersion guests will receive the scheduled meals included in their selected day’s experience."
 },
 {
  "id": "f4",
  "q": "Can you accommodate dietary needs?",
  "a": "Absolutely! We understand that every body has unique needs.\n\nA dietary preference and allergy form will be provided before the retreat so our culinary team can review your requirements and communicate what accommodations are possible."
 },
 {
  "id": "f5",
  "q": "Is the venue accessible?",
  "a": "Our sanctuary features multiple levels, with a set of stairs leading to the downstairs bedrooms.\n\nIf you have mobility considerations or accessibility requirements, please reach out before booking so we can discuss the space and determine whether it can comfortably accommodate your needs."
 },
 {
  "id": "f6",
  "q": "Will eye share a room?",
  "a": "Some of our accommodations are shared, while room arrangements vary depending on the category selected.\n\nEach room listing will clearly identify its sleeping arrangements, occupancy, and amenities so you can choose the sanctuary that feels most aligned with you."
 },
 {
  "id": "f7",
  "q": "Can eye come on my own?",
  "a": "Of course, Godis! 🌺\n\nYou are welcome to arrive exactly as you are, whether you’re joining us independently or alongside a sister.\n\nThis retreat is an opportunity to cultivate deeper intimacy with yourself while connecting with a beautiful community of wombmen.\n\nYou don’t need to know anyone before arriving. Come with an open heart and allow the connections to unfold organically."
 },
 {
  "id": "f8",
  "q": "How do payments work?",
  "a": "All reservations and payments will be processed securely through our official Empowered Wombman website.\n\nOvernight guests may secure their sanctuary with a 30% nonrefundable deposit, followed by scheduled installments for the remaining balance.\n\nPayment options and due dates will be clearly outlined before checkout."
 },
 {
  "id": "f11",
  "q": "Can eye join without staying overnight?",
  "a": "Absolutely!\n\nWe’ve created two beautiful ways for our local Atlanta community to join the experience:\n\nOne-Day Immersion — $444\nAn intentional day of embodiment, sacred movement, connection, nourishment, and transformative experiences.\n\nTwo-Day Immersion — $666\nA deeper journey into the sanctuary, allowing you to experience both days of our community programming.\n\nEach immersion includes access to its scheduled activities and designated meals, without overnight accommodations.\n\nOnly 20 Day Immersion spaces are available per day, ensuring an intimate and intentional experience for everyone."
 },
 {
  "id": "f9",
  "q": "What is the cancellation policy?",
  "a": "All retreat deposits are nonrefundable.\n\nOur complete cancellation, refund, and reservation transfer terms will be provided during checkout. Please review these policies carefully before securing your space."
 },
 {
  "id": "f10",
  "q": "What should eye bring?",
  "a": "Most importantly, bring your soul, Godis! 🌺\n\nWe recommend bringing:\n\n* Comfortable clothing for yoga, movement, and relaxation\n* A bathing suit\n* House shoes or comfortable indoor slippers\n* Your favorite journal and writing materials\n* A personal yoga mat, if you prefer to practice with your own (BYOM)\n* Personal care essentials and anything that supports your comfort\n\nCome with an open heart, a curious spirit, and a willingness to experience yourself in new ways.\n\nEverything else begins within. ✨"
 }
]$faq$::jsonb, true)
$fn$;

UPDATE content SET draft = pg_temp.estar_faqs(draft), published = pg_temp.estar_faqs(published) WHERE key = 'site';

INSERT INTO audit_events (actor_label, action, entity, entity_id)
VALUES ('migration', 'content.estar_faqs', 'content', 'site');
