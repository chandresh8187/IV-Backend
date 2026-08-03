const jwt = require("jsonwebtoken");
const { getSetting } = require("../services/appSettingsService");

const ALWAYS_AVAILABLE = [
  /^\/app-update\/android\/?$/,
  /^\/auth\//,
  /^\/settings\/?/,
];

const readRole = (req) => {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return "";
  try {
    const token = header.slice(7);
    return String(
      jwt.verify(token, process.env.JWT_SECRET, {
        issuer: "iv-api",
        audience: "iv-app",
      })?.role || "",
    )
      .toLowerCase()
      .trim();
  } catch {
    return "";
  }
};

const maintenanceModeMiddleware = async (req, res, next) => {
  try {
    if (ALWAYS_AVAILABLE.some((pattern) => pattern.test(req.path)))
      return next();
    const setting = await getSetting("maintenance_mode");
    if (!setting.enabled || readRole(req) === "superadmin") return next();

    return res.status(503).json({
      success: false,
      code: "APP_MAINTENANCE",
      message:
        setting.message || "The application is temporarily under maintenance.",
      data: { maintenance_mode: true },
    });
  } catch (error) {
    // Fail open if the settings table is temporarily unavailable; route-level
    // authentication and authorization still apply.
    console.error("maintenanceModeMiddleware:", error);
    return next();
  }
};

module.exports = maintenanceModeMiddleware;
