const express = require("express");

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

const router = express.Router();

router.post(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"], "certificates.generate"),
  createCertificate,
);

router.get(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"], "certificates.view"),
  getCertificates,
);

router.get(
  "/readings",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"], "certificates.view"),
  getCertificateReadings,
);

router.post(
  "/pdf",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"], "certificates.generate"),
  generateCertificatePdf,
);

router.get(
  "/:id",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"], "certificates.view"),
  getCertificateById,
);

module.exports = router;
