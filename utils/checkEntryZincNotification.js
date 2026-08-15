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

  const notificationData = {
    ...data,
    notification_key: referenceKey,
  };

  io?.emit(type, { ...notificationData, title, body });

  try {
    const response = await sendNotificationToRoles({
      roles: ["superadmin", "admin", "supervisor", "plant_manager"],
      title,
      body,
      data: notificationData,
    });

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

const hasReachedZincTarget = (zinc, target) =>
  Number.isFinite(zinc) &&
  Number.isFinite(target) &&
  target > 0 &&
  zinc >= target;

const publishPlanningEntryAlert = async ({ entry, io }) => {
  const target = Number(entry.target_zinc_percentage);
  const storedZinc =
    entry.zinc_percentage == null || entry.zinc_percentage === ""
      ? null
      : Number(entry.zinc_percentage);
  const zinc = Number.isFinite(storedZinc)
    ? storedZinc
    : calculateZincPercentage(entry.ms_weight, entry.gi_weight);

  if (!hasReachedZincTarget(zinc, target)) return;

  await publishOnce({
    type: "planning_zinc_alert",
    referenceKey: `entry_${entry.id}_planning_${entry.planning_id}_target_${target}`,
    title: "Production Zinc Target Reached",
    body: `Challan ${entry.challan_no || "-"}, SR ${entry.sr_no || "-"} zinc consumption is ${zinc}% (target ${target}%)`,
    data: {
      type: "planning_zinc_alert",
      production_entry_id: String(entry.id),
      planning_id: String(entry.planning_id),
      challan_no: String(entry.challan_no || ""),
      sr_no: String(entry.sr_no || ""),
      zinc_consumption: String(zinc),
      threshold: String(target),
    },
    io,
  });
};

const checkPlanningZincNotification = async ({ planningId, io }) => {
  if (!planningId) return;

  const [rows] = await db.query(
    `SELECT pe.id,
            pe.planning_id,
            pe.sr_no,
            pe.challan_no,
            pe.ms_weight,
            pe.gi_weight,
            pe.zinc_percentage,
            pp.target_zinc_percentage
     FROM production_entries pe
     INNER JOIN production_planning pp
       ON pp.id = pe.planning_id
      AND pp.deleted_at IS NULL
     WHERE pe.planning_id = ?
       AND COALESCE(pe.row_type, 'entry') = 'entry'
       AND pp.target_zinc_percentage > 0
       AND COALESCE(
         pe.zinc_percentage,
         ROUND(((pe.gi_weight - pe.ms_weight) / NULLIF(pe.ms_weight, 0)) * 100, 2)
       ) >= pp.target_zinc_percentage
     ORDER BY pe.id DESC
     LIMIT 1`,
    [planningId],
  );

  if (!rows.length) return;
  await publishPlanningEntryAlert({ entry: rows[0], io });
};

const checkEntryZincNotification = async ({ entryId, io }) => {
  const [rows] = await db.query(
    `SELECT pe.id,
            pe.planning_id,
            pe.sr_no,
            pe.challan_no,
            pe.shift_date,
            pe.ms_weight,
            pe.gi_weight,
            pe.zinc_percentage,
            pp.target_zinc_percentage
     FROM production_entries pe
     LEFT JOIN production_planning pp
       ON pp.id = pe.planning_id
      AND pp.deleted_at IS NULL
     WHERE pe.id = ? LIMIT 1`,
    [entryId],
  );

  if (!rows.length) return;

  const entry = rows[0];

  if (entry.planning_id) {
    await publishPlanningEntryAlert({ entry, io });
  }

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

  if (!hasReachedZincTarget(monthlyZinc, monthlyTarget)) return;

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
  calculateZincPercentage,
  checkEntryZincNotification,
  checkPlanningZincNotification,
  hasReachedZincTarget,
};
