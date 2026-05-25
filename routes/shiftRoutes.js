const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const {
  toggleShift,
  getShiftStatus,
} = require("../controllers/shiftController");

router.get("/status", authMiddleware, getShiftStatus);

router.post(
  "/toggle",
  authMiddleware,
  roleMiddleware(["supervisor", "superadmin"]),
  toggleShift,
);

module.exports = router;
