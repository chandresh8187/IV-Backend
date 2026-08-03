const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const {
  getActiveSupervisors,
  getSupervisors,
} = require("../controllers/supervisorController");

router.get(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "superadmin", "plant_manager"]),
  getSupervisors,
);

router.get(
  "/active",
  authMiddleware,
  roleMiddleware(["admin", "superadmin", "plant_manager"]),
  getActiveSupervisors,
);

module.exports = router;
