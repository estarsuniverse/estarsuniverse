-- "Reserve" is now "Secure your spot": the section heading and the hero button (draft and published).
-- Only changes wording that is still the previous default, so edits made in the admin area are kept.

CREATE FUNCTION pg_temp.secure_spot(c jsonb) RETURNS jsonb LANGUAGE sql AS $fn$
SELECT jsonb_set(jsonb_set(c,
  '{reserve,heading}', CASE WHEN c #>> '{reserve,heading}' = 'Reserve your place' THEN '"Secure your spot"'::jsonb ELSE coalesce(c #> '{reserve,heading}', '"Secure your spot"'::jsonb) END, true),
  '{hero,primaryLabel}', CASE WHEN c #>> '{hero,primaryLabel}' = 'Reserve your place' THEN '"Secure your spot"'::jsonb ELSE coalesce(c #> '{hero,primaryLabel}', '"Secure your spot"'::jsonb) END)
$fn$;

UPDATE content SET draft = pg_temp.secure_spot(draft), published = pg_temp.secure_spot(published) WHERE key = 'site';

INSERT INTO audit_events (actor_label, action, entity, entity_id)
VALUES ('migration', 'content.secure_your_spot', 'content', 'site');
