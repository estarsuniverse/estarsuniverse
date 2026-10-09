// Starting content for a fresh database. Everything here is editable in /admin.
// Copy marked "for approval" comes from the build brief and must be approved by Empowered Wombman.
// Square brackets mark placeholders that still need real content.

const CONSENT_VERSION = "2026-10-marketing-v1";
const PRIVACY_VERSION = "2026-10-privacy-v1";

const RETREAT = {
  id: "ret_embodied_godis_1",
  slug: "embodied-godis",
  name: "Embodied Godis Retreat",
  timezone: "America/New_York",
  terms: {
    fees_text: "",
    taxes_text: "",
    deposit_cents: null,
    deposit_text: "",
    installments: [],          // [{ label, percent | amount_cents, due_date }]
    installments_text: "",
    cancellation_text: "",
    transfer_text: "",
    refund_text: "",
  },
};

// Prices are exactly as supplied by Estar. price_basis starts "unconfirmed", which blocks paid checkout.
const ROOMS = [
  { id: "room_sapphire",   name: "Sapphire",                     price_cents: 319900, occupancy_label: "Single occupancy", features: "En suite and balcony" },
  { id: "room_tigers_eye", name: "Tiger’s Eye",             price_cents: 299900, occupancy_label: "Double occupancy", features: "Soaker tub and balcony" },
  { id: "room_emerald",    name: "Emerald",                      price_cents: 279900, occupancy_label: "Double occupancy", features: "En suite and balcony" },
  { id: "room_obsidian",   name: "Obsidian",                     price_cents: 289900, occupancy_label: "Double occupancy", features: "En suite and balcony" },
  { id: "room_moonstone",  name: "Moonstone",                    price_cents: 269900, occupancy_label: "Triple occupancy", features: "" },
  { id: "room_sofa_1",     name: "Downstairs queen sofa bed 1",  price_cents: 111100, occupancy_label: "Queen sofa bed", features: "" },
  { id: "room_sofa_2",     name: "Downstairs queen sofa bed 2",  price_cents: 111100, occupancy_label: "Queen sofa bed", features: "" },
];

