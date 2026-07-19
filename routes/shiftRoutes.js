const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const { getShiftStatus, toggleShift } = require("../controllers/shiftController");

router.get("/status", authMiddleware, getShiftStatus);
router.post("/toggle", authMiddleware, toggleShift);

module.exports = router;
