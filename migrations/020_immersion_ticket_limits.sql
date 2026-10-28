-- Day immersions: 20 tickets each. Only immersions without a limit yet are changed, so limits set in Tickets are kept.

INSERT INTO audit_events (actor_label, action, entity, entity_id, before, after)
SELECT 'migration', 'retreat.immersions_changed', 'retreat', id, jsonb_build_object('immersions', immersions), NULL
FROM retreats WHERE is_current;

UPDATE retreats SET updated_at = now(), immersions = (
  SELECT coalesce(jsonb_agg(CASE WHEN i.e ->> 'ticket_limit' IS NULL THEN i.e || '{"ticket_limit": 20}'::jsonb ELSE i.e END ORDER BY i.n), '[]'::jsonb)
  FROM jsonb_array_elements(immersions) WITH ORDINALITY AS i(e, n))
WHERE is_current;

UPDATE audit_events SET after = (SELECT jsonb_build_object('immersions', immersions) FROM retreats WHERE is_current)
WHERE id = (SELECT max(id) FROM audit_events WHERE action = 'retreat.immersions_changed' AND actor_label = 'migration');
