const db = require("../config/db");
const { sendNotificationToRoles } = require("./sendNotification");

const checkPlanningCompletion = async ({ challanNo, io }) => {
  if (!challanNo) return;

  const [planningRows] = await db.query(
    `
    SELECT *
    FROM production_planning
    WHERE challan_no = ?
    AND status = 'pending'
    LIMIT 1
    `,
    [challanNo],
  );

  if (planningRows.length === 0) return;

  const planning = planningRows[0];

  const [qtyRows] = await db.query(
    `
    SELECT COALESCE(SUM(dipping_qty), 0) AS completed_qty
    FROM production_entries
    WHERE challan_no = ?
    `,
    [challanNo],
  );

  const completedQty = Number(qtyRows[0]?.completed_qty) || 0;

  await db.query(
    `
    UPDATE production_planning
    SET completed_qty = ?
    WHERE id = ?
    `,
    [completedQty, planning.id],
  );

  if (completedQty >= Number(planning.planned_qty)) {
    await db.query(
      `
      UPDATE production_planning
      SET status = 'completed',
          completed_qty = ?
      WHERE id = ?
      `,
      [completedQty, planning.id],
    );

    io.emit("production_planning_updated", {
      action: "completed",
      id: planning.id,
      challan_no: planning.challan_no,
    });

    await sendNotificationToRoles({
      roles: ["production_manager", "superadmin"],
      title: "Planning Completed",
      body: `Challan ${planning.challan_no} production completed ${completedQty}/${planning.planned_qty} NOS`,
      data: {
        type: "planning_completed",
        planning_id: planning.id,
        challan_no: planning.challan_no,
      },
    });
  }
};

module.exports = {
  checkPlanningCompletion,
};
