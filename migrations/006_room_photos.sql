-- Room photos from the Peace on the Pond suites flyer (used with permission). Bedroom first; the first photo is the room's main photo.
-- Tiger's Eye uses the flyer's Sunstone suite photos (the same room). The sofa beds have no photos yet.
-- These are cropped from the flyer, so they are small; replace them with the full-size originals in Rooms and Inventory when available.
-- Only rooms that have no photos yet are filled, so nothing added in the admin is overwritten.

UPDATE room_types SET photos = v.photos::jsonb, updated_at = now()
FROM (VALUES
  ('room_emerald', '[
    {"url": "/media/rooms/emerald-1.jpg", "alt": "Bedroom with a green velvet headboard and green bedding, a chandelier and green barn doors"},
    {"url": "/media/rooms/emerald-2.jpg", "alt": "Bedroom with green bedding, a chandelier, a green barn door and glass doors to the outside"},
    {"url": "/media/rooms/emerald-3.jpg", "alt": "Bathroom with a white vanity, gold fixtures, a gold-framed mirror and a shower tiled in dark green"}]'),
  ('room_moonstone', '[
    {"url": "/media/rooms/moonstone-1.jpg", "alt": "Bedroom with beds in white and gray bedding and a window to the trees"},
    {"url": "/media/rooms/moonstone-2.jpg", "alt": "Bathroom with white vanities, black fixtures and a round mirror"},
    {"url": "/media/rooms/moonstone-3.jpg", "alt": "Bathroom with a white vanity and a tub with a glass shower screen"}]'),
  ('room_obsidian', '[
    {"url": "/media/rooms/obsidian-1.jpg", "alt": "Bedroom with two beds with black metal frames and white bedding, and a dark accent wall"},
    {"url": "/media/rooms/obsidian-2.jpg", "alt": "Room with a dark wood-paneled wall and a potted palm, with a bed and windows beyond"},
    {"url": "/media/rooms/obsidian-3.jpg", "alt": "Covered balcony with a white armchair and open glass doors to the bedroom"},
    {"url": "/media/rooms/obsidian-4.jpg", "alt": "Bathroom with a walk-in shower tiled in dark and bronze tones"}]'),
  ('room_tigers_eye', '[
    {"url": "/media/rooms/tigers-eye-1.jpg", "alt": "Bedroom with gold bedding, a chandelier and glass doors to a deck"},
    {"url": "/media/rooms/tigers-eye-2.jpg", "alt": "The same bedroom from another angle, with gold bedding and a chandelier"},
    {"url": "/media/rooms/tigers-eye-3.jpg", "alt": "Bathroom with a freestanding soaking tub inside a glass-walled marble shower"},
    {"url": "/media/rooms/tigers-eye-4.jpg", "alt": "Double vanity with gold fixtures, round-cornered mirrors and gold towels"}]'),
  ('room_sapphire', '[
    {"url": "/media/rooms/sapphire-1.jpg", "alt": "Bedroom with a navy accent wall, white bedding, blue armchairs and white barn doors"},
    {"url": "/media/rooms/sapphire-2.jpg", "alt": "Bedroom with a blue tufted headboard, white bedding, a blue armchair and a ceiling fan"},
    {"url": "/media/rooms/sapphire-3.jpg", "alt": "Bathroom vanity with a large mirror and a window to the trees"},
    {"url": "/media/rooms/sapphire-4.jpg", "alt": "Shower tiled in dark blue with a glass door, beside a window"}]')
) AS v(id, photos)
WHERE room_types.id = v.id AND room_types.photos = '[]'::jsonb;

INSERT INTO audit_events (actor_label, action, entity)
VALUES ('migration', 'rooms.photos_added', 'room_types');
