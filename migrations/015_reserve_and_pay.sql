-- Reserve section: guests choose a room or day immersion and how to pay (deposit or in full), then Secure your spot
-- takes them to the owner's payment link. Payment links work only while reservations are open.
-- Replaces the waiting-list form on the public page (the guest portal still has the waiting list).

ALTER TABLE retreats ADD COLUMN IF NOT EXISTS payment_links jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE FUNCTION pg_temp.reserve(c jsonb) RETURNS jsonb LANGUAGE sql AS $fn$
SELECT jsonb_set(jsonb_set(
  CASE WHEN c ? 'reserve' THEN c ELSE c || jsonb_build_object('reserve', '{
    "heading": "Reserve your place",
    "intro": "Choose your room or day immersion, then how you’d like to pay.",
    "depositLabel": "Pay the deposit",
    "fullLabel": "Pay in full",
    "payLabel": "Secure your spot",
    "closedLabel": "Payments open soon",
    "closedNote": "Reservations open as soon as the payment terms are final. In the meantime, book a call with us if you have any questions.",
    "callHeading": "Prefer to talk first?",
    "callText": "Book a call to ask your questions and find the option that’s right for you.",
    "callLabel": "Book a call",
    "callUrl": ""
  }'::jsonb) END,
  '{hero,primaryLabel}', CASE WHEN c #>> '{hero,primaryLabel}' = 'Join the Waiting List' THEN '"Reserve your place"'::jsonb ELSE coalesce(c #> '{hero,primaryLabel}', '"Reserve your place"'::jsonb) END),
  '{faqs}', coalesce((SELECT jsonb_agg(CASE WHEN t.f ->> 'id' = 'f8'
      THEN jsonb_set(t.f, '{a}', to_jsonb(replace(t.f ->> 'a', ' Joining the waiting list is free and does not require payment.', '')))
      ELSE t.f END ORDER BY t.i)
    FROM jsonb_array_elements(c -> 'faqs') WITH ORDINALITY AS t(f, i)), c -> 'faqs'))
$fn$;

UPDATE content SET draft = pg_temp.reserve(draft), published = pg_temp.reserve(published) WHERE key = 'site';

INSERT INTO audit_events (actor_label, action, entity, entity_id)
VALUES ('migration', 'content.reserve_section', 'content', 'site');
