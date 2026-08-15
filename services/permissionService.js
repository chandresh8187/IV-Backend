const db = require("../config/db");

const ALL_ROLES = ["superadmin", "plant_manager", "admin", "supervisor"];

const PERMISSIONS = [
  { key: "dashboard.view", group: "Dashboard", label: "View dashboard", description: "View plant and production dashboard data.", defaultRoles: ["superadmin", "plant_manager", "admin"] },
  { key: "production.view", group: "Production", label: "View live production", description: "View current production entries and row details.", defaultRoles: ALL_ROLES },
  { key: "production.save", group: "Production", label: "Add or delegated edit", description: "Add production or use a one-time unlocked SR edit.", defaultRoles: ["superadmin", "plant_manager", "supervisor"] },
  { key: "production.grant_edit", group: "Production", label: "Unlock SR editing", description: "Grant another user one-time edit access to an SR.", defaultRoles: ["superadmin"] },
  { key: "production.manage_all", group: "Production", label: "Manage every SR", description: "Directly edit or delete any production entry.", defaultRoles: ["superadmin"] },
  { key: "shifts.view", group: "Shifts", label: "View shift status", description: "View automatic shift status and timing.", defaultRoles: ALL_ROLES },
  { key: "shifts.manage", group: "Shifts", label: "Start or end shifts", description: "Control day and night production shifts.", defaultRoles: ["superadmin", "supervisor"] },
  { key: "history.view", group: "History & Reports", label: "View production history", description: "View historical production summaries and entries.", defaultRoles: ALL_ROLES },
  { key: "reports.generate", group: "History & Reports", label: "Generate production reports", description: "Generate planning, material, shift, and date PDF reports.", defaultRoles: ["superadmin"] },
  { key: "planning.view", group: "Planning", label: "View production planning", description: "View pending and completed planning challans.", defaultRoles: ["superadmin", "plant_manager", "admin"] },
  { key: "planning.manage", group: "Planning", label: "Manage production planning", description: "Create, edit, and remove planning challans.", defaultRoles: ["superadmin", "plant_manager", "admin"] },
  { key: "planning.import_pdf", group: "Planning", label: "Import planning PDF", description: "Extract production planning details from an uploaded PDF.", defaultRoles: ["superadmin", "plant_manager", "admin"] },
  { key: "certificates.view", group: "Certificates", label: "View certificates", description: "View generated coating certificates and readings.", defaultRoles: ["superadmin", "admin"] },
  { key: "certificates.generate", group: "Certificates", label: "Generate certificates", description: "Create coating certificates and certificate PDFs.", defaultRoles: ["superadmin", "admin"] },
  { key: "users.view", group: "Users", label: "View users", description: "View the user directory and active supervisors.", defaultRoles: ["superadmin", "plant_manager", "admin"] },
  { key: "users.manage", group: "Users", label: "Manage users", description: "Create, edit, activate, and deactivate user accounts.", defaultRoles: ["superadmin"] },
  { key: "plant.view", group: "Plant Control", label: "View plant control", description: "View plant status and status history.", defaultRoles: ["superadmin", "plant_manager", "admin"] },
  { key: "plant.manage", group: "Plant Control", label: "Manage plant status", description: "Set running, maintenance, or stopped status.", defaultRoles: ["superadmin", "plant_manager"] },
  { key: "settings.manage", group: "Administration", label: "Manage control panel", description: "Manage app settings and view audit activity.", defaultRoles: ["superadmin"] },
  { key: "app_updates.manage", group: "Administration", label: "Manage app updates", description: "Upload and publish native Android releases.", defaultRoles: ["superadmin"] },
];

const PERMISSION_BY_KEY = new Map(PERMISSIONS.map((item) => [item.key, item]));

const normalizeRole = (role) => String(role || "").toLowerCase().trim();

const getPermissionDefinition = (key) => PERMISSION_BY_KEY.get(String(key || ""));

const isDefaultAllowed = (role, key) => {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "superadmin") return true;
  return Boolean(getPermissionDefinition(key)?.defaultRoles.includes(normalizedRole));
};

const getUserOverrides = async (userId, queryable = db) => {
  const [rows] = await queryable.query(
    "SELECT permission_key, allowed FROM user_permission_overrides WHERE user_id = ?",
    [userId],
  );
  return new Map(rows.map((row) => [row.permission_key, Boolean(row.allowed)]));
};

const hasPermission = async ({ userId, role, permissionKey, queryable = db }) => {
  const normalizedRole = normalizeRole(role);
  if (normalizedRole === "superadmin") return true;

  const definition = getPermissionDefinition(permissionKey);
  if (!definition) throw new Error(`Unknown permission key: ${permissionKey}`);

  const [rows] = await queryable.query(
    `SELECT allowed FROM user_permission_overrides
     WHERE user_id = ? AND permission_key = ? LIMIT 1`,
    [userId, permissionKey],
  );

  return rows.length
    ? Boolean(rows[0].allowed)
    : definition.defaultRoles.includes(normalizedRole);
};

const getUserAccess = async ({ userId, role, queryable = db }) => {
  const normalizedRole = normalizeRole(role);
  const overrides = await getUserOverrides(userId, queryable);
  const permissions = PERMISSIONS.map((permission) => {
    const defaultAllowed = isDefaultAllowed(normalizedRole, permission.key);
    const override = overrides.has(permission.key)
      ? overrides.get(permission.key)
      : null;

    return {
      key: permission.key,
      group: permission.group,
      label: permission.label,
      description: permission.description,
      default_allowed: defaultAllowed,
      override,
      allowed:
        normalizedRole === "superadmin"
          ? true
          : override == null
            ? defaultAllowed
            : override,
    };
  });

  return {
    permissions,
    allowedKeys: permissions.filter((item) => item.allowed).map((item) => item.key),
  };
};

module.exports = {
  ALL_ROLES,
  PERMISSIONS,
  getPermissionDefinition,
  getUserAccess,
  hasPermission,
  isDefaultAllowed,
};
