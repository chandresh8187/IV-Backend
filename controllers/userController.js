const db = require("../config/db");
const { hasPermission } = require("../services/permissionService");

const getUsers = async (req, res) => {
  try {
    let where = "";

    const canManageUsers = await hasPermission({
      userId: req.user.id,
      role: req.user.role,
      permissionKey: "users.manage",
    });

    if (req.user.role === "superadmin" || canManageUsers) {
      where =
        "WHERE users.role IN ('superadmin', 'plant_manager', 'admin', 'supervisor')";
    } else {
      where = "WHERE users.role = 'supervisor'";
    }

    const [rows] = await db.query(
      `
      SELECT
        users.id,
        users.name,
        users.email,
        users.role,
        users.assigned_shift,
        users.status,
        users.created_at,

        CASE
          WHEN EXISTS (
            SELECT 1 FROM user_fcm_tokens
            WHERE user_fcm_tokens.user_id = users.id
          ) THEN 1
          ELSE 0
        END AS notifications_registered,

        shifts.id AS active_shift_id,
        shifts.shift_name AS active_shift_name,
        shifts.shift_date AS active_shift_date,
        shifts.start_time AS active_shift_start_time,

        CASE
          WHEN shifts.id IS NULL THEN 0
          ELSE 1
        END AS is_shift_active

      FROM users

      LEFT JOIN shifts
        ON shifts.started_by = users.id
        AND shifts.status = 'active'

      ${where}

      ORDER BY
        CASE users.role
          WHEN 'plant_manager' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'supervisor' THEN 3
          ELSE 4
        END,
        users.name ASC
      `,
    );

    const superadmins = rows.filter((user) => user.role === "superadmin");

    const plantManagers = rows.filter(
      (user) => user.role === "plant_manager",
    );

    const admins = rows.filter((user) => user.role === "admin");

    const supervisors = rows.filter((user) => user.role === "supervisor");

    return res.json({
      success: true,
      message: "Users fetched successfully",
      data: {
        superadmins,
        plant_managers: plantManagers,
        admins,
        supervisors,

        // Optional combined list for clients that prefer one array.
        users: rows,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const updateUser = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const role = String(req.body.role || "").trim().toLowerCase();
    const assignedShift = String(req.body.assigned_shift || "")
      .trim()
      .toLowerCase();

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ success: false, message: "Invalid user id" });
    }

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Name must contain between 2 and 100 characters",
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 190) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address",
      });
    }

    if (!["plant_manager", "admin", "supervisor"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Existing accounts cannot be promoted to Superadmin",
      });
    }

    if (
      role === "supervisor" &&
      !["day", "night", "both"].includes(assignedShift)
    ) {
      return res.status(400).json({
        success: false,
        message: "Select day, night or both for a supervisor",
      });
    }

    const [existing] = await db.query(
      "SELECT id, role FROM users WHERE id = ? LIMIT 1",
      [id],
    );

    if (!existing.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (existing[0].role === "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Superadmin accounts cannot be edited from user management",
      });
    }

    await db.query(
      `UPDATE users
       SET name = ?, email = ?, role = ?, assigned_shift = ?, updated_at = NOW()
       WHERE id = ?`,
      [name, email, role, role === "supervisor" ? assignedShift : null, id],
    );

    req.app.get("io")?.emit("users_updated", { action: "updated", user_id: id });

    return res.json({ success: true, message: "User updated successfully" });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "This email address is already registered",
      });
    }

    console.error("updateUser:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update user",
    });
  }
};

const setUserStatus = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body.status || "").trim().toLowerCase();

    if (!Number.isInteger(id) || id < 1 || !["active", "inactive"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "A valid user id and status are required",
      });
    }

    if (id === Number(req.user.id)) {
      return res.status(400).json({
        success: false,
        message: "You cannot change your own account status",
      });
    }

    const [targets] = await db.query(
      "SELECT role FROM users WHERE id = ? LIMIT 1",
      [id],
    );

    if (!targets.length) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (targets[0].role === "superadmin") {
      return res.status(403).json({
        success: false,
        message: "Superadmin status cannot be changed from user management",
      });
    }

    const [result] = await db.query(
      "UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?",
      [status, id],
    );

    if (!result.affectedRows) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    req.app.get("io")?.emit("users_updated", {
      action: "status_changed",
      user_id: id,
      status,
    });

    return res.json({
      success: true,
      message: `User marked ${status}`,
    });
  } catch (error) {
    console.error("setUserStatus:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to change user status",
    });
  }
};

module.exports = {
  getUsers,
  updateUser,
  setUserStatus,
};
