const { DateTime } = require("luxon");
const { overview } = require("./unit1Maintenance");
async function sendMaintenanceReminders({
  db = require("../config/unit1Db"),
  firebase = require("../config/unit1FirebaseAdmin"),
  permitted = require("./permissionService").hasPermission,
  now = DateTime.now(),
} = {}) {
  const time = now.setZone("Asia/Kolkata");
  if (time.hour < 9 || !firebase.configured()) return { sent: 0 };
  const day = time.toISODate();
  const data = await overview(db, day);
  const due = data.plans.filter((p) =>
    ["overdue", "due_today", "due_soon"].includes(p.status)
  );
  if (!due.length) return { sent: 0 };
  const [users] = await db.query(
    "SELECT DISTINCT u.id,u.role FROM users u JOIN unit1_fcm_tokens t ON t.user_id=u.id WHERE u.status='active'"
  );
  let sent = 0;
  for (const user of users) {
    if (
      !(await permitted({
        userId: user.id,
        role: user.role,
        permissionKey: "unit1.maintenance.view",
        queryable: db,
      }))
    )
      continue;
    const [claim] = await db.query(
      `INSERT IGNORE INTO unit1_maintenance_reminders (user_id,reminder_date,state) VALUES (?,?,'sending')`,
      [user.id, day]
    );
    if (!claim.affectedRows) {
      const [retry] = await db.query(
        `UPDATE unit1_maintenance_reminders SET state='sending',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND reminder_date=? AND state<>'sent' AND attempts<3 AND updated_at<DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 15 MINUTE)`,
        [user.id, day]
      );
      if (!retry.affectedRows) continue;
    }
    try {
      const [devices] = await db.query(
        "SELECT fcm_token FROM unit1_fcm_tokens WHERE user_id=?",
        [user.id]
      );
      let accepted = 0;
      for (let i = 0; i < devices.length; i += 500) {
        const tokens = devices.slice(i, i + 500).map((d) => d.fcm_token);
        const result = await firebase
          .messaging()
          .sendEachForMulticast({
            tokens,
            notification: {
              title: "Unit 1 maintenance reminder",
              body: `${data.summary.overdue} overdue, ${data.summary.due_today} due today, ${data.summary.due_soon} due soon. Open Production > Maintenance.`,
            },
            data: { type: "unit1_maintenance" },
            android: {
              priority: "high",
              notification: {
                channelId: "unit1_production_alerts",
                sound: "default",
              },
            },
          });
        accepted += result.successCount;
        const invalid = result.responses.flatMap((r, j) =>
          !r.success &&
          [
            "messaging/invalid-registration-token",
            "messaging/registration-token-not-registered",
          ].includes(r.error?.code)
            ? [tokens[j]]
            : []
        );
        if (invalid.length)
          await db.query(
            "DELETE FROM unit1_fcm_tokens WHERE user_id=? AND fcm_token IN (?)",
            [user.id, invalid]
          );
      }
      await db.query(
        "UPDATE unit1_maintenance_reminders SET state=? WHERE user_id=? AND reminder_date=?",
        [accepted ? "sent" : "failed", user.id, day]
      );
      if (accepted) sent++;
    } catch (e) {
      await db.query(
        "UPDATE unit1_maintenance_reminders SET state='failed' WHERE user_id=? AND reminder_date=?",
        [user.id, day]
      );
      console.error(
        "Unit 1 maintenance notification failed:",
        e.code || "send failed"
      );
    }
  }
  return { sent };
}
module.exports = { sendMaintenanceReminders };
