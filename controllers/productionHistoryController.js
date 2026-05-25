const db = require("../config/db");

const getProductionHistory = async (req, res) => {
  try {
    const {
      from_date,
      to_date,
      month,
      year,
      shift_name,
      supervisor_id,
      material,
    } = req.query;

    let where = `WHERE 1 = 1`;
    const params = [];

    if (from_date && to_date) {
      where += ` AND DATE(pe.shift_date) BETWEEN ? AND ?`;
      params.push(from_date, to_date);
    }

    if (month && year) {
      where += ` AND MONTH(DATE(pe.shift_date)) = ? AND YEAR(DATE(pe.shift_date)) = ?`;
      params.push(Number(month), Number(year));
    }

    if (shift_name) {
      where += ` AND pe.shift_name = ?`;
      params.push(shift_name);
    }

    if (supervisor_id) {
      where += ` AND pe.created_by = ?`;
      params.push(supervisor_id);
    }

    if (material) {
      where += ` AND pe.material LIKE ?`;
      params.push(`%${material}%`);
    }

    const [rows] = await db.query(
      `
      SELECT
        pe.*,
        DATE_FORMAT(pe.shift_date, '%Y-%m-%d') AS shift_date,
        creator.name AS supervisor_name,
        creator.email AS supervisor_email
      FROM production_entries pe
      LEFT JOIN users creator ON creator.id = pe.created_by
      ${where}
      ORDER BY pe.shift_date DESC, pe.shift_name ASC, pe.sr_no ASC
      `,
      params,
    );

    const [summaryRows] = await db.query(
      `
      SELECT
        ROUND(COALESCE(SUM(ms_material_weight), 0), 3)
          AS total_ms_production_kg,
        ROUND(COALESCE(SUM(gi_material_weight), 0), 3)
          AS total_gi_production_kg
      FROM (
        SELECT
          DATE(pe.shift_date) AS shift_date,
          pe.shift_name,
          pe.material,
          AVG(NULLIF(pe.ms_weight, 0)) * COALESCE(SUM(pe.dipping_qty), 0)
            AS ms_material_weight,
          AVG(NULLIF(pe.gi_weight, 0)) * COALESCE(SUM(pe.dipping_qty), 0)
            AS gi_material_weight
        FROM production_entries pe
        ${where}
        GROUP BY DATE(pe.shift_date), pe.shift_name, pe.material
      ) AS material_total
      `,
      params,
    );

    const totalMs = Number(summaryRows[0]?.total_ms_production_kg) || 0;
    const totalGi = Number(summaryRows[0]?.total_gi_production_kg) || 0;

    const zincConsumptionKg = Number((totalGi - totalMs).toFixed(3));

    const zincConsumptionPercentage =
      totalMs > 0
        ? Number((((totalGi - totalMs) / totalMs) * 100).toFixed(2))
        : 0;

    const [materialSummary] = await db.query(
      `
      SELECT
        DATE_FORMAT(pe.shift_date, '%Y-%m-%d') AS shift_date,
        pe.shift_name,
        pe.material,

        ROUND(AVG(NULLIF(pe.ms_weight, 0)), 3) AS avg_ms_weight,
        ROUND(AVG(NULLIF(pe.gi_weight, 0)), 3) AS avg_gi_weight,

        COALESCE(SUM(pe.dipping_qty), 0) AS total_dip_qty,

        ROUND(
          AVG(NULLIF(pe.ms_weight, 0)) * COALESCE(SUM(pe.dipping_qty), 0),
          3
        ) AS total_ms_production_kg,

        ROUND(
          AVG(NULLIF(pe.gi_weight, 0)) * COALESCE(SUM(pe.dipping_qty), 0),
          3
        ) AS total_gi_production_kg,

        ROUND(
          (
            AVG(NULLIF(pe.gi_weight, 0)) * COALESCE(SUM(pe.dipping_qty), 0)
          ) -
          (
            AVG(NULLIF(pe.ms_weight, 0)) * COALESCE(SUM(pe.dipping_qty), 0)
          ),
          3
        ) AS zinc_consumption_kg,

        ROUND(
          (
            (
              AVG(NULLIF(pe.gi_weight, 0)) * COALESCE(SUM(pe.dipping_qty), 0)
            ) -
            (
              AVG(NULLIF(pe.ms_weight, 0)) * COALESCE(SUM(pe.dipping_qty), 0)
            )
          )
          /
          (
            AVG(NULLIF(pe.ms_weight, 0)) * COALESCE(SUM(pe.dipping_qty), 0)
          )
          * 100,
          2
        ) AS zinc_consumption_percentage

      FROM production_entries pe
      ${where}
      GROUP BY DATE(pe.shift_date), pe.shift_name, pe.material
      ORDER BY DATE(pe.shift_date) DESC, pe.shift_name ASC, pe.material ASC
      `,
      params,
    );

    return res.json({
      success: true,
      message: "Production history fetched successfully",
      data: {
        filters: {
          from_date: from_date || null,
          to_date: to_date || null,
          month: month || null,
          year: year || null,
          shift_name: shift_name || null,
          supervisor_id: supervisor_id || null,
          material: material || null,
        },
        summary: {
          total_ms_production_kg: totalMs,
          total_gi_production_kg: totalGi,
          zinc_consumption_kg: zincConsumptionKg,
          zinc_consumption_percentage: zincConsumptionPercentage,
        },
        material_summary: materialSummary,
        table_data: rows,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

module.exports = {
  getProductionHistory,
};
