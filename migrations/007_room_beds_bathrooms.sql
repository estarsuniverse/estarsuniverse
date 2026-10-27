-- Beds, bathrooms and accessibility from the client and the Peace on the Pond suites flyer.
-- Double occupancy = two beds; en suite = a private bathroom. Room privacy is no longer shown, so it is cleared.
-- Sofa-bed bathroom and accessibility are not confirmed yet and are left as they are.

UPDATE room_types SET beds = v.beds, bathroom = coalesce(v.bathroom, room_types.bathroom),
  accessibility = coalesce(v.accessibility, room_types.accessibility), privacy = NULL, updated_at = now()
FROM (VALUES
  ('room_sapphire',   '1 queen bed',       'Private en suite bathroom', 'Upstairs.'),
  ('room_tigers_eye', '2 queen beds',      'Private en suite bathroom with a soaker tub wet room', 'Upstairs.'),
  ('room_emerald',    '2 queen beds',      'Private en suite bathroom', 'Downstairs, with a kitchenette, living room space and a separate full bathroom.'),
  ('room_obsidian',   '2 queen beds',      'Private en suite bathroom', 'Upstairs.'),
  ('room_moonstone',  '3 queen beds',      'Detached shared full bathroom', 'Downstairs, with a kitchenette, living room space and a separate full bathroom.'),
  ('room_sofa_1',     '1 queen sofa bed',  NULL, NULL),
  ('room_sofa_2',     '1 queen sofa bed',  NULL, NULL)
) AS v(id, beds, bathroom, accessibility)
WHERE room_types.id = v.id;

UPDATE room_types SET privacy = NULL WHERE privacy IS NOT NULL;

INSERT INTO audit_events (actor_label, action, entity)
VALUES ('migration', 'rooms.beds_bathrooms_accessibility', 'room_types');
