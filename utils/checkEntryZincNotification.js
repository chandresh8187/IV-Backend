const db = require("../config/db");
const { sendNotificationToRoles } = require("./sendNotification");

const checkEntryZincNotification = async ({ entryId, io }) => {
  const [rows] = await db.query(
    `
    SELECT
      id,
      sr_no,
      challan_no,
      party_name,
      material,
      zinc_percentage
    FROM production_entries
    WHERE id = ?
    LIMIT 1
    `,
    [entryId],
  );

  if (rows.length === 0) return;

  const entry = rows[0];
  const zinc = Number(entry.zinc_percentage) || 0;

  if (zinc < 7.5) return;

  const referenceKey = `entry_${entry.id}`;

  const [alreadySent] = await db.query(
    `
    SELECT id
    FROM notification_logs
    WHERE type = 'entry_zinc_alert'
    AND reference_key = ?
    LIMIT 1
    `,
    [referenceKey],
  );

  if (alreadySent.length > 0) return;

  const title = "High Zinc Consumption Alert";
  const body = `SR ${entry.sr_no} zinc consumption is ${zinc}% for challan ${entry.challan_no}`;

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
    },
  });

  await db.query(
    `
    INSERT INTO notification_logs
    (type, reference_key, title, body)
    VALUES (?, ?, ?, ?)
    `,
    ["entry_zinc_alert", referenceKey, title, body],
  );

  if (io) {
    io.emit("entry_zinc_alert", {
      entry_id: entry.id,
      sr_no: entry.sr_no,
      challan_no: entry.challan_no,
      zinc_consumption: zinc,
    });
  }
};

module.exports = {
  checkEntryZincNotification,
};
