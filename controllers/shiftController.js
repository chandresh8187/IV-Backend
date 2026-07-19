const { ensureAutomaticShift, getCurrentShiftInfo } = require("../services/automaticShiftService");
const { getPlantStatusRow } = require("./plantStatusController");

const getShiftStatus = async (req, res) => {
  try {
    const activeShift = await ensureAutomaticShift();
    const shiftInfo = getCurrentShiftInfo();
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
        current_shift: shiftInfo.shift_name,
        shift_date: shiftInfo.shift_date,
        shift_start: shiftInfo.shift_start,
        shift_end: shiftInfo.shift_end,
        timezone: shiftInfo.timezone,
        is_shift_active: true,
        active_shift: activeShift,
        plant_status: plantStatus.status,
        production_allowed: plantStatus.status === "running",
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
    return res.status(500).json({
      success: false,
      message: "Unable to get automatic shift status",
      error: error.message,
    });
  }
};

const toggleShift = async (req, res) => {
  return res.status(410).json({
    success: false,
    message: "Manual shift start/end has been removed. Shifts are automatic.",
  });
};

module.exports = {
  toggleShift,
  getShiftStatus,
};
