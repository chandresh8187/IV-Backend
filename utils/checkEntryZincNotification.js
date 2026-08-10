const db = require("../config/db");
const { getSetting } = require("../services/appSettingsService");
const { sendNotificationToRoles } = require("./sendNotification");

const publishOnce = async ({ type, referenceKey, title, body, data, io }) => {
  const [claim] = await db.query(
    `INSERT IGNORE INTO notification_logs
     (type, reference_key, title, body)
     VALUES (?, ?, ?, ?)`,
    [type, referenceKey, title, body],
  );

  if (!claim.affectedRows) return;

  try {
    const response = await sendNotificationToRoles({
      roles: ["superadmin", "admin", "supervisor", "plant_manager"],
      title,
      body,
      data,
    });

    io?.emit(type, { ...data, title, body });

    if (!response?.successCount) {
      await db.query(
        "DELETE FROM notification_logs WHERE type = ? AND reference_key = ?",
        [type, referenceKey],
      );
    }
  } catch (error) {
    await db.query(
      "DELETE FROM notification_logs WHERE type = ? AND reference_key = ?",
      [type, referenceKey],
    );
    throw error;
  }
};

const calculateZincPercentage = (msWeight, giWeight) => {
  const ms = Number(msWeight) || 0;
  const gi = Number(giWeight) || 0;

  return ms > 0 ? Number((((gi - ms) / ms) * 100).toFixed(2)) : 0;
};

const checkPlanningZincNotification = async ({ planningId, io }) => {
  if (!planningId) return;

  const [rows] = await db.query(
    `SELECT pp.id,
            pp.challan_no,
            pp.target_zinc_percentage,
            COALESCE(SUM(
              CASE
                WHEN pe.ms_weight > 0 AND pe.gi_weight > 0
                THEN pe.ms_weight * COALESCE(pe.dipping_qty, 0)
                ELSE 0
              END
            ), 0) AS total_ms,
            COALESCE(SUM(
              CASE
                WHEN pe.ms_weight > 0 AND pe.gi_weight > 0
                THEN pe.gi_weight * COALESCE(pe.dipping_qty, 0)
                ELSE 0
              END
            ), 0) AS total_gi
     FROM production_planning pp
     LEFT JOIN production_entries pe
       ON pe.planning_id = pp.id
      AND COALESCE(pe.row_type, 'entry') = 'entry'
     WHERE pp.id = ? AND pp.deleted_at IS NULL
     GROUP BY pp.id, pp.challan_no, pp.target_zinc_percentage
     LIMIT 1`,
    [planningId],
  );

  if (!rows.length) return;

  const planning = rows[0];
  const target = Number(planning.target_zinc_percentage);

  if (!Number.isFinite(target) || target <= 0) return;

  const zinc = calculateZincPercentage(planning.total_ms, planning.total_gi);

  if (zinc <= target) return;

  await publishOnce({
    type: "planning_zinc_alert",
    referenceKey: `planning_${planning.id}_target_${target}`,
    title: "Planning Zinc Target Exceeded",
    body: `Challan ${planning.challan_no || "-"} cumulative zinc consumption is ${zinc}% (target ${target}%)`,
    data: {
      type: "planning_zinc_alert",
      planning_id: String(planning.id),
      challan_no: String(planning.challan_no || ""),
      zinc_consumption: String(zinc),
      threshold: String(target),
    },
    io,
  });
};

const checkEntryZincNotification = async ({ entryId, io }) => {
  const [rows] = await db.query(
    `SELECT id, planning_id, shift_date
     FROM production_entries
     WHERE id = ? LIMIT 1`,
    [entryId],
  );

  if (!rows.length) return;

  const entry = rows[0];

  await checkPlanningZincNotification({
    planningId: entry.planning_id,
    io,
  });

  const setting = await getSetting("zinc_alert_threshold");
  const monthlyTarget = Number(setting.percentage);

  if (
    !setting.enabled ||
    !Number.isFinite(monthlyTarget) ||
    monthlyTarget <= 0
  ) {
    return;
  }

  const month = String(entry.shift_date).slice(0, 7);
  const [totals] = await db.query(
    `SELECT COALESCE(SUM(ms_total), 0) total_ms,
            COALESCE(SUM(gi_total), 0) total_gi
     FROM (
       SELECT shift_date,
              material,
              AVG(NULLIF(ms_weight, 0)) * SUM(COALESCE(dipping_qty, 0)) ms_total,
              AVG(NULLIF(gi_weight, 0)) * SUM(COALESCE(dipping_qty, 0)) gi_total
       FROM production_entries
       WHERE DATE_FORMAT(shift_date, '%Y-%m') = ?
         AND COALESCE(row_type, 'entry') = 'entry'
       GROUP BY shift_date, material
     ) monthly_materials`,
    [month],
  );

  const monthlyZinc = calculateZincPercentage(
    totals[0].total_ms,
    totals[0].total_gi,
  );

  if (monthlyZinc <= monthlyTarget) return;

  await publishOnce({
    type: "monthly_zinc_alert",
    referenceKey: `month_${month}_threshold_${monthlyTarget}`,
    title: "Monthly Zinc Consumption Alert",
    body: `${month} zinc consumption is ${monthlyZinc}% (monthly limit ${monthlyTarget}%)`,
    data: {
      type: "monthly_zinc_alert",
      month,
      zinc_consumption: String(monthlyZinc),
      threshold: String(monthlyTarget),
    },
    io,
  });
};

module.exports = {
  checkEntryZincNotification,
  checkPlanningZincNotification,
};
