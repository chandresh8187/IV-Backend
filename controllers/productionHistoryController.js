const db = require("../config/db");

const toNumber = (value) => Number(value || 0);

const formatPercent = (giTotal, msTotal) => {
  const ms = toNumber(msTotal);
  const gi = toNumber(giTotal);

  if (!ms || ms <= 0) return "0.00";

  return (((gi - ms) / ms) * 100).toFixed(2);
};

const getProductionHistory = async (req, res) => {
  try {
    const { date, shift_name, material } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "date is required",
      });
    }

    if (!shift_name) {
      return res.status(400).json({
        success: false,
        message: "shift_name is required",
      });
    }

    if (!["day", "night"].includes(shift_name)) {
      return res.status(400).json({
        success: false,
        message: "shift_name must be day or night",
      });
    }

    let materialCondition = "";
    const materialParams = [];

    if (material) {
      materialCondition = " AND material LIKE ?";
      materialParams.push(`%${material}%`);
    }

    const [tableData] = await db.query(
      `
      SELECT
        id,
        shift_id,
        DATE_FORMAT(shift_date, '%Y-%m-%d') AS shift_date,
        shift_name,
        sr_no,
        challan_no,
        party_name,
        material,
        row_type,
        production_time,
        dipping_qty,
        kettle_temperature,
        ms_weight,
        gi_weight,
        zinc_percentage,
        production_weight,
        c1,
        c2,
        c3,
        c4,
        c5,
        avg_coating,
        total_dip_qty,
        total_ms_production_kg,
        total_gi_production_kg,
        zinc_consumption_kg,
        zinc_consumption_percentage
      FROM production_entries
      WHERE shift_date = ?
      AND shift_name = ?
      ${materialCondition}
      ORDER BY sr_no ASC
      `,
      [date, shift_name, ...materialParams],
    );

    const [summaryRows] = await db.query(
      `
      SELECT
        COALESCE(SUM(dipping_qty), 0) AS total_dip_qty,

        COALESCE(
          SUM(
            CASE
              WHEN ms_weight IS NOT NULL AND dipping_qty IS NOT NULL
              THEN ms_weight * dipping_qty
              ELSE 0
            END
          ),
          0
        ) AS total_ms_production_kg,

        COALESCE(
          SUM(
            CASE
              WHEN gi_weight IS NOT NULL AND dipping_qty IS NOT NULL
              THEN gi_weight * dipping_qty
              ELSE 0
            END
          ),
          0
        ) AS total_gi_production_kg,

        COALESCE(AVG(NULLIF(avg_coating, 0)), 0) AS avg_coating
      FROM production_entries
      WHERE shift_date = ?
      AND shift_name = ?
      AND row_type = 'entry'
      ${materialCondition}
      `,
      [date, shift_name, ...materialParams],
    );

    const summaryData = summaryRows[0];

    const totalMs = toNumber(summaryData.total_ms_production_kg);
    const totalGi = toNumber(summaryData.total_gi_production_kg);
    const zincKg = totalGi - totalMs;

    const summary = {
      date,
      shift_name,
      total_dip_qty: toNumber(summaryData.total_dip_qty),
      total_ms_production_kg: totalMs.toFixed(3),
      total_gi_production_kg: totalGi.toFixed(3),
      zinc_consumption_kg: zincKg.toFixed(3),
      zinc_consumption_percentage: formatPercent(totalGi, totalMs),
      avg_coating: Math.round(toNumber(summaryData.avg_coating)),
    };

    const [materialSummary] = await db.query(
      `
      SELECT
        material,
        COALESCE(SUM(dipping_qty), 0) AS total_dip_qty,
        ROUND(AVG(NULLIF(ms_weight, 0)), 3) AS avg_ms_weight,
        ROUND(AVG(NULLIF(gi_weight, 0)), 3) AS avg_gi_weight,

        ROUND(
          COALESCE(SUM(ms_weight * dipping_qty), 0),
          3
        ) AS total_ms_production_kg,

        ROUND(
          COALESCE(SUM(gi_weight * dipping_qty), 0),
          3
        ) AS total_gi_production_kg,

        ROUND(
          COALESCE(SUM(gi_weight * dipping_qty), 0) -
          COALESCE(SUM(ms_weight * dipping_qty), 0),
          3
        ) AS zinc_consumption_kg,

        ROUND(
          CASE
            WHEN COALESCE(SUM(ms_weight * dipping_qty), 0) > 0
            THEN (
              (
                COALESCE(SUM(gi_weight * dipping_qty), 0) -
                COALESCE(SUM(ms_weight * dipping_qty), 0)
              ) / COALESCE(SUM(ms_weight * dipping_qty), 0)
            ) * 100
            ELSE 0
          END,
          2
        ) AS zinc_consumption_percentage,

        ROUND(AVG(NULLIF(avg_coating, 0)), 0) AS avg_coating
      FROM production_entries
      WHERE shift_date = ?
      AND shift_name = ?
      AND row_type = 'entry'
      ${materialCondition}
      GROUP BY material
      ORDER BY material ASC
      `,
      [date, shift_name, ...materialParams],
    );

    return res.json({
      success: true,
      message: "Production history fetched successfully",
      data: {
        filter: {
          date,
          shift_name,
          material: material || "",
        },
        summary,
        material_summary: materialSummary,
        table_data: tableData,
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
