const db = require("../config/db");
const { publishOnce } = require("./checkEntryZincNotification");

const notifyProductionFlowCompletion = async ({ planningId }) => {
  if (!planningId) return { triggered: false, reason: "PLANNING_REQUIRED" };

  const [rows] = await db.query(
    `SELECT pp.id, pp.challan_no, pp.status, COUNT(ppi.id) AS item_count,
            GROUP_CONCAT(
              COALESCE(ppi.challan_no, pp.challan_no)
              ORDER BY ppi.sequence_no SEPARATOR ', '
            ) AS challan_numbers
     FROM production_planning pp
     LEFT JOIN production_planning_items ppi ON ppi.planning_id = pp.id
     WHERE pp.id = ? AND pp.deleted_at IS NULL
     GROUP BY pp.id, pp.challan_no, pp.status
     LIMIT 1`,
    [planningId],
  );
  const planning = rows[0];
  if (!planning || planning.status !== "completed") {
    return { triggered: false, reason: "FLOW_NOT_COMPLETED" };
  }

  return publishOnce({
    type: "production_flow_completed",
    referenceKey: `planning_${planning.id}`,
    title: "Production Plan Completed",
    body: `Production flow is complete for ${planning.challan_numbers || planning.challan_no} (${Number(planning.item_count) || 0} item${Number(planning.item_count) === 1 ? "" : "s"}).`,
    data: {
      type: "production_flow_completed",
      planning_id: String(planning.id),
      challan_no: String(planning.challan_numbers || planning.challan_no || ""),
    },
    roles: ["superadmin", "plant_manager"],
    excludeRoles: ["admin", "supervisor"],
  });
};

module.exports = { notifyProductionFlowCompletion };
