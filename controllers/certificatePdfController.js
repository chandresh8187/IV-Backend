const {
  generateCoatingCertificatePdf,
} = require("../services/pdf/certificatePdfGenerator");

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

module.exports = { generateCertificatePdf };
