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

router.post(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  createProductionPlanning,
);

router.put(
  "/:id",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  updateProductionPlanning,
);

router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  deleteProductionPlanning,
);

router.get("/", authMiddleware, getProductionPlanning);

router.get("/available", authMiddleware, getAvailablePlanningDropdown);

router.post(
  "/extract-pdf",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  upload.single("pdf"),
  extractPlanningPdf,
);

module.exports = router;
