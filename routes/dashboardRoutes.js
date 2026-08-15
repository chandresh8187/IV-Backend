const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const { getDashboardData } = require("../controllers/dashboardController");

router.get(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "superadmin", "plant_manager"], "dashboard.view"),
  getDashboardData,
);

module.exports = router;
