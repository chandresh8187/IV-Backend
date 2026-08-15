const { getPermissionDefinition, hasPermission } = require("../services/permissionService");

const roleMiddleware = (allowedRoles = [], permissionKey = null) => {
  const allowed = allowedRoles.map((role) => String(role).toLowerCase().trim());

  if (permissionKey && !getPermissionDefinition(permissionKey)) {
    throw new Error(`Unknown permission configured on route: ${permissionKey}`);
  }

  return async (req, res, next) => {
    const role = String(req.user?.role || "")
      .toLowerCase()
      .trim();

    if (!req.user) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have permission.",
      });
    }

    req.user.role = role;

    try {
      const permitted = permissionKey
        ? await hasPermission({
            userId: req.user.id,
            role,
            permissionKey,
          })
        : allowed.includes(role);

      if (!permitted) {
        return res.status(403).json({
          success: false,
          code: "PERMISSION_REQUIRED",
          permission: permissionKey,
          message: "Access denied. Ask a superadmin to enable this feature.",
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

module.exports = roleMiddleware;
