const db = require("../config/db");

const DEFAULT_SETTINGS = Object.freeze({
  zinc_alert_threshold: Object.freeze({
    enabled: true,
    percentage: 7.5,
  }),

  shift_schedule: Object.freeze({
    automatic: true,
    day_start: "08:00",
    night_start: "20:00",
  }),

  maintenance_mode: Object.freeze({
    enabled: false,
    message: "",
  }),
});

const clone = (value) => JSON.parse(JSON.stringify(value));
const settingCache = new Map();
const cacheTtlMs = Math.max(Number(process.env.SETTINGS_CACHE_TTL_MS) || 5000, 0);

const parseJson = (value, fallback) => {
  if (value == null) {
    return clone(fallback);
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return clone(fallback);
  }
};

const getSetting = async (key, executor = db) => {
  const fallback = DEFAULT_SETTINGS[key];

  if (!fallback) {
    throw new Error(`Unknown application setting: ${key}`);
  }

  if (executor === db && cacheTtlMs > 0) {
    const cached = settingCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return clone(cached.value);
  }

  const [rows] = await executor.query(
    `SELECT setting_value
       FROM app_settings
       WHERE setting_key = ?
       LIMIT 1`,
    [key],
  );

  const result = {
    ...clone(fallback),

    ...parseJson(rows[0]?.setting_value, fallback),
  };

  if (executor === db && cacheTtlMs > 0) {
    settingCache.set(key, {
      value: result,
      expiresAt: Date.now() + cacheTtlMs,
    });
  }

  return clone(result);
};

const clearSettingCache = (key = null) => {
  if (key) settingCache.delete(key);
  else settingCache.clear();
};

const getAllSettings = async (executor = db) => {
  const [rows] = await executor.query(
    `SELECT
         setting_key,
         setting_value,
         updated_at
       FROM app_settings
       ORDER BY setting_key`,
  );

  const result = Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([key, value]) => [key, clone(value)]),
  );

  for (const row of rows) {
    if (!DEFAULT_SETTINGS[row.setting_key]) {
      continue;
    }

    result[row.setting_key] = {
      ...result[row.setting_key],

      ...parseJson(row.setting_value, DEFAULT_SETTINGS[row.setting_key]),

      updated_at: row.updated_at,
    };
  }

  return result;
};

module.exports = {
  DEFAULT_SETTINGS,
  getSetting,
  getAllSettings,
  parseJson,
  clearSettingCache,
};
