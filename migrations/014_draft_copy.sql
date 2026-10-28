-- New page copy in Estar's voice, for her approval. DRAFT ONLY: review it at /?preview=1 and publish from
-- Content and Branding. Adds the "What you'll take home" and "Your investment" sections and a note on the pace of the days.

CREATE FUNCTION pg_temp.estar_copy(c jsonb) RETURNS jsonb LANGUAGE sql AS $fn$
SELECT jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(c,
  '{hero,sub}', '"Five days of movement, music, breath and sistarhood at Peace on the Pond, guided by Estar, the Singing Yogini."'),
  '{overview,body}', to_jsonb('Eye am creating a sanctuary for wombmen who are ready to slow down, return home to their bodies, and remember the pleasure, power and creativity that live within them.

For five days at Peace on the Pond, we will move, breathe, sing, rest and gather in sistarhood. Every day is woven with spaciousness, so you have time to receive, integrate and simply be.

This retreat is for you if you are craving a deeper intimacy with yourself, a softer pace, and a circle of wombmen who will hold you as you are. Come as you are. Eye will meet you there.'::text)),
  '{experience,welcomes}', '"This retreat welcomes wombmen who feel called to slow down, reconnect with their bodies, awaken their creative life force and be held in a circle of sistarhood. Whether you come on your own or with a sistar, you will be welcomed home."'),
  '{experience,rhythm}', '"Eye don’t want any day to feel crowded. Spaciousness is just as important as the experiences themselves, so there will be time to rest, integrate what you are receiving, and simply be."', true),
  '{transformation}', '{
    "heading": "What you’ll take home",
    "intro": "Eye want every wombman to leave with more than memories: a deeper relationship with her body, her voice and her own divine expression.",
    "items": [
      {"id": "t1", "title": "Come home to your body", "text": "Yoga, breathwork and intuitive movement to reconnect you with the wisdom and sensation of your body."},
      {"id": "t2", "title": "Awaken your voice", "text": "Vocal activation and sound healing to free your expression and stir your creative life force."},
      {"id": "t3", "title": "Deepen your intimacy with yourself", "text": "Embodiment practices that invite you closer to your pleasure, your power and your divine expression."},
      {"id": "t4", "title": "Rest and be held", "text": "Nourishing meals, time in nature and a circle of wombmen who hold space for you."},
      {"id": "t5", "title": "Carry it with you", "text": "Rituals and integration practices to help you bring what you receive back into your daily life."}
    ]}'::jsonb, true),
  '{investments}', '{
    "heading": "Your investment",
    "intro": "Every room includes the complete retreat experience: your accommodations, scheduled meals, sacred ceremonies, movement sessions, workshops and all retreat programming. Prices are per guest.",
    "paymentNote": "Secure your sanctuary with a 30% deposit. The remaining balance is divided into installments leading up to the retreat. Deposits are nonrefundable, and transfers may be considered with advance notice and approval."
  }'::jsonb, true)
$fn$;

UPDATE content SET draft = pg_temp.estar_copy(draft), draft_updated_at = now(), draft_updated_by = 'migration' WHERE key = 'site';

INSERT INTO audit_events (actor_label, action, entity, entity_id)
VALUES ('migration', 'content.draft_copy_for_approval', 'content', 'site');
