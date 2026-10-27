-- The downstairs kitchenette (from peaceonthepond.com) is shared by the downstairs rooms, Emerald and Moonstone.
-- Added as their last photo; skipped for a room that already has it.

UPDATE room_types SET photos = photos || '[{"url": "/media/rooms/downstairs-kitchenette.jpg",
  "alt": "Downstairs kitchenette with white cabinets, a sink and a microwave, and small tables with leather chairs in front of a black patterned wall"}]'::jsonb,
  updated_at = now()
WHERE id IN ('room_emerald', 'room_moonstone')
  AND NOT photos @> '[{"url": "/media/rooms/downstairs-kitchenette.jpg"}]'::jsonb;

INSERT INTO audit_events (actor_label, action, entity)
VALUES ('migration', 'rooms.kitchenette_photo_added', 'room_types');
