const db = require("../config/db");

const ALL_ROLES = ["superadmin", "plant_manager", "admin", "supervisor"];

const PERMISSIONS = [
  { key: 'chat.view', group: 'Production', label: 'Use plant chat', description: 'View users and exchange production messages.', defaultRoles: ALL_ROLES },
  { key: 'zinc_stock.view', group: 'Zinc Stock', label: 'View zinc stock', description: 'View plant and kettle zinc balances and transaction history.', defaultRoles: ['superadmin', 'plant_manager', 'admin'] },
  { key: 'zinc_stock.receive', group: 'Zinc Stock', label: 'Receive zinc in plant', description: 'Add purchased or received zinc to plant stock.', defaultRoles: ['superadmin', 'plant_manager'] },
  { key: 'zinc_stock.transfer', group: 'Zinc Stock', label: 'Add zinc to kettle', description: 'Transfer zinc from plant stock to the kettle, including from Live Production.', defaultRoles: ['superadmin', 'plant_manager', 'supervisor'] },
  { key: 'zinc_stock.adjust', group: 'Zinc Stock', label: 'Set or correct zinc balances', description: 'Set opening stock or replace verified plant and kettle balances.', defaultRoles: ['superadmin', 'plant_manager'] },
  { key: 'zinc_stock.report', group: 'Zinc Stock', label: 'Generate zinc PDF report', description: 'Generate and share the complete zinc transaction PDF.', defaultRoles: ['superadmin', 'plant_manager', 'admin'] },
  { key: 'zinc_byproduct.manage', group: 'Zinc Stock', label: 'Manage ash and dross', description: 'Record ash and dross sale recovery using the latest received-zinc rate.', defaultRoles: ['superadmin', 'plant_manager'] },
  { key: 'expense_report.view', group: 'Expense Report', label: 'View expense report', description: 'View monthly production expenses, zinc totals, and running plant cost.', defaultRoles: ['superadmin', 'plant_manager', 'admin'] },
  { key: 'expense_report.settings', group: 'Expense Report', label: 'Manage expense settings', description: 'Set salary, utilities, materials, rent, and other production expenses.', defaultRoles: ['superadmin', 'plant_manager'] },
  { key: 'expense_report.report', group: 'Expense Report', label: 'Generate expense PDF', description: 'Generate and share the monthly expense report PDF.', defaultRoles: ['superadmin', 'plant_manager', 'admin'] },
  { key: 'monthly_reports.view', group: 'Monthly Reports', label: 'View monthly reports', description: 'View consolidated historical production, zinc, planning, contractor, byproduct, and expense reports.', defaultRoles: ['superadmin', 'plant_manager', 'admin'] },
  { key: 'monthly_reports.report', group: 'Monthly Reports', label: 'Generate monthly report PDF', description: 'Generate and share a consolidated monthly operations PDF.', defaultRoles: ['superadmin', 'plant_manager', 'admin'] },
  { key: 'chemical_checks.view', group: 'Chemical Tracking', label: 'View chemical checks', description: 'View daily flux temperature and flux and acid pH and density readings.', defaultRoles: ALL_ROLES },
  { key: 'chemical_checks.manage', group: 'Chemical Tracking', label: 'Record chemical checks', description: 'Record daily flux temperature and flux and acid pH and density readings.', defaultRoles: ['superadmin', 'plant_manager', 'supervisor'] },
  { key: 'chemical_checks.report', group: 'Chemical Tracking', label: 'Generate chemical checks PDF', description: 'Generate and share the flux and acid readings report.', defaultRoles: ['superadmin', 'plant_manager', 'admin'] },
  { key: 'rate_calculator.view', group: 'Production', label: 'Use rate calculator', description: 'Calculate zinc consumption cost and final production rate.', defaultRoles: ['superadmin', 'plant_manager', 'admin'] },
  { key: 'contractors.view', group: 'Contractors', label: 'View contractor production', description: 'View contractor shift assignments and production totals.', defaultRoles: ['superadmin', 'plant_manager', 'admin'] },
  { key: 'contractors.manage', group: 'Contractors', label: 'Manage contractor assignments', description: 'Add contractors and configure repeating Day/Night assignments.', defaultRoles: ['superadmin', 'plant_manager'] },
  { key: "dashboard.view", group: "Dashboard", label: "View dashboard", description: "View plant and production dashboard data.", defaultRoles: ["superadmin", "plant_manager", "admin"] },
  { key: "production.view", group: "Production", label: "View live production", description: "View current production entries and row details.", defaultRoles: ALL_ROLES },
  { key: "production.save", group: "Production", label: "Add or delegated edit", description: "Add production or use a one-time unlocked SR edit.", defaultRoles: ["superadmin", "plant_manager", "supervisor"] },
  { key: "production.grant_edit", group: "Production", label: "Unlock SR editing", description: "Grant another user one-time edit access to an SR.", defaultRoles: ["superadmin"] },
  { key: "production.manage_all", group: "Production", label: "Manage every SR", description: "Directly edit or delete any production entry.", defaultRoles: ["superadmin"] },
  { key: "shifts.view", group: "Shifts", label: "View shift status", description: "View the current automatic 12-hour shift.", defaultRoles: ALL_ROLES },
  { key: "shifts.correct", group: "Shifts", label: "Correct previous shifts", description: "Open a previous shift for corrections and resume the current shift afterward.", defaultRoles: ["superadmin", "plant_manager"] },
  { key: "history.view", group: "History & Reports", label: "View production history", description: "View historical production summaries and entries.", defaultRoles: ALL_ROLES },
  { key: "reports.generate", group: "History & Reports", label: "Generate production reports", description: "Generate planning, material, shift, and date PDF reports.", defaultRoles: ["superadmin"] },
  { key: "planning.view", group: "Planning", label: "View production planning", description: "View pending and completed planning challans.", defaultRoles: ["superadmin", "plant_manager", "admin"] },
  { key: "planning.manage", group: "Planning", label: "Manage production planning", description: "Create, edit, and remove planning challans.", defaultRoles: ["superadmin", "plant_manager", "admin"] },
  { key: "certificates.view", group: "Certificates", label: "View certificates", description: "View generated coating certificates and readings.", defaultRoles: ["superadmin", "admin"] },
  { key: "certificates.generate", group: "Certificates", label: "Generate certificates", description: "Create coating certificates and certificate PDFs.", defaultRoles: ["superadmin", "admin"] },
  { key: "users.view", group: "Users", label: "View users", description: "View the user directory and active supervisors.", defaultRoles: ["superadmin", "plant_manager", "admin"] },
  { key: "users.manage", group: "Users", label: "Manage users", description: "Create, edit, activate, and deactivate user accounts.", defaultRoles: ["superadmin"] },
  { key: "plant.view", group: "Plant Control", label: "View plant control", description: "View plant status and status history.", defaultRoles: ["superadmin", "plant_manager", "admin"] },
  { key: "plant.manage", group: "Plant Control", label: "Manage plant status", description: "Set running, maintenance, or stopped status.", defaultRoles: ["superadmin", "plant_manager"] },
  { key: "items.manage", group: "Master Records", label: "Manage production items", description: "Add, edit, and delete material names used in production.", defaultRoles: ["superadmin", "plant_manager"] },
  { key: "financial_years.manage", group: "Master Records", label: "Manage financial years", description: "Add, edit, delete, and select the current financial year.", defaultRoles: ["superadmin"] },
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
