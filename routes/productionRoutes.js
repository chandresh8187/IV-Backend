const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const {
  saveProductionEntry,
  getProductions,
  getProductionById,
  deleteProduction,
  getProductionHistory,
} = require("../controllers/productionController");

router.post(
  "/save",
  authMiddleware,
  roleMiddleware(["supervisor", "plant_manager", "superadmin"]),
  saveProductionEntry,
);

router.get("/", authMiddleware, getProductions);

router.get("/:id", authMiddleware, getProductionById);

router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware(["superadmin"]),
  deleteProduction,
);

module.exports = router;
