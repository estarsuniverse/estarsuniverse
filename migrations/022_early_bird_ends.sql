-- The early bird ends on December 12, 2026 (the last day it applies, Eastern time). After that the page shows only
-- the standard immersion prices. Only immersions with an early-bird price and no end date yet are changed.

UPDATE retreats SET updated_at = now(), immersions = (
  SELECT coalesce(jsonb_agg(CASE WHEN i.e ->> 'early_bird_price_cents' IS NOT NULL AND coalesce(i.e ->> 'early_bird_ends', '') = ''
    THEN i.e || '{"early_bird_ends": "2026-12-12"}'::jsonb ELSE i.e END ORDER BY i.n), '[]'::jsonb)
  FROM jsonb_array_elements(immersions) WITH ORDINALITY AS i(e, n))
WHERE is_current;

CREATE FUNCTION pg_temp.early_bird_note(c jsonb) RETURNS jsonb LANGUAGE sql AS $fn$
SELECT CASE WHEN c #>> '{immersions,earlyBirdNote}' LIKE '%[Early-bird deadline to confirm.]%'
  THEN jsonb_set(c, '{immersions,earlyBirdNote}', to_jsonb(replace(c #>> '{immersions,earlyBirdNote}', '[Early-bird deadline to confirm.]', 'It ends December 12, 2026.')))
  ELSE c END
$fn$;

UPDATE content SET draft = pg_temp.early_bird_note(draft), published = pg_temp.early_bird_note(published) WHERE key = 'site';

INSERT INTO audit_events (actor_label, action, entity, after)
VALUES ('migration', 'retreat.early_bird_ends', 'retreat', '{"early_bird_ends": "2026-12-12"}'::jsonb);
