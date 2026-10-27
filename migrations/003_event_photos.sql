-- Photos from Estar's past gatherings for The Experience gallery (experience.photos), in draft and published.
-- The first six make the mosaic. host.photoUrl is unchanged: none of these is a portrait of Estar on her own.

WITH p(photos) AS (SELECT '[
  {"id": "ex1", "url": "/media/events/group-stretch-pavilion.jpg", "caption": "Group stretch",
   "alt": "Five women seated cross-legged on yoga mats with their arms raised overhead, in an open-air pavilion with a polished wood floor and tropical plants outside"},
  {"id": "ex2", "url": "/media/events/back-to-back-smiling.jpg", "caption": "Back to back",
   "alt": "Two women standing back to back with arms linked, both smiling, in front of a white wall"},
  {"id": "ex3", "url": "/media/events/hands-on-rest-two-women.jpg", "caption": "Hands-on support",
   "alt": "A woman in a head wrap leans over two women resting forward on a yoga mat, with her hands on their backs, in an open-air pavilion"},
  {"id": "ex4", "url": "/media/events/arms-linked-laughing.jpg", "caption": "Arms linked",
   "alt": "Two women laughing as they stand back to back with arms linked, with greenery visible through the open sides of the room behind them"},
  {"id": "ex5", "url": "/media/events/partner-boat-pose.jpg", "caption": "Partner boat pose",
   "alt": "Two women facing each other on a yoga mat in a partner boat pose, holding hands with the soles of their feet pressed together"},
  {"id": "ex6", "url": "/media/events/group-embrace-pavilion.jpg", "caption": "Group embrace",
   "alt": "Five women kneeling together in a group embrace on yoga mats in an open-air pavilion, with trees behind them"},
  {"id": "ex7", "url": "/media/events/hands-on-rest-pavilion.jpg", "caption": "Resting forward",
   "alt": "A woman in a head wrap lunges beside two women resting forward on a yoga mat and presses her hands on their backs, with large open windows and trees behind them"},
  {"id": "ex8", "url": "/media/events/assisted-forward-bend.jpg", "caption": "Assisted forward bend",
   "alt": "A woman in a head wrap leans against a white wall and places her hands on the back of a woman bending forward on a yoga mat"},
  {"id": "ex9", "url": "/media/events/hands-on-stretch.jpg", "caption": "Hands-on stretch",
   "alt": "Close-up of hands pressing on the upper back of a woman bending forward over a yoga mat, with others stretching in the background"},
  {"id": "ex10", "url": "/media/events/group-embrace-closeup.jpg", "caption": "Embrace",
   "alt": "Several women holding each other in a close embrace on a wooden floor, while a woman in a head wrap behind them smiles with her eyes closed and her hands raised"}
]'::jsonb)
UPDATE content SET
  draft = jsonb_set(draft, '{experience,photos}', p.photos, true),
  published = jsonb_set(published, '{experience,photos}', p.photos, true)
FROM p
WHERE key = 'site';

INSERT INTO audit_events (actor_label, action, entity, entity_id)
VALUES ('migration', 'content.experience_photos_added', 'content', 'site');
