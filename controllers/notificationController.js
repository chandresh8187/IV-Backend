const db = require("../config/db");

const saveFcmToken = async (req, res) => {
  try {
    const { fcm_token, device_type = "android" } = req.body;

    if (!fcm_token) {
      return res.status(400).json({
        success: false,
        message: "fcm_token is required",
      });
    }

    await db.query(
      `
      INSERT INTO user_fcm_tokens
      (user_id, fcm_token, device_type)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        device_type = VALUES(device_type),
        updated_at = CURRENT_TIMESTAMP
      `,
      [req.user.id, fcm_token, device_type],
    );

    return res.json({
      success: true,
      message: "FCM token saved successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const removeFcmToken = async (req, res) => {
  try {
    const { fcm_token } = req.body;

    if (!fcm_token) {
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
      [req.user.id, fcm_token],
    );

    return res.json({
      success: true,
      message: "FCM token removed successfully",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  saveFcmToken,
  removeFcmToken,
};
