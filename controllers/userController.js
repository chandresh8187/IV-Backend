const db = require("../config/db");

const getUsers = async (req, res) => {
  try {
    let where = "";

    if (req.user.role === "superadmin") {
      where = "WHERE users.role IN ('admin', 'supervisor')";
    } else if (req.user.role === "admin") {
      where = "WHERE users.role = 'supervisor'";
    } else {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    const [rows] = await db.query(`
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
      ORDER BY users.role ASC, users.name ASC
    `);

    const admins = rows.filter((user) => user.role === "admin");
    const supervisors = rows.filter((user) => user.role === "supervisor");

    return res.json({
      success: true,
      message: "Users fetched successfully",
      data: {
        admins,
        supervisors,
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
