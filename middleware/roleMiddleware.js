const roleMiddleware = (allowedRoles = []) => {
  const allowed = allowedRoles.map((role) => String(role).toLowerCase().trim());

  return (req, res, next) => {
    const role = String(req.user?.role || "")
      .toLowerCase()
      .trim();

    if (!req.user || !allowed.includes(role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have permission.",
      });
    }

    req.user.role = role;

    next();
  };
};

module.exports = roleMiddleware;
