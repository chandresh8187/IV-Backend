const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { getShiftStatus } = require("../controllers/shiftController");
const { listPreviousShifts, getCorrectionPlanningItems, openCorrection, resumeCurrentShift } = require('../controllers/shiftCorrectionController');
const correctionManagers = roleMiddleware([], 'shifts.correct');

router.get('/correction/shifts', authMiddleware, correctionManagers, listPreviousShifts);
router.post('/correction', authMiddleware, correctionManagers, openCorrection);
router.post('/correction/resume', authMiddleware, correctionManagers, resumeCurrentShift);
router.get('/correction/planning-items', authMiddleware,
  roleMiddleware(['superadmin', 'plant_manager', 'supervisor']),
  roleMiddleware([], 'production.save'), getCorrectionPlanningItems);
// Live Production needs its target shift even when Shift Status is not enabled
// separately in the user's feature permissions.
router.get('/production-context', authMiddleware,
  roleMiddleware([], 'production.view'), getShiftStatus);

router.get(
  "/status",
  authMiddleware,
  roleMiddleware(["supervisor", "admin", "plant_manager", "superadmin"], "shifts.view"),
  getShiftStatus,
);

module.exports = router;
