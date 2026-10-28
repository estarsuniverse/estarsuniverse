-- The downstairs queen sofa beds are no longer offered. They are hidden from the public page (room cards,
-- Investment list and the Secure your spot dropdown) but kept, with their details and photos, in Rooms and Inventory.
-- Turn "visible" back on there to offer them again.

INSERT INTO audit_events (actor_label, action, entity, entity_id, before, after)
SELECT 'migration', 'room.hidden', 'room_type', id, jsonb_build_object('visible', visible), '{"visible": false}'::jsonb
FROM room_types WHERE id IN ('room_sofa_1', 'room_sofa_2') AND visible;

UPDATE room_types SET visible = false, updated_at = now() WHERE id IN ('room_sofa_1', 'room_sofa_2') AND visible;
