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
  roleMiddleware(["supervisor", "admin", "plant_manager", "superadmin"]),
  saveProductionEntry,
);

router.get("/", authMiddleware, getProductions);

router.get("/preferences/default-challan", authMiddleware, getProductionPreference);
router.put(
  "/preferences/default-challan",
  authMiddleware,
  roleMiddleware(["supervisor"]),
  setProductionPreference,
);

router.post(
  "/:id/edit-grant",
  authMiddleware,
  roleMiddleware(["superadmin"]),
  grantProductionEdit,
);

router.put(
  "/:id",
  authMiddleware,
  roleMiddleware(["superadmin"]),
  updateProductionById,
);

router.get("/:id", authMiddleware, getProductionById);

router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware(["superadmin"]),
  deleteProduction,
);

module.exports = router;
