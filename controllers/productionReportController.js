const db = require("../config/db");
const {
  generateProductionPdf,
} = require("../services/pdf/productionPdfGenerator");

const safeFilename = value =>
  String(value || "report")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-|-$/g, "");

const toNumber = value => Number(value || 0);

const calculateZinc = (totalMs, totalGi) => {
  const ms = toNumber(totalMs);
  const gi = toNumber(totalGi);

  if (ms <= 0.001) return 0;
  return Math.round((((gi - ms) / ms) * 100) * 100) / 100;
};

const getSummary = async (where, params) => {
  const [rows] = await db.query(
    `
    SELECT
      ROUND(COALESCE(SUM(ms_material_weight), 0), 4)
        AS total_ms_production_kg,
      ROUND(COALESCE(SUM(gi_material_weight), 0), 4)
        AS total_gi_production_kg
    FROM (
      SELECT
        pe.material,
        AVG(NULLIF(pe.ms_weight, 0)) * COALESCE(SUM(pe.dipping_qty), 0)
          AS ms_material_weight,
        AVG(NULLIF(pe.gi_weight, 0)) * COALESCE(SUM(pe.dipping_qty), 0)
          AS gi_material_weight
      FROM production_entries pe
      WHERE ${where}
        AND COALESCE(pe.row_type, 'entry') = 'entry'
      GROUP BY pe.material
    ) AS material_total
    `,
    params,
  );

  const totalMs = toNumber(rows[0]?.total_ms_production_kg);
  const totalGi = toNumber(rows[0]?.total_gi_production_kg);

  return {
    total_ms_production_kg: totalMs,
    total_gi_production_kg: totalGi,
    zink_used: Number((totalGi - totalMs).toFixed(3)),
    zinc_consumption: calculateZinc(totalMs, totalGi),
  };
};

const getReportFilter = ({ type, value, date, planningId }) => {
  if (type === "material") {
    return {
      where: "pe.shift_date = ? AND LOWER(pe.material) = LOWER(?)",
      params: [date, value],
      reportDate: date,
      shiftName: `${value} Material`,
    };
  }

  if (type === "shift") {
    return {
      where: "pe.shift_date = ? AND pe.shift_name = ?",
      params: [date, value.toLowerCase()],
      reportDate: date,
      shiftName: value,
    };
  }

  return {
    where: planningId ? "pe.planning_id = ?" : "pe.challan_no = ?",
    params: [planningId || value],
    reportDate: null,
    shiftName: `Challan ${value}`,
  };
};

const generateProductionReport = async (req, res) => {
  try {
    const type = String(req.query.type || "").toLowerCase();
    const value = String(req.query.value || "").trim();
    const date = String(req.query.date || "").trim();
    const planningId = Number(req.query.planning_id) || null;

    if (!["challan", "material", "shift"].includes(type) || !value) {
      return res.status(400).json({
        success: false,
        message: "type and value are required",
      });
    }
    if (
      ["material", "shift"].includes(type) &&
      !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid date is required",
      });
    }
    if (type === "shift" && !["day", "night"].includes(value.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: "Shift must be day or night",
      });
    }

    if (
      type === "challan" &&
      req.query.planning_id != null &&
      (!Number.isInteger(planningId) || planningId < 1)
    ) {
      return res.status(400).json({
        success: false,
        message: "planning_id must be a positive whole number",
      });
    }

    const filter = getReportFilter({ type, value, date, planningId });
    const [tableData] = await db.query(
      `
      SELECT
        pe.id,
        pe.shift_id,
        DATE_FORMAT(pe.shift_date, '%Y-%m-%d') AS shift_date,
        pe.shift_name,
        pe.sr_no,
        pe.production_time,
        pe.challan_no,
        pe.party_name,
        pe.material,
        pe.dipping_qty,
        pe.kettle_temperature,
        pe.ms_weight,
        pe.gi_weight,
        pe.zinc_percentage,
        pe.production_weight,
        pe.c1,
        pe.c2,
        pe.c3,
        pe.c4,
        pe.c5,
        pe.avg_coating
      FROM production_entries pe
      WHERE ${filter.where}
        AND COALESCE(pe.row_type, 'entry') = 'entry'
      ORDER BY pe.shift_date, pe.shift_name, pe.sr_no
      `,
      filter.params,
    );

    if (!tableData.length) {
      return res.status(404).json({
        success: false,
        message: "No production entries found for this report",
      });
    }

    const summary = await getSummary(filter.where, filter.params);
    const firstDate = tableData[0].shift_date;
    const lastDate = tableData[tableData.length - 1].shift_date;
    const reportDate =
      filter.reportDate ||
      (firstDate === lastDate ? firstDate : `${firstDate} to ${lastDate}`);
    const pdfBuffer = await generateProductionPdf({
      date: reportDate,
      shiftName: filter.shiftName,
      reportType: type,
      summary,
      tableData,
    });
    const filename = `production-${type}-${safeFilename(value)}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", pdfBuffer.length);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );
    return res.end(pdfBuffer);
  } catch (error) {
    console.error("generateProductionReport:", error);
    return res.status(500).json({
      success: false,
      message: "Could not generate production report",
    });
  }
};

module.exports = { generateProductionReport };