const SITE = {
  previewBanner: true,
  brand: {
    orgName: "Empowered Wombman",
    retreatName: "Embodied Godis Retreat",
    logoUrl: "",
    logoDarkUrl: "",
    logoAlt: "Empowered Wombman",
  },
  hero: {
    kicker: "Empowered Wombman presents",
    title: "Return to yourself in movement, music, and sistarhood.",
    sub: "Explore an intimate Embodied Godis retreat guided by Estar, the Singing Yogini.",
    imageUrl: "/media/venue/aerial-pond-dusk.jpg",
    imageAlt: "The retreat house among the trees beside a pond with a lit fountain at dusk",
    videoUrl: "/media/pond.mp4",
    videoWebmUrl: "/media/pond.webm",
    videoPosterUrl: "/media/pond-poster.jpg",
    primaryLabel: "Join the Waiting List",
    secondaryLabel: "Explore the Experience",
  },
  overview: {
    heading: "An invitation, sistar.",
    body: "Eye am creating a space for wombmen who are ready to slow down, move, sing, and gather in sistarhood. [Overview copy for approval.]\n\nThe dates and location will be shared here as soon as they are confirmed. Joining the waiting list is free and does not reserve a room.",
    signoff: "With love, Estar",
  },
  grounds: {
    heading: "The grounds",
    intro: "A wooded setting with a pond and fountain, a labyrinth, hammocks under the trees, and quiet places to gather. [Confirm wording and that these photos are approved for this retreat.]",
    photos: [
      { id: "g1", url: "/media/venue/pond-fountain.jpg", alt: "Pond with a fountain, seen from the deck railing", caption: "The pond" },
      { id: "g2", url: "/media/venue/labyrinth.jpg", alt: "Aerial view of a circular stone labyrinth in the woods", caption: "Labyrinth" },
      { id: "g3", url: "/media/venue/fire-pit.jpg", alt: "Circle of chairs around a stone fire pit near the pond", caption: "Fire pit circle" },
      { id: "g4", url: "/media/venue/woodland-pavilion.jpg", alt: "Wooden pavilion with two hammocks and a small table in the woods", caption: "Woodland pavilion" },
      { id: "g5", url: "/media/venue/pond-deck.jpg", alt: "Deck with built-in benches overlooking the pond", caption: "Pond deck" },
      { id: "g6", url: "/media/venue/pergola-hammocks.jpg", alt: "Hammocks hanging from black pergolas on the lawn", caption: "Pergola hammocks" },
      { id: "g7", url: "/media/venue/patio-lounge.jpg", alt: "Patio with an outdoor sofa and a dining table under umbrellas", caption: "Patio lounge and dining" },
      { id: "g8", url: "/media/venue/covered-kitchen.jpg", alt: "Covered outdoor kitchen with a high table and a hanging egg chair", caption: "Covered outdoor kitchen" },
      { id: "g9", url: "/media/venue/hot-tub.jpg", alt: "Covered hot tub beside outdoor seating", caption: "Covered hot tub" },
      { id: "g10", url: "/media/venue/upper-deck.jpg", alt: "Upper deck with lounge chairs and an umbrella", caption: "Upper deck" },
      { id: "g11", url: "/media/venue/pavilion-labyrinth.jpg", alt: "Hammock pavilion next to the labyrinth", caption: "Pavilion by the labyrinth" },
      { id: "g12", url: "/media/venue/woodland-bench.jpg", alt: "Bench on a shaded woodland path", caption: "Woodland path" },
      { id: "g13", url: "/media/venue/house-swings.jpg", alt: "The house with decks and porch swing beds", caption: "Porch swings" },
      { id: "g14", url: "/media/venue/back-lawn.jpg", alt: "Back of the house with lawn, patio and covered kitchen", caption: "Back lawn" },
      { id: "g15", url: "/media/venue/outdoor-kitchen.jpg", alt: "Outdoor kitchen with bar stools under a pavilion", caption: "Outdoor kitchen" },
    ],
  },
  experience: {
    heading: "The Experience",
    welcomes: "[Who the retreat welcomes, for approval.]",
    participation: "Every practice is an invitation. You choose how you take part, and any physical touch is always optional. You can sit out, adapt, or rest at any time.",
    inclusions: ["[Inclusion to confirm]"],
    exclusions: ["[Exclusion to confirm, for example travel to the venue]"],
    pendingNote: "The full list of sessions will be shared once each one is confirmed.",
    activities: [
      { id: "a1", title: "Sensual awakening through vocal activation and movement", description: "", published: false },
      { id: "a2", title: "Flexibility intensive", description: "", published: false },
      { id: "a3", title: "Guided meditation", description: "", published: false },
      { id: "a4", title: "Divine sistar partner stretching", description: "", published: false, note: "Partner work and touch are always optional." },
      { id: "a5", title: "Mirror magic", description: "", published: false },
      { id: "a6", title: "Womb circles", description: "", published: false },
      { id: "a7", title: "Elemental ceremony", description: "", published: false },
      { id: "a8", title: "Nature-based spiritual bath", description: "", published: false },
      { id: "a9", title: "Planting ritual", description: "", published: false },
      { id: "a10", title: "Nourishing meals", description: "", published: false },
      { id: "a11", title: "Ginger shots", description: "", published: false },
      { id: "a12", title: "Yoni steaming", description: "", published: false, reviewRequired: true, reviewDone: false,
        note: "Held back pending a separate safety and suitability review." },
    ],
  },
  stay: {
    heading: "Your Stay",
    intro: "Each room is shown with its real price, how many guests it is for, and what you can expect. Details marked “to be confirmed” are still being finalized.",
    sharedNote: "A shared room does not guarantee a separate bed. Bed layouts are listed for each room once confirmed.",
    photos: [],
  },
  itinerary: {
    heading: "Itinerary",
    note: "This schedule is provisional and may change. Confirmed guests will be notified of any changes in their portal.",
    days: [
      { id: "d1", label: "Day 1", sessions: [{ id: "s1", time: "", title: "[Session to confirm]", description: "", provisional: true }] },
    ],
  },
  host: {
    heading: "Meet Estar",
    name: "Estar",
    title: "the Singing Yogini",
    bio: "[Approved biography connecting Estar’s work in yoga, music, embodiment and community.]",
    photoUrl: "",
  },
  faqs: [
    { id: "f1", q: "When do I arrive and depart?", a: "[Arrival and departure times to confirm.]" },
    { id: "f2", q: "How do I get there?", a: "[Transport guidance to confirm.]" },
    { id: "f3", q: "What meals are included?", a: "[Meals to confirm.]" },
    { id: "f4", q: "Can you accommodate dietary needs?", a: "[Dietary process to confirm.]" },
    { id: "f5", q: "Is the venue accessible?", a: "[Mobility access details to confirm.]" },
    { id: "f6", q: "Will I share a room?", a: "[Room sharing details to confirm.]" },
    { id: "f7", q: "Can I come on my own?", a: "Yes. Many wombmen come solo. [Confirm wording.]" },
    { id: "f8", q: "How do payments work?", a: "Joining the waiting list is free and does not require payment. Payment terms will be published here before reservations open." },
    { id: "f9", q: "What is the cancellation policy?", a: "[Cancellation and transfer terms to confirm.]" },
    { id: "f10", q: "What should I bring?", a: "[Packing guidance to confirm.]" },
  ],
  trust: {
    heading: "Kind words",
    testimonials: [],   // { id, quote, name, permission, published }
    policiesText: "",
  },
  contact: {
    email: "",
    phone: "",
    responseTime: "",
    verified: false,
  },
  waitlist: {
    heading: "Join the Waiting List",
    intro: "Be the first to hear when dates and reservations are ready. Joining is free and does not reserve a room or require payment.",
    privacyNotice: "We use your name and email to manage the waiting list and to contact you about this retreat. We do not sell your information. [Link to the full privacy policy once approved.]",
    consentText: "Yes, Eye would also like to receive updates and offerings from Empowered Wombman. You can unsubscribe at any time.",
    consentVersion: CONSENT_VERSION,
    privacyVersion: PRIVACY_VERSION,
    successMessage: "You’re on the waiting list, sistar. We’ll email you when retreat details and reservations are ready. Joining the list does not reserve a room or require payment.",
  },
  portal: {
    welcome: "Welcome, sistar.",
    announcements: [],   // { id, date, title, body }
    packingList: ["[Packing list to confirm]"],
    arrivalGuidance: "[General arrival guidance. The detailed address is shared only with confirmed guests.]",
    preparation: "",
    forms: [
      { id: "agreement", name: "Retreat agreement", required: true, description: "Shared after you reserve. Text supplied by Empowered Wombman’s attorney." },
      { id: "needs", name: "Dietary and accessibility needs", required: false, description: "Optional. Shared after you reserve." },
    ],
    supportText: "Questions about your retreat? Reach out using the contact below.",
  },
};

