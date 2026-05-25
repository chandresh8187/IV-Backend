const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const {
  getProductionHistory,
} = require("../controllers/productionHistoryController");

/*
GET /api/production-history

Examples:

/api/production-history

/api/production-history?from_date=2026-05-23&to_date=2026-05-23

/api/production-history?shift_name=day

/api/production-history?material=w beam

/api/production-history?month=5&year=2026
*/

router.get(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  getProductionHistory,
);

module.exports = router;
