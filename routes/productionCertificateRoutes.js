const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const {
  createCertificate,
  getCertificateReadings,
  getCertificates,
  getCertificateById,
} = require("../controllers/productionCertificateController");
const {
  generateCertificatePdf,
} = require("../controllers/certificatePdfController");

router.post(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  createCertificate,
);

router.get("/", authMiddleware, getCertificates);

router.get("/readings", authMiddleware, getCertificateReadings);

router.post(
  "/pdf",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  generateCertificatePdf,
);

router.get("/:id", authMiddleware, getCertificateById);

module.exports = router;
