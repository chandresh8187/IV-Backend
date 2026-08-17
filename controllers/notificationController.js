const db = require("../config/db");
const {
  sendNotificationToRoles,
  sendNotificationToUser,
} = require("../utils/sendNotification");
const {
  checkEntryZincNotification,
} = require("../utils/checkEntryZincNotification");

const normalizeInstallationId = (value) => String(value || "").trim();
const isValidInstallationId = (value) =>
  /^[a-zA-Z0-9._:-]{16,100}$/.test(value);

const saveFcmToken = async (req, res) => {
  let connection;
  try {
    const fcmToken = String(req.body.fcm_token || "").trim();
    const installationId = normalizeInstallationId(req.body.installation_id);
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

    if (installationId && !isValidInstallationId(installationId)) {
      return res.status(400).json({
        success: false,
        message: "A valid installation_id is required",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    let installationRow = null;
    if (installationId) {
      const [installationRows] = await connection.query(
        `SELECT id, user_id, fcm_token, installation_id
         FROM user_fcm_tokens
         WHERE installation_id = ?
         LIMIT 1
         FOR UPDATE`,
        [installationId],
      );
      installationRow = installationRows[0] || null;
    }

    const [tokenRows] = await connection.query(
      `SELECT id, user_id, fcm_token, installation_id
       FROM user_fcm_tokens
       WHERE fcm_token = ?
       LIMIT 1
       FOR UPDATE`,
      [fcmToken],
    );
    const tokenRow = tokenRows[0] || null;

    if (installationRow && tokenRow && installationRow.id !== tokenRow.id) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        code: "FCM_TOKEN_DEVICE_CONFLICT",
        message: "This Firebase token belongs to another app installation",
      });
    }

    if (installationRow) {
      await connection.query(
        `UPDATE user_fcm_tokens
         SET user_id = ?,
             fcm_token = ?,
             device_type = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [req.user.id, fcmToken, deviceType, installationRow.id],
      );
    } else if (tokenRow) {
      if (
        installationId &&
        tokenRow.installation_id &&
        tokenRow.installation_id !== installationId
      ) {
        await connection.rollback();
        return res.status(409).json({
          success: false,
          code: "FCM_TOKEN_DEVICE_CONFLICT",
          message: "This Firebase token belongs to another app installation",
        });
      }

      await connection.query(
        `UPDATE user_fcm_tokens
         SET user_id = ?,
             installation_id = COALESCE(installation_id, ?),
             device_type = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [req.user.id, installationId || null, deviceType, tokenRow.id],
      );
    } else {
      await connection.query(
        `INSERT INTO user_fcm_tokens
         (user_id, installation_id, fcm_token, device_type)
         VALUES (?, ?, ?, ?)`,
        [req.user.id, installationId || null, fcmToken, deviceType],
      );
    }

    const [[registration]] = await connection.query(
      `SELECT COUNT(*) AS device_count
       FROM user_fcm_tokens
       WHERE user_id = ?`,
      [req.user.id],
    );
    await connection.commit();

    console.info("FCM token registered:", {
      user_id: req.user.id,
      device_type: deviceType,
      installation_suffix: installationId.slice(-8) || null,
      token_suffix: fcmToken.slice(-8),
      device_count: Number(registration?.device_count) || 0,
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
        installation_suffix: installationId.slice(-8) || null,
        token_suffix: fcmToken.slice(-8),
        device_count: Number(registration?.device_count) || 0,
      },
    });
  } catch (error) {
    if (connection) await connection.rollback().catch(() => {});
    console.error("FCM token registration failed:", {
      user_id: req.user?.id,
      code: error?.code,
      message: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Could not save this device notification token",
    });
  } finally {
    connection?.release();
  }
};

