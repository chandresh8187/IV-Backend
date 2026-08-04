const db = require("../config/db");
const { getSetting } = require("../services/appSettingsService");
const { sendNotificationToRoles } = require("./sendNotification");

const publishOnce = async ({ type, referenceKey, title, body, data, io }) => {
  const [sent] = await db.query(
    "SELECT id FROM notification_logs WHERE type=? AND reference_key=? LIMIT 1",
    [type, referenceKey],
  );
  if (sent.length) return;
  await sendNotificationToRoles({
    roles: ["superadmin", "admin", "supervisor"],
    title,
    body,
    data,
  });
  await db.query(
    "INSERT IGNORE INTO notification_logs (type, reference_key, title, body) VALUES (?, ?, ?, ?)",
    [type, referenceKey, title, body],
  );
  io?.emit(type, data);
};

const checkEntryZincNotification = async ({ entryId, io }) => {
  const [rows] = await db.query(
    `SELECT pe.id, pe.sr_no, pe.challan_no, pe.zinc_percentage, pe.shift_date,
            pp.id planning_id, pp.target_zinc_percentage
     FROM production_entries pe
     LEFT JOIN production_planning pp ON pp.id=pe.planning_id
     WHERE pe.id=? LIMIT 1`,
    [entryId],
  );
  if (!rows.length) return;
  const entry = rows[0];
  const zinc = Number(entry.zinc_percentage) || 0;
  const planningTarget = Number(entry.target_zinc_percentage);

  if (Number.isFinite(planningTarget) && planningTarget > 0 && zinc > planningTarget) {
    await publishOnce({
      type: "planning_zinc_alert",
      referenceKey: `entry_${entry.id}_planning_${entry.planning_id}_target_${planningTarget}`,
      title: "Planning Zinc Target Exceeded",
      body: `SR ${entry.sr_no} zinc consumption is ${zinc}% (challan target ${planningTarget}%) for ${entry.challan_no || "-"}`,
      data: {
        type: "planning_zinc_alert",
        entry_id: String(entry.id),
        planning_id: String(entry.planning_id || ""),
        challan_no: String(entry.challan_no || ""),
        zinc_consumption: String(zinc),
        threshold: String(planningTarget),
      },
      io,
    });
  }

  const setting = await getSetting("zinc_alert_threshold");
  const monthlyTarget = Number(setting.percentage);
  if (!setting.enabled || !Number.isFinite(monthlyTarget) || monthlyTarget <= 0) return;

  const month = String(entry.shift_date).slice(0, 7);
  const [totals] = await db.query(
    `SELECT COALESCE(SUM(ms_total),0) total_ms, COALESCE(SUM(gi_total),0) total_gi
     FROM (
       SELECT shift_date, material,
              AVG(NULLIF(ms_weight,0))*SUM(COALESCE(dipping_qty,0)) ms_total,
              AVG(NULLIF(gi_weight,0))*SUM(COALESCE(dipping_qty,0)) gi_total
       FROM production_entries
       WHERE DATE_FORMAT(shift_date,'%Y-%m')=? AND COALESCE(row_type,'entry')='entry'
       GROUP BY shift_date, material
     ) monthly_materials`,
    [month],
  );
  const ms = Number(totals[0].total_ms) || 0;
  const gi = Number(totals[0].total_gi) || 0;
  const monthlyZinc = ms > 0 ? Number((((gi - ms) / ms) * 100).toFixed(2)) : 0;
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

module.exports = { checkEntryZincNotification };
