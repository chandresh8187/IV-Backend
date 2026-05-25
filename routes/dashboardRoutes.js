const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const { getDashboardData } = require("../controllers/dashboardController");

router.get(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  getDashboardData,
);

module.exports = router;
