-- Emerald and Moonstone have the downstairs living room space: add the living area photo just before the
-- kitchenette (or at the end if there is none). Skipped for a room that already has it.

UPDATE room_types r SET photos = (
  SELECT jsonb_agg(s.e ORDER BY s.k) FROM (
    SELECT t.e, t.i::numeric AS k FROM jsonb_array_elements(r.photos) WITH ORDINALITY AS t(e, i)
    UNION ALL
    SELECT '{"url": "/media/rooms/downstairs-living-1.jpg", "alt": "Downstairs living area with two gray sectional sofas, a wood coffee table and leather lounge chairs on a rug"}'::jsonb,
      coalesce((SELECT t.i FROM jsonb_array_elements(r.photos) WITH ORDINALITY AS t(e, i)
                WHERE t.e ->> 'url' = '/media/rooms/downstairs-kitchenette.jpg' LIMIT 1), 100000) - 0.5
  ) s), updated_at = now()
WHERE r.id IN ('room_emerald', 'room_moonstone')
  AND NOT r.photos @> '[{"url": "/media/rooms/downstairs-living-1.jpg"}]'::jsonb;

INSERT INTO audit_events (actor_label, action, entity)
VALUES ('migration', 'rooms.downstairs_living_photo_added', 'room_types');
