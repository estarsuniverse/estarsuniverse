-- Downstairs area: the sofa beds are in the same area as Moonstone and share its bathroom,
-- and Moonstone and the sofa beds share a detached downstairs balcony with a jacuzzi.

UPDATE room_types SET bathroom = 'Detached shared full bathroom',
  accessibility = 'Downstairs, with a kitchenette, living room space and a separate full bathroom.', updated_at = now()
WHERE id IN ('room_sofa_1', 'room_sofa_2');

UPDATE room_types SET features = 'Shared detached balcony with a jacuzzi', updated_at = now()
WHERE id IN ('room_moonstone', 'room_sofa_1', 'room_sofa_2');

INSERT INTO audit_events (actor_label, action, entity)
VALUES ('migration', 'rooms.downstairs_bathroom_balcony', 'room_types');
