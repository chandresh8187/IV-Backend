const PDFDocument = require("pdfkit");
const db = require("../config/db");

const safeFilename = (value) => String(value || "report").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "");

const generateProductionReport = async (req, res) => {
  try {
    const type = String(req.query.type || "").toLowerCase();
    const value = String(req.query.value || "").trim();
    const date = String(req.query.date || "").trim();
    if (!["challan", "material", "shift"].includes(type) || !value) {
      return res.status(400).json({ success: false, message: "type and value are required" });
    }
    if (["material", "shift"].includes(type) && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: "A valid date is required" });
    }
    if (type === "shift" && !["day", "night"].includes(value.toLowerCase())) {
      return res.status(400).json({ success: false, message: "Shift must be day or night" });
    }

    let where = "pe.challan_no = ?";
    let params = [value];
    let title = `Challan ${value}`;
    if (type === "material") {
      where = "pe.shift_date = ? AND LOWER(pe.material) = LOWER(?)";
      params = [date, value];
      title = `${value} - ${date}`;
    } else if (type === "shift") {
      where = "pe.shift_date = ? AND pe.shift_name = ?";
      params = [date, value.toLowerCase()];
      title = `${value.toUpperCase()} Shift - ${date}`;
    }

    const [rows] = await db.query(
      `SELECT pe.* FROM production_entries pe
       WHERE ${where} AND COALESCE(pe.row_type,'entry')='entry'
       ORDER BY pe.shift_date, pe.shift_name, pe.sr_no`,
      params,
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "No production entries found for this report" });

    const filename = `production-${type}-${safeFilename(value)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 28 });
    doc.pipe(res);
    doc.fontSize(18).fillColor("#16345c").text("IV SQUARE STRUCTURE", { align: "center" });
    doc.fontSize(11).fillColor("#111827").text(`Production Report: ${title}`, { align: "center" });
    doc.moveDown();

    const columns = [
      ["Date", 65], ["Shift", 42], ["SR", 28], ["Challan", 92], ["Material", 95],
      ["Qty", 38], ["MS", 47], ["GI", 47], ["Zn %", 42], ["C1", 30], ["C2", 30],
      ["C3", 30], ["C4", 30], ["C5", 30], ["Avg", 36],
    ];
    const drawRow = (values, header = false) => {
      if (doc.y > 545) doc.addPage();
      let x = 28;
      const y = doc.y;
      if (header) doc.rect(28, y - 2, 785, 17).fill("#e8f0fb").fillColor("#16345c");
      else doc.fillColor("#111827");
      doc.font(header ? "Helvetica-Bold" : "Helvetica").fontSize(7.5);
      columns.forEach(([label, width], index) => {
        doc.text(String(header ? label : values[index] ?? "-"), x + 2, y, { width: width - 4, height: 14, ellipsis: true });
        x += width;
      });
      doc.y = y + 17;
    };
    drawRow([], true);
    rows.forEach((row) => drawRow([
      String(row.shift_date).slice(0, 10), row.shift_name, row.sr_no, row.challan_no,
      row.material, row.dipping_qty, row.ms_weight, row.gi_weight, row.zinc_percentage,
      row.c1, row.c2, row.c3, row.c4, row.c5, row.avg_coating,
    ]));

    const totalQty = rows.reduce((sum, row) => sum + (Number(row.dipping_qty) || 0), 0);
    const totalMs = rows.reduce((sum, row) => sum + (Number(row.ms_weight) || 0) * (Number(row.dipping_qty) || 0), 0);
    const totalGi = rows.reduce((sum, row) => sum + (Number(row.gi_weight) || 0) * (Number(row.dipping_qty) || 0), 0);
    doc.moveDown().font("Helvetica-Bold").fontSize(9).text(
      `Entries: ${rows.length}   Quantity: ${totalQty} NOS   MS: ${totalMs.toFixed(3)} kg   GI: ${totalGi.toFixed(3)} kg   Zinc: ${totalMs > 0 ? (((totalGi-totalMs)/totalMs)*100).toFixed(2) : "0.00"}%`,
    );
    doc.end();
  } catch (error) {
    console.error("generateProductionReport:", error);
    if (!res.headersSent) return res.status(500).json({ success: false, message: "Could not generate production report" });
    res.end();
  }
};

module.exports = { generateProductionReport };
