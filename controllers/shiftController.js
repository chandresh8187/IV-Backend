const db = require("../config/db");
const { sendNotificationToRoles } = require("../utils/sendNotification");

const getNextShift = (shift) => {
  return shift === "day" ? "night" : "day";
};

const toggleShift = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const io = req.app.get("io");

    await connection.beginTransaction();

    const [settingsRows] = await connection.query(
      `
      SELECT *
      FROM shift_settings
      WHERE id = 1
      FOR UPDATE
      `,
    );

    if (settingsRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Shift settings not found",
      });
    }

    const currentShift = settingsRows[0].current_shift;

    const [activeShiftRows] = await connection.query(
      `
      SELECT *
      FROM shifts
      WHERE status = 'active'
      LIMIT 1
      FOR UPDATE
      `,
    );

    const [userRows] = await connection.query(
      `
  SELECT id, role, assigned_shift
  FROM users
  WHERE id = ?
  LIMIT 1
  `,
      [req.user.id],
    );

    const user = userRows[0];

    if (
      user.role === "supervisor" &&
      user.assigned_shift !== "both" &&
      user.assigned_shift !== currentShift
    ) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message: `You are assigned to ${user.assigned_shift} shift only`,
      });
    }

    // START SHIFT
    if (activeShiftRows.length === 0) {
      const shiftDate = new Date().toISOString().split("T")[0];

      const [result] = await connection.query(
        `
        INSERT INTO shifts
        (
          shift_name,
          shift_date,
          start_time,
          started_by,
          status
        )
        VALUES (?, ?, NOW(), ?, 'active')
        `,
        [currentShift, shiftDate, req.user.id],
      );

      await connection.commit();

      io.emit("shift_updated", {
        action: "started",
        shift_id: result.insertId,
        shift_name: currentShift,
        shift_date: shiftDate,
      });

      await sendNotificationToRoles({
        roles: ["admin", "superadmin"],
        title: "Shift Started",
        body: `${currentShift} shift started`,
        data: {
          type: "shift_started",
          shift_id: result.insertId,
          shift_name: currentShift,
        },
      });

      return res.status(201).json({
        success: true,
        action: "started",
        message: `${currentShift} shift started successfully`,
        data: {
          shift_id: result.insertId,
          current_shift: currentShift,
          shift_date: shiftDate,
          is_shift_active: true,
          active_shift: {
            id: result.insertId,
            shift_name: currentShift,
            shift_date: shiftDate,
          },
          button_text: `End ${currentShift} shift`,
        },
      });
    }

    // END SHIFT
    const activeShift = activeShiftRows[0];
    const nextShift = getNextShift(activeShift.shift_name);
    await connection.query(
      `
      UPDATE shifts
      SET
        end_time = NOW(),
        ended_by = ?,
        status = 'closed'
      WHERE id = ?
      `,
      [req.user.id, activeShift.id],
    );

    await connection.query(
      `
      UPDATE shift_settings
      SET current_shift = ?
      WHERE id = 1
      `,
      [nextShift],
    );

    await connection.commit();

    io.emit("shift_updated", {
      action: "ended",
      shift_id: activeShift.id,
      ended_shift: activeShift.shift_name,
      next_shift: nextShift,
      shift_date: activeShift.shift_date,
    });

    await sendNotificationToRoles({
      roles: ["admin", "superadmin"],
      title: "Shift Ended",
      body: `${activeShift.shift_name} shift ended`,
      data: {
        type: "shift_ended",
        shift_id: activeShift.id,
        next_shift: nextShift,
      },
    });

    return res.json({
      success: true,
      action: "ended",
      message: `${activeShift.shift_name} shift ended successfully`,
      data: {
        ended_shift_id: activeShift.id,
        ended_shift: activeShift.shift_name,
        ended_shift_date: activeShift.shift_date,
        current_shift: nextShift,
        is_shift_active: false,
        active_shift: null,
        button_text: `Start ${nextShift} shift`,
      },
    });
  } catch (error) {
    await connection.rollback();

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

const getShiftStatus = async (req, res) => {
  try {
    const [settingsRows] = await db.query(
      `
      SELECT *
      FROM shift_settings
      WHERE id = 1
      `,
    );

    if (settingsRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shift settings not found",
      });
    }

    const currentShift = settingsRows[0].current_shift;

    const [activeShiftRows] = await db.query(
      `
      SELECT 
        shifts.*,
        users.name AS supervisor_name,
        users.email AS supervisor_email
      FROM shifts
      LEFT JOIN users ON users.id = shifts.started_by
      WHERE shifts.status = 'active'
      LIMIT 1
      `,
    );

    const activeShift = activeShiftRows.length > 0 ? activeShiftRows[0] : null;

    return res.json({
      success: true,
      data: {
        current_shift: currentShift,
        is_shift_active: !!activeShift,
        active_shift: activeShift,
        button_text: activeShift
          ? `End ${activeShift.shift_name} shift`
          : `Start ${currentShift} shift`,
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
  toggleShift,
  getShiftStatus,
};
