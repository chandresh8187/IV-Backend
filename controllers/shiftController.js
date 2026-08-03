const db = require("../config/db");

const {
  TIME_ZONE,
  ensureAutomaticShift,
  getCurrentShiftInfo,
  getShiftSchedule,
} = require("../services/automaticShiftService");

const { getPlantStatusRow } = require("./plantStatusController");

const getShiftStatus = async (req, res) => {
  try {
    const schedule = await getShiftSchedule();

    const activeShift = await ensureAutomaticShift();

    const calculated = getCurrentShiftInfo(null, schedule);

    const plantStatus = await getPlantStatusRow();

    if (!plantStatus) {
      return res.status(404).json({
        success: false,
        message: "Plant status record not found",
      });
    }

    return res.json({
      success: true,
      data: {
        current_shift: activeShift?.shift_name || calculated.shift_name,

        shift_date: activeShift?.shift_date || calculated.shift_date,

        shift_start: activeShift?.start_time || calculated.shift_start,

        shift_end: calculated.shift_end,

        timezone: TIME_ZONE,

        automatic: Boolean(schedule.automatic),

        is_shift_active: Boolean(activeShift),

        active_shift: activeShift,

        plant_status: plantStatus.status,

        production_allowed:
          plantStatus.status === "running" && Boolean(activeShift),

        plant_notice:
          plantStatus.status === "running"
            ? null
            : {
                title: plantStatus.title,

                message: plantStatus.message,

                started_at: plantStatus.started_at,

                expected_restart_at: plantStatus.expected_restart_at,
              },
      },
    });
  } catch (error) {
    console.error("getShiftStatus:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to get shift status",
    });
  }
};

const toggleShift = async (req, res) => {
  const connection = await db.getConnection();

  let transactionStarted = false;

  try {
    const schedule = await getShiftSchedule(connection);

    if (schedule.automatic) {
      return res.status(409).json({
        success: false,
        message:
          "Manual shift control is unavailable while automatic shifts are enabled",
      });
    }

    const requestedShift = String(req.body.shift_name || req.body.shift || "")
      .toLowerCase()
      .trim();

    if (!["day", "night"].includes(requestedShift)) {
      return res.status(400).json({
        success: false,
        message: "shift_name must be day or night",
      });
    }

    if (
      req.user.role === "supervisor" &&
      ![requestedShift, "both"].includes(req.user.assigned_shift)
    ) {
      return res.status(403).json({
        success: false,
        message: `Your account is not assigned to the ${requestedShift} shift`,
      });
    }

    const calculated = getCurrentShiftInfo();

    const shiftDate = String(
      req.body.shift_date || req.body.shiftDate || calculated.shift_date,
    );

    if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) {
      return res.status(400).json({
        success: false,
        message: "shift_date must use YYYY-MM-DD format",
      });
    }

    await connection.beginTransaction();
    transactionStarted = true;

    const [activeRows] = await connection.query(
      `SELECT *
         FROM shifts
         WHERE status = 'active'
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
    );

    const active = activeRows[0] || null;

    let data;
    let action;

    if (active) {
      if (
        req.user.role === "supervisor" &&
        Number(active.started_by) !== Number(req.user.id)
      ) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({
          success: false,
          message: "Another supervisor started this shift and must end it",
        });
      }

      await connection.query(
        `UPDATE shifts
         SET
           status = 'closed',
           end_time = NOW(),
           ended_by = ?
         WHERE id = ?`,
        [req.user.id, active.id],
      );

      data = {
        ...active,
        status: "closed",
        end_time: new Date(),
      };

      action = "ended";
    } else {
      const [result] = await connection.query(
        `INSERT INTO shifts (
             shift_name,
             shift_date,
             start_time,
             status,
             started_by
           )
           VALUES (
             ?,
             ?,
             NOW(),
             'active',
             ?
           )`,
        [requestedShift, shiftDate, req.user.id],
      );

      await connection.query(
        `UPDATE shift_settings
         SET current_shift = ?
         WHERE id = 1`,
        [requestedShift],
      );

      data = {
        id: result.insertId,
        shift_name: requestedShift,
        shift_date: shiftDate,
        status: "active",
        automatic: false,
      };

      action = "started";
    }

    await connection.commit();
    transactionStarted = false;

    req.app.get("io")?.emit("shift_updated", {
      action,
      data,
    });

    return res.json({
      success: true,
      message: `Shift ${action} successfully`,
      data,
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }

    console.error("toggleShift:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to change shift",
    });
  } finally {
    connection.release();
  }
};

module.exports = {
  toggleShift,
  getShiftStatus,
};
