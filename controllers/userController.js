const db = require("../config/db");

const getUsers = async (req, res) => {
  try {
    let where = "";

    if (req.user.role === "superadmin") {
      where =
        "WHERE users.role IN ('plant_manager', 'admin', 'supervisor')";
    } else if (
      req.user.role === "admin" ||
      req.user.role === "plant_manager"
    ) {
      where = "WHERE users.role = 'supervisor'";
    } else {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
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

    const plantManagers = rows.filter(
      user => user.role === "plant_manager",
    );

    const admins = rows.filter(
      user => user.role === "admin",
    );

    const supervisors = rows.filter(
      user => user.role === "supervisor",
    );

    return res.json({
      success: true,
      message: "Users fetched successfully",
      data: {
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
      error: error.message,
    });
  }
};

module.exports = {
  getUsers,
};
