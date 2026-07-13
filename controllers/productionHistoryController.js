const db = require("../config/db");

const toNumber = (value) => Number(value || 0);

const calculateZinc = (totalMs, totalGi) => {
  const ms = toNumber(totalMs);
  const gi = toNumber(totalGi);

  // ✅ FIX: Check if value is effectively 0 (smaller than precision threshold)
  if (ms <= 0.001) return 0; // Threshold for 3-decimal precision

  const result = ((gi - ms) / ms) * 100;

  // ✅ FIX: Return with 2 decimals but don't lose the value
  return Math.round(result * 100) / 100; // Safer than toFixed
};

const getTotalSummary = async (whereQuery, params) => {
  const [rows] = await db.query(
    `
    SELECT
      ROUND(COALESCE(SUM(ms_material_weight), 0), 4)
        AS total_ms_production_kg,

      ROUND(COALESCE(SUM(gi_material_weight), 0), 4)
        AS total_gi_production_kg
    FROM (
      SELECT
        material,
        AVG(NULLIF(ms_weight, 0)) * COALESCE(SUM(dipping_qty), 0)
          AS ms_material_weight,
        AVG(NULLIF(gi_weight, 0)) * COALESCE(SUM(dipping_qty), 0)
          AS gi_material_weight
      FROM production_entries
      ${whereQuery}
      GROUP BY material
    ) AS material_total
    `,
    params,
  );

  const totalMs = toNumber(rows[0]?.total_ms_production_kg);
  const totalGi = toNumber(rows[0]?.total_gi_production_kg);
  const zinkUsed = Number((totalGi - totalMs).toFixed(3));

  return {
    total_ms_production_kg: totalMs,
    total_gi_production_kg: totalGi,
    zink_used: zinkUsed,
    zinc_consumption: calculateZinc(totalMs, totalGi),
  };
};

const getHistoryDates = async (req, res) => {
  try {
    const [dates] = await db.query(
      `
      SELECT
        DATE_FORMAT(shift_date, '%Y-%m-%d') AS shift_date
      FROM production_entries
      GROUP BY shift_date
      ORDER BY shift_date DESC
      `,
    );

    const finalData = [];

    for (const item of dates) {
      const whereQuery = `
        WHERE shift_date = ?
      `;

      const summary = await getTotalSummary(whereQuery, [item.shift_date]);

      finalData.push({
        shift_date: item.shift_date,
        ...summary,
      });
    }

    return res.json({
      success: true,
      message: "History dates fetched successfully",
      data: finalData,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getHistoryDateSummary = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "date is required",
      });
    }

    const daySummary = await getTotalSummary(
      `
      WHERE shift_date = ?
      AND shift_name = 'day'
      `,
      [date],
    );

    const nightSummary = await getTotalSummary(
      `
      WHERE shift_date = ?
      AND shift_name = 'night'
      `,
      [date],
    );

    const totalMs =
      toNumber(daySummary.total_ms_production_kg) +
      toNumber(nightSummary.total_ms_production_kg);

    const totalGi =
      toNumber(daySummary.total_gi_production_kg) +
      toNumber(nightSummary.total_gi_production_kg);

    const total = {
      total_ms_production_kg: Number(totalMs.toFixed(3)),
      total_gi_production_kg: Number(totalGi.toFixed(3)),
      zink_used: Number((totalGi - totalMs).toFixed(3)),
      zinc_consumption: calculateZinc(totalMs, totalGi),
    };

    return res.json({
      success: true,
      message: "Date summary fetched successfully",
      data: {
        date,
        day_shift: daySummary,
        night_shift: nightSummary,
        total,
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

const getHistoryShiftTable = async (req, res) => {
  try {
    const { date, shift_name } = req.query;

    if (!date || !shift_name) {
      return res.status(400).json({
        success: false,
        message: "date and shift_name are required",
      });
    }

    if (!["day", "night"].includes(shift_name)) {
      return res.status(400).json({
        success: false,
        message: "shift_name must be day or night",
      });
    }

    const summary = await getTotalSummary(
      `
      WHERE shift_date = ?
      AND shift_name = ?
      `,
      [date, shift_name],
    );

    const [tableData] = await db.query(
      `
      SELECT
        id,
        shift_id,
        DATE_FORMAT(shift_date, '%Y-%m-%d') AS shift_date,
        shift_name,
        sr_no,
        production_time,
        challan_no,
        party_name,
        material,
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
        avg_coating
      FROM production_entries
      WHERE shift_date = ?
      AND shift_name = ?
      ORDER BY sr_no ASC
      `,
      [date, shift_name],
    );

    return res.json({
      success: true,
      message: "Shift table fetched successfully",
      data: {
        date,
        shift_name,
        summary,
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

const getHistoryMaterialSummary = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "date is required",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
        material,

        ROUND(AVG(NULLIF(ms_weight, 0)), 3) AS avg_ms_weight,
        ROUND(AVG(NULLIF(gi_weight, 0)), 3) AS avg_gi_weight,

        COALESCE(SUM(dipping_qty), 0) AS total_dip_qty,

        ROUND(
          AVG(NULLIF(ms_weight, 0)) * COALESCE(SUM(dipping_qty), 0),
          4
        ) AS total_ms_production_kg,

        ROUND(
          AVG(NULLIF(gi_weight, 0)) * COALESCE(SUM(dipping_qty), 0),
          4
        ) AS total_gi_production_kg,

        ROUND(
          (
            AVG(NULLIF(gi_weight, 0)) * COALESCE(SUM(dipping_qty), 0)
          ) -
          (
            AVG(NULLIF(ms_weight, 0)) * COALESCE(SUM(dipping_qty), 0)
          ),
          4
        ) AS zink_used,

        ROUND(
          (
            (
              AVG(NULLIF(gi_weight, 0)) * COALESCE(SUM(dipping_qty), 0)
            ) -
            (
              AVG(NULLIF(ms_weight, 0)) * COALESCE(SUM(dipping_qty), 0)
            )
          )
          /
          NULLIF(
            AVG(NULLIF(ms_weight, 0)) * COALESCE(SUM(dipping_qty), 0),
            4
          )
          * 100,
          2
        ) AS zinc_consumption,

        ROUND(AVG(NULLIF(avg_coating, 0)), 0) AS avg_coating

      FROM production_entries
      WHERE shift_date = ?
      GROUP BY material
      ORDER BY material ASC
      `,
      [date],
    );

    return res.json({
      success: true,
      message: "Material summary fetched successfully",
      data: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

const getHistoryPlanningSummary = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "date is required",
      });
    }

    const [rows] = await db.query(
      `
      SELECT
        pp.id,
        pp.challan_no,
        pp.party_name,
        pp.material_description,
        pp.planned_qty,
        pp.completed_qty,
        pp.third_party_name,
        pp.status,
        (pp.planned_qty - pp.completed_qty) AS remaining_qty,

        ROUND(
          CASE
            WHEN pp.planned_qty > 0
            THEN (pp.completed_qty / pp.planned_qty) * 100
            ELSE 0
          END,
          2
        ) AS completion_percentage

      FROM production_planning pp
      WHERE pp.challan_no IN (
        SELECT DISTINCT challan_no
        FROM production_entries
        WHERE shift_date = ?
        AND challan_no IS NOT NULL
      )
      ORDER BY pp.id DESC
      `,
      [date],
    );

    return res.json({
      success: true,
      message: "Planning summary fetched successfully",
      data: rows,
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
  getHistoryDates,
  getHistoryDateSummary,
  getHistoryShiftTable,
  getHistoryMaterialSummary,
  getHistoryPlanningSummary,
};
