const db = require("../config/db");

const getSupervisors = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        users.id AS supervisor_id,
        users.name AS supervisor_name,
        users.email AS supervisor_email,
        users.assigned_shift,
        users.status AS user_status,

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

      WHERE users.role = 'supervisor'
      ORDER BY users.name ASC
    `);

    return res.json({
      success: true,
      message: "Supervisors fetched successfully",
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getActiveSupervisors = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        shifts.id AS shift_id,
        shifts.shift_name,
        shifts.shift_date,
        shifts.start_time,
        shifts.status,

        users.id AS supervisor_id,
        users.name AS supervisor_name,
        users.email AS supervisor_email,
        users.assigned_shift
      FROM shifts
      LEFT JOIN users ON users.id = shifts.started_by
      WHERE shifts.status = 'active'
      ORDER BY shifts.start_time DESC
    `);

    return res.json({
      success: true,
      message: "Active supervisors fetched successfully",
      data: rows,
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
  getSupervisors,
  getActiveSupervisors,
};