const TEMPLATES = [
  { key: "signin_code", name: "Sign-in code", category: "operational", enabled: true,
    subject: "Your sign-in code: {{code}}",
    body: "Hi {{name}},\n\nYour Empowered Wombman guest portal code is:\n\n{{code}}\n\nIt expires in 10 minutes. If you did not ask for this code, you can ignore this email." },
  { key: "waitlist_confirmation", name: "Waiting list confirmation", category: "operational", enabled: true,
    subject: "You’re on the Embodied Godis waiting list",
    body: "Hi {{name}},\n\nYou’re on the waiting list, sistar. We’ll email you when retreat details and reservations are ready.\n\nJoining the list does not reserve a room or require payment.\n\nYou can see your waiting list details any time in your guest portal: {{portal_url}}" },
  { key: "activation_invite", name: "Portal invitation", category: "operational", enabled: true,
    subject: "Your Embodied Godis guest portal",
    body: "Hi {{name}},\n\nYour guest portal is ready. Sign in with this email address and we’ll send you a one-time code:\n\n{{portal_url}}" },
  { key: "staff_invite", name: "Staff invitation", category: "operational", enabled: true,
    subject: "You’ve been invited to the Embodied Godis admin",
    body: "Hi {{name}},\n\n{{inviter}} has invited you to the Embodied Godis admin area as {{role}}.\n\nSet your password and two-step sign-in here (link expires in 72 hours):\n\n{{invite_url}}" },
  { key: "booking_confirmation", name: "Booking confirmation", category: "operational", enabled: false,
    subject: "Your Embodied Godis reservation is confirmed",
    body: "Hi {{name}},\n\n[Draft for approval. Sent after a verified payment or an approved manual confirmation.]\n\nRoom: {{room}}\nTotal: {{total}}\n\nYour portal: {{portal_url}}" },
  { key: "payment_receipt", name: "Payment receipt", category: "operational", enabled: false,
    subject: "Payment received: {{amount}}",
    body: "Hi {{name}},\n\n[Draft for approval.] We received your payment of {{amount}}. Remaining balance: {{balance}}.\n\n{{portal_url}}" },
  { key: "balance_reminder", name: "Balance reminder", category: "operational", enabled: false,
    subject: "Upcoming payment for your Embodied Godis retreat",
    body: "Hi {{name}},\n\n[Draft for approval.] A payment of {{amount}} is due on {{due_date}}.\n\n{{portal_url}}" },
  { key: "preparation", name: "Preparation", category: "campaign", enabled: false,
    subject: "Preparing for your retreat",
    body: "Hi {{name}},\n\n[Draft for approval.]\n\n{{portal_url}}" },
  { key: "itinerary_change", name: "Itinerary change", category: "operational", enabled: false,
    subject: "An update to your retreat itinerary",
    body: "Hi {{name}},\n\n[Draft for approval.] The itinerary has been updated. See the latest schedule in your portal:\n\n{{portal_url}}" },
];

module.exports = { RETREAT, ROOMS, SITE, TEMPLATES, CONSENT_VERSION, PRIVACY_VERSION };
