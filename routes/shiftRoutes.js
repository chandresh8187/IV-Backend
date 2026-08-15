const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { getShiftStatus, toggleShift } = require("../controllers/shiftController");

router.get(
  "/status",
  authMiddleware,
  roleMiddleware(["supervisor", "admin", "plant_manager", "superadmin"], "shifts.view"),
  getShiftStatus,
);
router.post(
  "/toggle",
  authMiddleware,
  roleMiddleware(["supervisor", "superadmin"], "shifts.manage"),
  toggleShift,
);

module.exports = router;
