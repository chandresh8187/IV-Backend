const db = require("../config/db");
const {
  generateProductionPlanningPdf,
} = require("../services/pdf/productionPlanningPdfGenerator");

const safeFilename = (value) =>
  String(value || "planning")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-|-$/g, "");

const getProductionPlanningFile = async (req, res) => {
  try {
    const planningId = Number(req.params.id);
    if (!Number.isInteger(planningId) || planningId < 1) {
      return res.status(400).json({ success: false, message: "Invalid production planning id" });
    }

    const [planningRows] = await db.query(
      `SELECT pp.*, creator.name AS created_by_name
       FROM production_planning pp
       LEFT JOIN users creator ON creator.id = pp.created_by
       WHERE pp.id = ? AND pp.deleted_at IS NULL
       LIMIT 1`,
      [planningId],
    );
    if (!planningRows.length) {
      return res.status(404).json({ success: false, message: "Production planning not found" });
    }

    const [items] = await db.query(
      `SELECT ppi.*,
              COALESCE(ppi.challan_no, pp.challan_no) AS challan_no,
              COALESCE(ppi.party_name, pp.party_name, '') AS party_name,
              COALESCE(i.item_name, ppi.material_description) AS item_name
       FROM production_planning_items ppi
       INNER JOIN production_planning pp ON pp.id = ppi.planning_id
       LEFT JOIN items i ON i.id = ppi.item_id
       WHERE ppi.planning_id = ?
       ORDER BY ppi.sequence_no ASC`,
      [planningId],
    );
    const pdfBuffer = await generateProductionPlanningPdf({
      planning: planningRows[0],
      items,
    });
    const filename = `production-flow-${safeFilename(planningRows[0].id)}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.end(pdfBuffer);
  } catch (error) {
    console.error("getProductionPlanningFile:", error);
    return res.status(500).json({
      success: false,
      message: "Could not generate the production planning file",
    });
  }
};

module.exports = { getProductionPlanningFile };
