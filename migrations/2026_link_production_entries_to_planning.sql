-- Run once before deploying the updated backend.
ALTER TABLE production_entries
  ADD COLUMN planning_id INT NULL AFTER shift_name,
  ADD INDEX idx_production_entries_planning_id (planning_id),
  ADD CONSTRAINT fk_production_entries_planning
    FOREIGN KEY (planning_id) REFERENCES production_planning(id);

-- Link historical rows only when their challan number identifies exactly one plan.
UPDATE production_entries pe
JOIN (
  SELECT challan_no, MIN(id) AS planning_id
  FROM production_planning
  GROUP BY challan_no
  HAVING COUNT(*) = 1
) matched ON matched.challan_no = pe.challan_no
SET pe.planning_id = matched.planning_id
WHERE pe.planning_id IS NULL;

UPDATE production_planning pp
LEFT JOIN (
  SELECT planning_id, COALESCE(SUM(dipping_qty), 0) AS completed_qty
  FROM production_entries
  WHERE planning_id IS NOT NULL
  GROUP BY planning_id
) totals ON totals.planning_id = pp.id
SET pp.completed_qty = COALESCE(totals.completed_qty, 0),
    pp.status = CASE
      WHEN pp.status = 'canceled' THEN 'canceled'
      WHEN COALESCE(totals.completed_qty, 0) >= pp.planned_qty THEN 'completed'
      ELSE 'pending'
    END;
