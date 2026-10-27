-- Confirmed retreat details: dates, venue, per-guest pricing and room capacities.
-- Room prices are unchanged. The Emerald and Obsidian price difference is still awaiting the client's decision.

UPDATE retreats SET
  start_date = '2027-03-06',
  end_date = '2027-03-10',
  nights = 4,
  dates_confirmed = true,
  venue_name = 'Peace on the Pond',
  venue_city = 'Douglasville, Georgia',
  venue_confirmed = true,
  updated_at = now()
WHERE is_current = true;

UPDATE room_types SET price_basis = 'per_guest', updated_at = now();

UPDATE room_types SET guest_capacity = c.capacity, updated_at = now()
FROM (VALUES
  ('room_sapphire', 1),
  ('room_tigers_eye', 2),
  ('room_emerald', 2),
  ('room_obsidian', 2),
  ('room_moonstone', 3),
  ('room_sofa_1', 2),
  ('room_sofa_2', 2)
) AS c(id, capacity)
WHERE room_types.id = c.id;

INSERT INTO audit_events (actor_label, action, entity, after)
VALUES ('migration', 'retreat.confirmed_details', 'retreat', jsonb_build_object(
  'start_date', '2027-03-06', 'end_date', '2027-03-10', 'nights', 4,
  'venue_name', 'Peace on the Pond', 'venue_city', 'Douglasville, Georgia',
  'price_basis', 'per_guest',
  'guest_capacity', jsonb_build_object('room_sapphire', 1, 'room_tigers_eye', 2, 'room_emerald', 2, 'room_obsidian', 2,
    'room_moonstone', 3, 'room_sofa_1', 2, 'room_sofa_2', 2)));
