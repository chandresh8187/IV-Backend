const db = require("../config/db");

const { getSetting } = require("../services/appSettingsService");

const { sendNotificationToRoles } = require("./sendNotification");

const checkEntryZincNotification = async ({ entryId, io }) => {
  const setting = await getSetting("zinc_alert_threshold");

  if (!setting.enabled) {
    return;
  }

  const threshold = Number(setting.percentage);

  if (!Number.isFinite(threshold) || threshold <= 0) {
    return;
  }

  const [rows] = await db.query(
    `SELECT
           id,
           sr_no,
           challan_no,
           party_name,
           material,
           zinc_percentage
         FROM production_entries
         WHERE id = ?
         LIMIT 1`,
    [entryId],
  );

  if (!rows.length) {
    return;
  }

  const entry = rows[0];

  const zinc = Number(entry.zinc_percentage) || 0;

  if (zinc < threshold) {
    return;
  }

  /*
   * The threshold is included in the
   * reference key.
   *
   * If the superadmin changes the
   * threshold later, an existing
   * production entry can generate one
   * alert for the new threshold.
   */
  const referenceKey = `entry_${entry.id}` + `_threshold_${threshold}`;

  const [alreadySent] = await db.query(
    `SELECT id
         FROM notification_logs
         WHERE
           type = 'entry_zinc_alert'
           AND reference_key = ?
         LIMIT 1`,
    [referenceKey],
  );

  if (alreadySent.length) {
    return;
  }

  const title = "High Zinc Consumption Alert";

  const body =
    `SR ${entry.sr_no} zinc ` +
    `consumption is ${zinc}% ` +
    `(limit ${threshold}%) ` +
    `for challan ` +
    `${entry.challan_no || "-"}`;

  await sendNotificationToRoles({
    roles: ["superadmin", "admin", "supervisor"],

    title,
    body,

    data: {
      type: "entry_zinc_alert",

      entry_id: String(entry.id),

      sr_no: String(entry.sr_no),

      challan_no: String(entry.challan_no || ""),

      zinc_consumption: String(zinc),

      threshold: String(threshold),
    },
  });

  await db.query(
    `INSERT INTO notification_logs (
         type,
         reference_key,
         title,
         body
       )
       VALUES (?, ?, ?, ?)`,
    ["entry_zinc_alert", referenceKey, title, body],
  );

  io?.emit("entry_zinc_alert", {
    entry_id: entry.id,
    sr_no: entry.sr_no,

    challan_no: entry.challan_no,

    zinc_consumption: zinc,

    threshold,
  });
};

module.exports = {
  checkEntryZincNotification,
};
