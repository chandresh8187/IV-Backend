const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");

const upload = multer({
  dest: path.join(__dirname, "../uploads/temp"),
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed"));
    }

    cb(null, true);
  },
});

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");
const { reorderPlanningQueue } = require('../controllers/planningQueueController');

router.put('/order', authMiddleware, roleMiddleware(['superadmin', 'plant_manager']),
  roleMiddleware([], 'planning.manage'), reorderPlanningQueue);

const {
  createProductionPlanning,
  updateProductionPlanning,
  deleteProductionPlanning,
  getProductionPlanning,
  getAvailablePlanningDropdown,
} = require("../controllers/productionPlanningController");
const {
  extractPlanningPdf,
} = require("../controllers/productionPlanningPdfController");
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

router.post(
  "/extract-pdf",
  authMiddleware,
  roleMiddleware(["admin", "superadmin", "plant_manager"], "planning.import_pdf"),
  upload.single("pdf"),
  extractPlanningPdf,
);

module.exports = router;
