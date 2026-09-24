const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { reorderPlanningQueue } = require('../controllers/planningQueueController');

router.put('/order', authMiddleware, roleMiddleware([], 'planning.manage'), reorderPlanningQueue);

const {
  createProductionPlanning,
  updateProductionPlanning,
  deleteProductionPlanning,
  getProductionPlanning,
  getAvailablePlanningDropdown,
} = require("../controllers/productionPlanningController");
const {
  getProductionPlanningFile,
} = require("../controllers/productionPlanningFileController");

router.post(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "superadmin", "plant_manager"], "planning.manage"),
  createProductionPlanning,
);

router.put(
  "/:id",
  authMiddleware,
  roleMiddleware(["admin", "superadmin", "plant_manager"], "planning.manage"),
  updateProductionPlanning,
);

router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware(["admin", "superadmin", "plant_manager"], "planning.manage"),
  deleteProductionPlanning,
);

router.get(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "superadmin", "plant_manager"], "planning.view"),
  getProductionPlanning,
);

router.get(
  "/available",
  authMiddleware,
  roleMiddleware(["supervisor", "admin", "superadmin", "plant_manager"], "production.view"),
  getAvailablePlanningDropdown,
);

router.get(
  "/:id/pdf",
  authMiddleware,
  roleMiddleware(["admin", "superadmin", "plant_manager"], "planning.view"),
  getProductionPlanningFile,
);

module.exports = router;
