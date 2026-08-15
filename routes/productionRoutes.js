const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const {
  saveProductionEntry,
  getProductions,
  getProductionById,
  deleteProduction,
  grantProductionEdit,
  updateProductionById,
  getProductionPreference,
  setProductionPreference,
} = require("../controllers/productionController");

router.post(
  "/save",
  authMiddleware,
  roleMiddleware(["supervisor", "admin", "plant_manager", "superadmin"], "production.save"),
  saveProductionEntry,
);

router.get(
  "/",
  authMiddleware,
  roleMiddleware(["supervisor", "admin", "plant_manager", "superadmin"], "production.view"),
  getProductions,
);

router.get("/preferences/default-challan", authMiddleware, getProductionPreference);
router.put(
  "/preferences/default-challan",
  authMiddleware,
  roleMiddleware(["supervisor"], "production.save"),
  setProductionPreference,
);

router.post(
  "/:id/edit-grant",
  authMiddleware,
  roleMiddleware(["superadmin"], "production.grant_edit"),
  grantProductionEdit,
);

router.put(
  "/:id",
  authMiddleware,
  roleMiddleware(["superadmin"], "production.manage_all"),
  updateProductionById,
);

router.get(
  "/:id",
  authMiddleware,
  roleMiddleware(["supervisor", "admin", "plant_manager", "superadmin"], "production.view"),
  getProductionById,
);

router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware(["superadmin"], "production.manage_all"),
  deleteProduction,
);

module.exports = router;
