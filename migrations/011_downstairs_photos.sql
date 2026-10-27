-- Downstairs photos: the living area (supplied by the client) for the two sofa beds, which are in that area,
-- plus the shared kitchenette and the detached balcony with a jacuzzi (from peaceonthepond.com).
-- The balcony is also added to Moonstone, which shares it. Only empty or missing photos are filled.

UPDATE room_types SET photos = '[
  {"url": "/media/rooms/downstairs-living-1.jpg", "alt": "Downstairs living area with two gray sectional sofas, a wood coffee table and leather lounge chairs on a rug"},
  {"url": "/media/rooms/downstairs-living-2.jpg", "alt": "Downstairs living area with a gray sectional sofa against a black patterned wall, leather chairs and a wall-mounted TV"},
  {"url": "/media/rooms/downstairs-living-3.jpg", "alt": "Long view of the downstairs living area with light wood floors, a gray sectional sofa and small dining tables in the distance"},
  {"url": "/media/rooms/downstairs-living-4.jpg", "alt": "Small dining tables with leather chairs, looking toward the downstairs living area and a gray sectional sofa"},
  {"url": "/media/rooms/downstairs-kitchenette.jpg", "alt": "Downstairs kitchenette with white cabinets, a sink and a microwave, and small tables with leather chairs in front of a black patterned wall"},
  {"url": "/media/rooms/downstairs-balcony.jpg", "alt": "Covered downstairs patio with a hot tub, lounge chairs and a wooden coffee table beside a white brick wall"}
]'::jsonb, updated_at = now()
WHERE id IN ('room_sofa_1', 'room_sofa_2') AND photos = '[]'::jsonb;

UPDATE room_types SET photos = photos || '[{"url": "/media/rooms/downstairs-balcony.jpg",
  "alt": "Covered downstairs patio with a hot tub, lounge chairs and a wooden coffee table beside a white brick wall"}]'::jsonb,
  updated_at = now()
WHERE id = 'room_moonstone' AND NOT photos @> '[{"url": "/media/rooms/downstairs-balcony.jpg"}]'::jsonb;

INSERT INTO audit_events (actor_label, action, entity)
VALUES ('migration', 'rooms.downstairs_photos_added', 'room_types');
