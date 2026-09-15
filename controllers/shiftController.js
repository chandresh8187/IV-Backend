const {
  TIME_ZONE,
  ensureAutomaticShift,
  getCurrentShiftInfo,
  getShiftSchedule,
} = require("../services/automaticShiftService");
const { getPlantStatusRow } = require("./plantStatusController");
const { getProductionContext, canUseShiftCorrection } = require('../services/productionShiftContextService');

const getShiftStatus = async (req, res) => {
  try {
    const schedule = await getShiftSchedule();
    const activeShift = await ensureAutomaticShift();
    const productionContext = await getProductionContext(activeShift, canUseShiftCorrection(req.user));
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
        shift_duration_hours: 12,
        timezone: TIME_ZONE,
        automatic: true,
        is_shift_active: Boolean(activeShift),
        active_shift: activeShift,
        production_shift: productionContext.shift,
        correction_mode: productionContext.correction,
        shift_revision: Number(productionContext.state.revision),
        correction_opened_by: productionContext.state.opened_by,
        correction_opened_at: productionContext.state.opened_at,
        correction_production_allowed: productionContext.correction,
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

module.exports = { getShiftStatus };
