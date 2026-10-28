-- Estar's confirmed offer (October 2026).
-- Rooms include the complete retreat experience; Emerald and Obsidian share one price ($2,799); a 30% nonrefundable
-- deposit with installments; day immersions; Estar's biography and retreat experiences; payment and immersion FAQs.
-- Payment deadlines, cancellation windows and refund terms are still to be finalized, so terms stay unconfirmed.

-- Rooms: admission (the full retreat programme) is included in every room price.
UPDATE room_types SET includes_admission = 'yes', updated_at = now()
WHERE retreat_id IN (SELECT id FROM retreats WHERE is_current);

-- Obsidian matches Emerald at $2,799 (only if it is still at the original $2,899).
INSERT INTO audit_events (actor_label, action, entity, entity_id, before, after)
SELECT 'migration', 'room.price_changed', 'room_type', id, jsonb_build_object('price_cents', price_cents), jsonb_build_object('price_cents', 279900)
FROM room_types WHERE id = 'room_obsidian' AND price_cents = 289900;
UPDATE room_types SET price_cents = 279900, updated_at = now() WHERE id = 'room_obsidian' AND price_cents = 289900;

-- Day immersions: names and prices live on the retreat (owner-only, like room prices).
ALTER TABLE retreats ADD COLUMN IF NOT EXISTS immersions jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE retreats SET day_pass_enabled = true, updated_at = now(), immersions = '[
  {"id": "imm_one_day", "name": "One-Day Immersion", "days": 1, "price_cents": 44400, "early_bird_price_cents": 33300},
  {"id": "imm_two_day", "name": "Two-Day Immersion", "days": 2, "price_cents": 66600, "early_bird_price_cents": 55500}
]'::jsonb
WHERE is_current AND immersions = '[]'::jsonb;

-- Payment terms agreed so far. Empty fields are filled; anything already written is kept.
UPDATE retreats SET updated_at = now(), terms = terms || jsonb_build_object(
  'deposit_percent', CASE WHEN jsonb_typeof(terms -> 'deposit_percent') = 'number' THEN terms -> 'deposit_percent' ELSE '30'::jsonb END,
  'deposit_text', coalesce(nullif(terms ->> 'deposit_text', ''), 'A 30% deposit secures your reservation. Deposits are nonrefundable.'),
  'installments_text', coalesce(nullif(terms ->> 'installments_text', ''), 'The remaining balance is divided into installments leading up to the retreat. [Payment deadlines to confirm.]'),
  'cancellation_text', coalesce(nullif(terms ->> 'cancellation_text', ''), 'Deposits are nonrefundable. Remaining payments are subject to the cancellation and refund policy. [Cancellation windows to confirm.]'),
  'transfer_text', coalesce(nullif(terms ->> 'transfer_text', ''), 'Reservation transfers may be considered with advance notice and approval.'))
WHERE is_current;

-- Site content (draft and published).
CREATE FUNCTION pg_temp.estar_offer(c jsonb) RETURNS jsonb LANGUAGE sql AS $fn$
SELECT jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(c,
  '{host,bio}', to_jsonb('ESTAR is a multidisciplinary artist, Singing Yogini, and founder of Empowered Wombman, a movement devoted to feminine embodiment, ancestral remembrance, and creative liberation.

Through the sacred union of yoga, music, meditation, and intuitive movement, she invites wombmen to return home to their bodies, awaken their creative life force, and cultivate deeper intimacy with their pleasure, power, and divine expression.'::text)),
  '{experience,activities}', '[
    {"id": "x1", "title": "Sensual Embodiment Workshop", "description": "", "note": "", "published": true},
    {"id": "x2", "title": "Sacred breathwork and guided meditation", "description": "", "note": "", "published": true},
    {"id": "x3", "title": "Divine Flexibility Intensive Training", "description": "", "note": "", "published": true},
    {"id": "x4", "title": "Vocal activation and Sound Healing Workshop", "description": "", "note": "", "published": true},
    {"id": "x5", "title": "Daily Sacred Womb circles and intentional conversations", "description": "", "note": "", "published": true},
    {"id": "x6", "title": "Self-discovery rituals and integration practices", "description": "", "note": "", "published": true},
    {"id": "x7", "title": "Rest, nourishment, and communion with nature", "description": "", "note": "", "published": true}
  ]'::jsonb),
  '{experience,inclusions}', '["Your accommodations for the full retreat", "Scheduled meals", "Sacred ceremonies", "Movement sessions", "Workshops", "All retreat programming"]'::jsonb),
  '{faqs}', coalesce((SELECT jsonb_agg(x.f ORDER BY x.k) FROM (
      SELECT CASE t.f ->> 'id'
          WHEN 'f3' THEN jsonb_set(t.f, '{a}', '"Scheduled meals are included for every residential guest, and for immersion guests on the days they attend. [Menu details to confirm.]"')
          WHEN 'f8' THEN jsonb_set(t.f, '{a}', '"A 30% deposit secures your reservation, and the remaining balance is divided into installments leading up to the retreat. Payment deadlines will be shared here before reservations open. Joining the waiting list is free and does not require payment."')
          WHEN 'f9' THEN jsonb_set(t.f, '{a}', '"Deposits are nonrefundable. Remaining payments are subject to a cancellation and refund policy that will be shared here before reservations open. Reservation transfers may be considered with advance notice and approval."')
          ELSE t.f END AS f, t.i::numeric AS k
      FROM jsonb_array_elements(c -> 'faqs') WITH ORDINALITY AS t(f, i)
      UNION ALL
      SELECT '{"id": "f11", "q": "Can I join without staying overnight?", "a": "Yes. Day immersions are for wombmen who feel called to experience the retreat without staying overnight. They include access to scheduled ceremonies, embodiment practices, workshops, sisterhood gatherings and meals on the days you attend. Overnight accommodations are reserved for residential guests."}'::jsonb,
        coalesce((SELECT t.i FROM jsonb_array_elements(c -> 'faqs') WITH ORDINALITY AS t(f, i) WHERE t.f ->> 'id' = 'f8' LIMIT 1), 1000) + 0.5
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c -> 'faqs') AS t(f) WHERE t.f ->> 'id' = 'f11')
    ) x), c -> 'faqs')),
  '{immersions}', '{
    "heading": "Day immersions",
    "intro": "For wombmen who feel called to experience the magic without staying overnight.",
    "includes": "Each immersion includes access to scheduled ceremonies, embodiment practices, workshops, sisterhood gatherings and meals on the days you attend.",
    "note": "Overnight accommodations are reserved for residential guests.",
    "earlyBirdLabel": "Early bird",
    "earlyBirdNote": "Early-bird pricing is an introductory offer for wombmen who feel called to commit early. [Early-bird deadline to confirm.]"
  }'::jsonb, true)
$fn$;

UPDATE content SET draft = pg_temp.estar_offer(draft), published = pg_temp.estar_offer(published) WHERE key = 'site';

INSERT INTO audit_events (actor_label, action, entity, entity_id)
VALUES ('migration', 'retreat.estar_confirmed_offer', 'retreat', NULL);