const removeFcmToken = async (req, res) => {
  try {
    const fcmToken = String(req.body.fcm_token || "").trim();
    const installationId = normalizeInstallationId(req.body.installation_id);

    if (!fcmToken && !installationId) {
      return res.status(400).json({
        success: false,
        message: "fcm_token or installation_id is required",
      });
    }

    if (installationId && !isValidInstallationId(installationId)) {
      return res.status(400).json({
        success: false,
        message: "A valid installation_id is required",
      });
    }

    if (installationId) {
      await db.query(
        `DELETE FROM user_fcm_tokens
         WHERE user_id = ?
           AND installation_id = ?`,
        [req.user.id, installationId],
      );
    } else {
      await db.query(
        `DELETE FROM user_fcm_tokens
         WHERE user_id = ?
           AND fcm_token = ?`,
        [req.user.id, fcmToken],
      );
    }

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

const checkFcmToken = async (req, res) => {
  try {
    const fcmToken = String(req.body.fcm_token || "").trim();
    const installationId = normalizeInstallationId(req.body.installation_id);

    if (fcmToken.length < 20 || fcmToken.length > 512) {
      return res.status(400).json({
        success: false,
        message: "A valid fcm_token is required",
      });
    }

    if (installationId && !isValidInstallationId(installationId)) {
      return res.status(400).json({
        success: false,
        message: "A valid installation_id is required",
      });
    }

    const [rows] = await db.query(
      `SELECT user_id, fcm_token, installation_id
       FROM user_fcm_tokens
       WHERE ${installationId ? "installation_id = ?" : "fcm_token = ?"}
       LIMIT 1`,
      [installationId || fcmToken],
    );

    const registeredForCurrentUser =
      rows.length > 0 &&
      Number(rows[0].user_id) === Number(req.user.id) &&
      rows[0].fcm_token === fcmToken;

    const reason = registeredForCurrentUser
      ? "REGISTERED"
      : rows.length
        ? Number(rows[0].user_id) !== Number(req.user.id)
          ? "DEVICE_REGISTERED_TO_ANOTHER_USER"
          : "DEVICE_TOKEN_CHANGED"
        : "NOT_REGISTERED";

    console.info("FCM token checked:", {
      user_id: req.user.id,
      installation_suffix: installationId.slice(-8) || null,
      token_suffix: fcmToken.slice(-8),
      registered: registeredForCurrentUser,
      reason,
    });

    return res.json({
      success: true,
      data: {
        registered: registeredForCurrentUser,
        reason,
      },
    });
  } catch (error) {
    console.error("FCM token check failed:", {
      user_id: req.user?.id,
      code: error?.code,
      message: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Could not check this device notification token",
    });
  }
};

const getMyNotificationStatus = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id,
              device_type,
              RIGHT(installation_id, 8) AS installation_suffix,
              RIGHT(fcm_token, 8) AS token_suffix,
              created_at,
              updated_at
       FROM user_fcm_tokens
       WHERE user_id = ?
       ORDER BY updated_at DESC, id DESC`,
      [req.user.id],
    );

    return res.json({
      success: true,
      data: {
        registered: rows.length > 0,
        device_count: rows.length,
        devices: rows,
      },
    });
  } catch (error) {
    console.error("Notification registration status failed:", {
      user_id: req.user?.id,
      code: error?.code,
      message: error?.message,
    });
    return res.status(500).json({
      success: false,
      message: "Could not load notification device status",
    });
  }
};

const scheduleMyBackgroundTest = async (req, res) => {
  if (String(req.user.role || "").toLowerCase().trim() === "supervisor") {
    return res.status(403).json({
      success: false,
      message: "Supervisors are excluded from notifications",
    });
  }

  const userId = req.user.id;
  const notificationKey = `background_test_${userId}_${Date.now()}`;

  setTimeout(() => {
    sendNotificationToUser({
      userId,
      title: "IV Background Notification Test",
      body: "Background FCM and Android notification-panel delivery are working.",
      data: {
        type: "notification_test",
        notification_key: notificationKey,
      },
    })
      .then((delivery) =>
        console.info("Background FCM test delivery:", {
          user_id: userId,
          ...delivery,
        }),
      )
      .catch((error) =>
        console.error("Background FCM test failed:", {
          user_id: userId,
          code: error?.code,
          message: error?.message,
        }),
      );
  }, 8000);

  return res.json({
    success: true,
    message: "Background notification scheduled in 8 seconds",
  });
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
    });

    return res.json({
      success: true,
      message:
        delivery.successCount
          ? "Test notification triggered"
          : "No valid notification token received the test",
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
  checkFcmToken,
  getMyNotificationStatus,
  scheduleMyBackgroundTest,
  sendTestNotification,
  testLatestProductionZinc,
};
