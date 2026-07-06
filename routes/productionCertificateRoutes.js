const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const roleMiddleware = require("../middleware/roleMiddleware");

const {
  createCertificate,
  getCertificates,
  getCertificateById,
} = require("../controllers/productionCertificateController");

router.post(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  createCertificate,
);

router.get("/", authMiddleware, getCertificates);

router.get("/:id", authMiddleware, getCertificateById);

module.exports = router;
