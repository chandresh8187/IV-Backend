const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const {
  createProductionPlanning,
  updateProductionPlanning,
  deleteProductionPlanning,
  getProductionPlanning,
  getAvailablePlanningDropdown,
} = require("../controllers/productionPlanningController");

router.post(
  "/",
  authMiddleware,
  roleMiddleware(["production_manager", "superadmin"]),
  createProductionPlanning,
);

router.put(
  "/:id",
  authMiddleware,
  roleMiddleware(["production_manager", "superadmin"]),
  updateProductionPlanning,
);

router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware(["production_manager", "superadmin"]),
  deleteProductionPlanning,
);

router.get("/", authMiddleware, getProductionPlanning);

router.get("/available", authMiddleware, getAvailablePlanningDropdown);

module.exports = router;
