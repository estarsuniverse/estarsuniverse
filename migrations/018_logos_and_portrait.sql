-- Empowered Wombman logos (light background at the top, dark in the footer) and Estar's portrait for Meet Estar.
-- Only empty fields are filled, so anything uploaded in Content and Branding is kept.

CREATE FUNCTION pg_temp.brand_media(c jsonb) RETURNS jsonb LANGUAGE sql AS $fn$
SELECT jsonb_set(jsonb_set(jsonb_set(c,
  '{brand,logoUrl}', CASE WHEN coalesce(c #>> '{brand,logoUrl}', '') = '' THEN '"/media/brand/logo-light.png"'::jsonb ELSE c #> '{brand,logoUrl}' END, true),
  '{brand,logoDarkUrl}', CASE WHEN coalesce(c #>> '{brand,logoDarkUrl}', '') = '' THEN '"/media/brand/logo-dark.png"'::jsonb ELSE c #> '{brand,logoDarkUrl}' END, true),
  '{host,photoUrl}', CASE WHEN coalesce(c #>> '{host,photoUrl}', '') = '' THEN '"/media/estar-portrait.jpg"'::jsonb ELSE c #> '{host,photoUrl}' END, true)
$fn$;

UPDATE content SET draft = pg_temp.brand_media(draft), published = pg_temp.brand_media(published) WHERE key = 'site';

INSERT INTO audit_events (actor_label, action, entity, entity_id)
VALUES ('migration', 'content.logos_and_portrait', 'content', 'site');
