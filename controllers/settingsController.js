const db = require("../config/db");
const {
  getAllSettings,
  getSetting,
  clearSettingCache,
} = require("../services/appSettingsService");

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const normalizeSetting = (key, input = {}) => {
  if (key === "zinc_alert_threshold") {
    const percentage = Number(input.percentage);
    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      const error = new Error(
        "Zinc threshold must be greater than 0 and not more than 100",
      );
      error.status = 400;
      throw error;
    }
    return { enabled: Boolean(input.enabled), percentage };
  }

  if (key === "shift_schedule") {
    const dayStart = String(input.day_start || "").trim();
    const nightStart = String(input.night_start || "").trim();
    if (!TIME_PATTERN.test(dayStart) || !TIME_PATTERN.test(nightStart)) {
      const error = new Error("Shift times must use 24-hour HH:mm format");
      error.status = 400;
      throw error;
    }
    if (dayStart >= nightStart) {
      const error = new Error(
        "Day shift start must be earlier than night shift start",
      );
      error.status = 400;
      throw error;
    }
    return {
      automatic: Boolean(input.automatic),
      day_start: dayStart,
      night_start: nightStart,
    };
  }

  if (key === "maintenance_mode") {
    const enabled = Boolean(input.enabled);
    const message = String(input.message || "").trim();
    if (enabled && !message) {
      const error = new Error(
        "A user message is required before enabling maintenance mode",
      );
      error.status = 400;
      throw error;
    }
    if (message.length > 500) {
      const error = new Error(
        "Maintenance message cannot exceed 500 characters",
      );
      error.status = 400;
      throw error;
    }
    return { enabled, message };
  }

  const error = new Error("Unsupported setting");
  error.status = 400;
  throw error;
};

const getSettings = async (req, res) => {
  try {
    return res.json({ success: true, data: await getAllSettings() });
  } catch (error) {
    console.error("getSettings:", error);
    return res
      .status(500)
      .json({ success: false, message: "Could not load settings" });
  }
};

const updateSetting = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const key = String(req.params.key || "").trim();
    const value = normalizeSetting(key, req.body);
    const previous = await getSetting(key, connection);

    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO app_settings (setting_key, setting_value, updated_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         setting_value = VALUES(setting_value),
         updated_by = VALUES(updated_by),
         updated_at = CURRENT_TIMESTAMP`,
      [key, JSON.stringify(value), req.user.id],
    );
    await connection.query(
      `INSERT INTO audit_logs
       (actor_user_id, action, entity_type, entity_id, metadata, ip_address)
       VALUES (?, 'update', 'setting', ?, ?, ?)`,
      [req.user.id, key, JSON.stringify({ previous, next: value }), req.ip],
    );
    await connection.commit();
    clearSettingCache(key);

    req.app.get("io")?.emit("app_setting_changed", { key, value });

    return res.json({
      success: true,
      message: "Setting updated successfully",
      data: { key, value },
    });
  } catch (error) {
    await connection.rollback();
    console.error("updateSetting:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Could not update setting",
    });
  } finally {
    connection.release();
  }
};

const getAuditLogs = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const [rows] = await db.query(
      `SELECT
         logs.id, logs.action, logs.entity_type, logs.entity_id,
         logs.metadata, logs.ip_address, logs.created_at,
         users.name AS actor_name, users.email AS actor_email
       FROM audit_logs AS logs
       LEFT JOIN users ON users.id = logs.actor_user_id
       ORDER BY logs.created_at DESC
       LIMIT ?`,
      [limit],
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    console.error("getAuditLogs:", error);
    return res
      .status(500)
      .json({ success: false, message: "Could not load audit log" });
  }
};

module.exports = { getSettings, updateSetting, getAuditLogs };
