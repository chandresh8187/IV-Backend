const db = require("../config/db");
const {
  getPermissionDefinition,
  getUserAccess,
} = require("../services/permissionService");

const getUserPermissions = async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId < 1) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    const [users] = await db.query(
      "SELECT id, name, email, role, status FROM users WHERE id = ? LIMIT 1",
      [userId],
    );
    if (!users.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const access = await getUserAccess({ userId, role: users[0].role });
    return res.json({ success: true, data: { user: users[0], ...access } });
  } catch (error) {
    console.error("getUserPermissions:", error);
    return res.status(500).json({ success: false, message: "Could not load user access" });
  }
};

const updateUserPermissions = async (req, res) => {
  const userId = Number(req.params.id);
  const overrides = Array.isArray(req.body.overrides) ? req.body.overrides : null;
  if (!Number.isInteger(userId) || userId < 1 || !overrides) {
    return res.status(400).json({ success: false, message: "Valid user and permission overrides are required" });
  }

  const normalized = [];
  const seen = new Set();
  for (const item of overrides) {
    const key = String(item?.key || "").trim();
    if (!getPermissionDefinition(key) || seen.has(key)) {
      return res.status(400).json({ success: false, message: `Invalid or duplicate permission: ${key || "unknown"}` });
    }
    seen.add(key);
    if (item.allowed !== null && typeof item.allowed !== "boolean") {
      return res.status(400).json({ success: false, message: `Permission ${key} must be true, false, or null` });
    }
    normalized.push({ key, allowed: item.allowed });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [users] = await connection.query(
      "SELECT id, name, role FROM users WHERE id = ? FOR UPDATE",
      [userId],
    );
    if (!users.length) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (users[0].role === "superadmin") {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Superadmin access is always enabled and cannot be overridden" });
    }

    await connection.query("DELETE FROM user_permission_overrides WHERE user_id = ?", [userId]);
    const customOverrides = normalized.filter((item) => item.allowed !== null);
    if (customOverrides.length) {
      const placeholders = customOverrides.map(() => "(?, ?, ?)").join(", ");
      const values = customOverrides.flatMap((item) => [userId, item.key, item.allowed ? 1 : 0]);
      await connection.query(
        `INSERT INTO user_permission_overrides (user_id, permission_key, allowed) VALUES ${placeholders}`,
        values,
      );
    }

    await connection.commit();
    const access = await getUserAccess({ userId, role: users[0].role });
    const permissionEvent = {
      user_id: userId,
      permissions: access.allowedKeys,
    };
    const io = req.app.get("io");
    io?.to(`user:${userId}`).emit("user_permissions_updated", permissionEvent);
    io?.emit("users_updated", {
      action: "permissions_changed",
      user_id: userId,
    });

    return res.json({
      success: true,
      message: `Access updated for ${users[0].name}`,
      data: access,
    });
  } catch (error) {
    await connection.rollback();
    console.error("updateUserPermissions:", error);
    return res.status(500).json({ success: false, message: "Could not update user access" });
  } finally {
    connection.release();
  }
};

module.exports = { getUserPermissions, updateUserPermissions };
