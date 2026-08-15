const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const {
  getPlantStatus,
  changePlantStatus,
  getPlantStatusHistory,
} = require("../controllers/plantStatusController");

router.get(
  "/status",
  authMiddleware,
  roleMiddleware(["admin", "plant_manager", "superadmin"], "plant.view"),
  getPlantStatus,
);
router.post(
  "/status",
  authMiddleware,
  roleMiddleware(["plant_manager", "superadmin"], "plant.manage"),
  changePlantStatus,
);
router.get(
  "/history",
  authMiddleware,
  roleMiddleware(["plant_manager", "superadmin", "admin"], "plant.view"),
  getPlantStatusHistory,
);

module.exports = router;
