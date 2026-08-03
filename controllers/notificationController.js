const db = require("../config/db");

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

    return res.json({
      success: true,
      message: "FCM token saved successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
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

module.exports = {
  saveFcmToken,
  removeFcmToken,
};
