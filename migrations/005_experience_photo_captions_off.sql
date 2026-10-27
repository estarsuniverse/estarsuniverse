-- No captions on The Experience photos. Alt text (for screen readers) is kept.

UPDATE content SET draft = jsonb_set(draft, '{experience,photos}', (
  SELECT coalesce(jsonb_agg(jsonb_set(e, '{caption}', '""') ORDER BY i), '[]'::jsonb)
  FROM jsonb_array_elements(draft #> '{experience,photos}') WITH ORDINALITY AS t(e, i)))
WHERE key = 'site' AND jsonb_typeof(draft #> '{experience,photos}') = 'array';

UPDATE content SET published = jsonb_set(published, '{experience,photos}', (
  SELECT coalesce(jsonb_agg(jsonb_set(e, '{caption}', '""') ORDER BY i), '[]'::jsonb)
  FROM jsonb_array_elements(published #> '{experience,photos}') WITH ORDINALITY AS t(e, i)))
WHERE key = 'site' AND jsonb_typeof(published #> '{experience,photos}') = 'array';

INSERT INTO audit_events (actor_label, action, entity, entity_id)
VALUES ('migration', 'content.experience_captions_removed', 'content', 'site');
