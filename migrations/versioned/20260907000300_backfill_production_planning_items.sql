INSERT IGNORE INTO production_planning_items
  (planning_id, item_id, material_description, planned_qty, completed_qty, target_zinc_percentage, sequence_no, status)
SELECT
  pp.id,
  NULL,
  COALESCE(NULLIF(TRIM(pp.material_description), ''), 'Legacy material'),
  pp.planned_qty,
  LEAST(pp.completed_qty, pp.planned_qty),
  pp.target_zinc_percentage,
  1,
  CASE
    WHEN pp.status = 'completed' OR pp.completed_qty >= pp.planned_qty THEN 'completed'
    ELSE 'pending'
  END
FROM production_planning pp
WHERE pp.planned_qty > 0;
