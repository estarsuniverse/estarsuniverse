-- No one shares a bed: every guest in a shared room has a separate bed.
-- Each downstairs queen sofa bed is therefore for 1 guest (prices unchanged).

UPDATE room_types SET guest_capacity = 1, updated_at = now() WHERE id IN ('room_sofa_1', 'room_sofa_2');

UPDATE content SET draft = jsonb_set(draft, '{stay,sharedNote}', '"Every guest has a separate bed. No one shares a bed, including in shared rooms."')
WHERE key = 'site' AND draft #>> '{stay,sharedNote}' = 'A shared room does not guarantee a separate bed. Bed layouts are listed for each room once confirmed.';

UPDATE content SET published = jsonb_set(published, '{stay,sharedNote}', '"Every guest has a separate bed. No one shares a bed, including in shared rooms."')
WHERE key = 'site' AND published #>> '{stay,sharedNote}' = 'A shared room does not guarantee a separate bed. Bed layouts are listed for each room once confirmed.';

INSERT INTO audit_events (actor_label, action, entity)
VALUES ('migration', 'rooms.separate_beds', 'room_types');
