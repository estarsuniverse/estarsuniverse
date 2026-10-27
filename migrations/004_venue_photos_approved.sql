-- The venue photos are approved for this retreat: drop that part of the grounds placeholder note.
-- Only touches the intro if it still contains the original note, so any edited wording is kept.

UPDATE content SET draft = jsonb_set(draft, '{grounds,intro}',
  to_jsonb(replace(draft #>> '{grounds,intro}', ' [Confirm wording and that these photos are approved for this retreat.]', ' [Confirm wording.]')))
WHERE key = 'site' AND draft #>> '{grounds,intro}' LIKE '%[Confirm wording and that these photos are approved for this retreat.]%';

UPDATE content SET published = jsonb_set(published, '{grounds,intro}',
  to_jsonb(replace(published #>> '{grounds,intro}', ' [Confirm wording and that these photos are approved for this retreat.]', ' [Confirm wording.]')))
WHERE key = 'site' AND published #>> '{grounds,intro}' LIKE '%[Confirm wording and that these photos are approved for this retreat.]%';

INSERT INTO audit_events (actor_label, action, entity, entity_id)
VALUES ('migration', 'content.venue_photos_approved', 'content', 'site');
