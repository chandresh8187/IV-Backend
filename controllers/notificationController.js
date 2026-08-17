const db = require("../config/db");
const { sendNotificationToRoles } = require("../utils/sendNotification");
const {
  checkEntryZincNotification,
} = require("../utils/checkEntryZincNotification");

const saveFcmToken = async (req, res) => {
  try {
    const fcmToken = String(req.body.fcm_token || "").trim();
    const deviceType = String(req.body.device_type || "android")
      .trim()
      .toLowerCase();

    if (fcmToken.length < 20 || fcmToken.length > 512) {
      return res.status(400).json({
        success: false,
        message: "A valid fcm_token is required",
      });
    }

    if (!["android", "ios", "web"].includes(deviceType)) {
      return res.status(400).json({
        success: false,
        message: "device_type must be android, ios or web",
      });
    }

    await db.query(
      `
      INSERT INTO user_fcm_tokens
      (user_id, fcm_token, device_type)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id),
        device_type = VALUES(device_type),
        updated_at = CURRENT_TIMESTAMP
      `,
      [req.user.id, fcmToken, deviceType],
    );

    console.info("FCM token registered:", {
      user_id: req.user.id,
      device_type: deviceType,
    });

    req.app.get("io")?.emit("users_updated", {
      action: "notification_token_saved",
      user_id: req.user.id,
    });

    return res.json({
      success: true,
      message: "FCM token saved successfully",
      data: {
        registered: true,
        device_type: deviceType,
        token_suffix: fcmToken.slice(-8),
      },
    });
  } catch (error) {
    console.error("FCM token registration failed:", {
      user_id: req.user?.id,
      code: error?.code,
      message: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Could not save this device notification token",
    });
  }
};

const removeFcmToken = async (req, res) => {
  try {
    const fcmToken = String(req.body.fcm_token || "").trim();

    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        message: "fcm_token is required",
      });
    }

    await db.query(
      `
      DELETE FROM user_fcm_tokens
      WHERE user_id = ?
      AND fcm_token = ?
      `,
      [req.user.id, fcmToken],
    );

    req.app.get("io")?.emit("users_updated", {
      action: "notification_token_removed",
      user_id: req.user.id,
    });

    return res.json({
      success: true,
      message: "FCM token removed successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const sendTestNotification = async (req, res) => {
  const title =
    String(req.body.title || "IV Production Notification Test").trim() ||
    "IV Production Notification Test";
  const body =
    String(
      req.body.body ||
        "Backend notification delivery is working for this device.",
    ).trim() || "Backend notification delivery is working for this device.";

  if (title.length > 120 || body.length > 500) {
    return res.status(400).json({
      success: false,
      message: "Title must be 120 characters or less and message 500 or less",
    });
  }

  const notificationKey = `notification_test_${req.user.id}_${Date.now()}`;

  try {
    const delivery = await sendNotificationToRoles({
      roles: ["superadmin", "admin", "plant_manager"],
      excludeRoles: ["supervisor"],
      title,
      body,
      data: {
        type: "notification_test",
        notification_key: notificationKey,
        triggered_by: String(req.user.id),
      },
      io: req.app.get("io"),
      socketEvent: "notification_test",
    });

    return res.json({
      success: true,
      message:
        delivery.successCount || delivery.socketConnectionCount
          ? "Test notification triggered"
          : "No connected app or valid notification token received the test",
      data: delivery,
    });
  } catch (error) {
    console.error("Test notification failed:", error);
    return res.status(502).json({
      success: false,
      code: "NOTIFICATION_DELIVERY_FAILED",
      message:
        "Backend reached the notification service, but delivery failed. Check Firebase credentials and registered device tokens.",
    });
  }
};

const testLatestProductionZinc = async (req, res) => {
  try {
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
       WHERE COALESCE(pe.row_type, 'entry') = 'entry'
       ORDER BY pe.id DESC
       LIMIT 1`,
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "No production entry is available to test",
      });
    }

    const entry = rows[0];
    const result = await checkEntryZincNotification({
      entryId: entry.id,
      entrySnapshot: entry,
      io: req.app.get("io"),
      force: true,
    });

    return res.json({
      success: true,
      message: `Latest production zinc check: ${result.reason}`,
      data: {
        entry: {
          id: entry.id,
          planning_id: entry.planning_id,
          sr_no: entry.sr_no,
          challan_no: entry.challan_no,
          zinc_percentage: entry.zinc_percentage,
          target_zinc_percentage: entry.target_zinc_percentage,
        },
        result,
      },
    });
  } catch (error) {
    console.error("Latest production zinc test failed:", error);
    return res.status(500).json({
      success: false,
      message: "Could not evaluate the latest production zinc entry",
    });
  }
};

module.exports = {
  saveFcmToken,
  removeFcmToken,
  sendTestNotification,
  testLatestProductionZinc,
};
