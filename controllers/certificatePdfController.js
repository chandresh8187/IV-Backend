const {
  generateCoatingCertificatePdf,
} = require("../services/pdf/certificatePdfGenerator");
const db = require("../config/db");

const safeFilename = value =>
  String(value || "certificate")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-|-$/g, "");

const generateCertificatePdf = async (req, res) => {
  try {
    const { certificate, readings = [] } = req.body || {};

    if (!certificate?.tc_no) {
      return res.status(400).json({
        success: false,
        message: "certificate.tc_no is required",
      });
    }
    if (!Array.isArray(readings)) {
      return res.status(400).json({
        success: false,
        message: "readings must be an array",
      });
    }

    const pdfBuffer = await generateCoatingCertificatePdf({
      certificate,
      readings,
    });
    const filename = `certificate-${safeFilename(certificate.tc_no)}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    return res.end(pdfBuffer);
  } catch (error) {
    console.error("generateCertificatePdf:", error);
    return res.status(500).json({
      success: false,
      message: "Could not generate certificate PDF",
    });
  }
};

const downloadSavedCertificatePdf = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({ success: false, message: "Invalid certificate ID" });
    }
    const [rows] = await db.query(
      "SELECT * FROM coating_certificates WHERE id = ? AND deleted_at IS NULL LIMIT 1",
      [id],
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: "Certificate not found" });
    }
    const certificate = rows[0];
    const saved = certificate.coating_readings_json;
    const readings = Array.isArray(saved) ? saved : JSON.parse(saved || "[]");
    const pdfBuffer = await generateCoatingCertificatePdf({ certificate, readings });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.setHeader("Content-Disposition", `attachment; filename="certificate-${safeFilename(certificate.tc_no)}.pdf"`);
    return res.end(pdfBuffer);
  } catch (error) {
    console.error("downloadSavedCertificatePdf:", error);
    return res.status(500).json({ success: false, message: "Could not open certificate PDF" });
  }
};

module.exports = { generateCertificatePdf, downloadSavedCertificatePdf };
