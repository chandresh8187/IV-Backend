const getActivePlanningItem = async (queryable, { lock = false } = {}) => {
  const [rows] = await queryable.query(
    `SELECT
       pp.id AS planning_id,
       COALESCE(ppi.challan_no, pp.challan_no) AS challan_no,
       COALESCE(ppi.party_name, pp.party_name, '') AS party_name,
       pp.created_at AS planning_created_at,
       ppi.id AS planning_item_id,
       ppi.item_id,
       ppi.material_description,
       ppi.planned_qty,
       ppi.completed_qty,
       (ppi.planned_qty - ppi.completed_qty) AS remaining_qty,
       ppi.target_zinc_percentage,
       ppi.sequence_no
     FROM production_planning pp
     INNER JOIN production_planning_items ppi ON ppi.planning_id = pp.id
     WHERE pp.deleted_at IS NULL
       AND pp.status = 'pending'
       AND ppi.status = 'pending'
       AND ppi.planned_qty > ppi.completed_qty
     ORDER BY pp.created_at ASC, pp.id ASC, ppi.sequence_no ASC
     LIMIT 1${lock ? " FOR UPDATE" : ""}`,
  );

  return rows[0] || null;
};

const recalculatePlanningProgress = async (queryable, planningId) => {
  const [planningRows] = await queryable.query(
    `SELECT id, status
     FROM production_planning
     WHERE id = ?
     LIMIT 1`,
    [planningId],
  );
  if (!planningRows.length) return null;

  const [planningItems] = await queryable.query(
    `SELECT id, planned_qty
     FROM production_planning_items
     WHERE planning_id = ?
     ORDER BY sequence_no ASC`,
    [planningId],
  );

  for (const planningItem of planningItems) {
    const [totals] = await queryable.query(
      `SELECT COALESCE(SUM(dipping_qty), 0) AS completed_qty
       FROM production_entries
       WHERE COALESCE(row_type, 'entry') = 'entry'
         AND (
           planning_item_id = ?
           OR (
             planning_item_id IS NULL
             AND planning_id = ?
             AND ? = 1
           )
         )`,
      [planningItem.id, planningId, planningItems.length],
    );
    const completedQty = Number(totals[0]?.completed_qty) || 0;

    await queryable.query(
      `UPDATE production_planning_items
       SET completed_qty = ?,
           status = CASE WHEN planned_qty <= ? THEN 'completed' ELSE 'pending' END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [completedQty, completedQty, planningItem.id],
    );
  }

  const [summaryRows] = await queryable.query(
    `SELECT
       COALESCE(SUM(planned_qty), 0) AS planned_qty,
       COALESCE(SUM(completed_qty), 0) AS completed_qty
     FROM production_planning_items
     WHERE planning_id = ?`,
    [planningId],
  );
  const plannedQty = Number(summaryRows[0]?.planned_qty) || 0;
  const completedQty = Number(summaryRows[0]?.completed_qty) || 0;
  const status =
    planningRows[0].status === "canceled"
      ? "canceled"
      : plannedQty > 0 && completedQty >= plannedQty
        ? "completed"
        : "pending";

  await queryable.query(
    `UPDATE production_planning
     SET planned_qty = ?, completed_qty = ?, status = ?
     WHERE id = ?`,
    [plannedQty, completedQty, status, planningId],
  );

  return {
    planning_id: Number(planningId),
    planned_qty: plannedQty,
    completed_qty: completedQty,
    status,
    completed_now:
      planningRows[0].status !== "completed" && status === "completed",
  };
};

module.exports = {
  getActivePlanningItem,
  recalculatePlanningProgress,
};
