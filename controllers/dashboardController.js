const db = require("../config/db");
const {
  ensureAutomaticShift,
  getCurrentShiftInfo,
  getShiftSchedule,
} = require("../services/automaticShiftService");

const getDashboardData = async (req, res) => {
  try {
    const schedule = await getShiftSchedule();
    const activeShift = await ensureAutomaticShift();
    const shiftInfo = getCurrentShiftInfo(null, schedule);
    const currentShift = activeShift?.shift_name || shiftInfo.shift_name;
    const todayDate = activeShift?.shift_date || shiftInfo.shift_date;

    const [plantRows] = await db.query(
      `
        SELECT
          ps.status,
          ps.title,
          ps.message,
          ps.started_at,
          ps.expected_restart_at,
          ps.updated_at,
          ps.updated_by,
          u.name AS updated_by_name,
          u.role AS updated_by_role
        FROM plant_status ps
        LEFT JOIN users u ON u.id = ps.updated_by
        WHERE ps.id = 1
        LIMIT 1
      `,
    );

    const plantStatusRow = plantRows[0] || {
      status: "running",
      title: null,
      message: null,
      started_at: null,
      expected_restart_at: null,
      updated_at: null,
      updated_by: null,
      updated_by_name: null,
      updated_by_role: null,
    };

    const plantStatus = {
      status: plantStatusRow.status || "running",
      title: plantStatusRow.title,
      message: plantStatusRow.message,
      started_at: plantStatusRow.started_at,
      expected_restart_at: plantStatusRow.expected_restart_at,
      updated_at: plantStatusRow.updated_at,
      production_allowed: plantStatusRow.status === "running",
      updated_by: plantStatusRow.updated_by
        ? {
            id: plantStatusRow.updated_by,
            name: plantStatusRow.updated_by_name,
            role: plantStatusRow.updated_by_role,
          }
        : null,
    };

    const getMaterialSummary = async (whereQuery, params) => {
      const [rows] = await db.query(
        `
    SELECT
      material,

      ROUND(AVG(NULLIF(ms_weight, 0)), 3) AS avg_ms_weight,
      ROUND(AVG(NULLIF(gi_weight, 0)), 3) AS avg_gi_weight,

      COALESCE(SUM(dipping_qty), 0) AS total_dip_qty,

      ROUND(
        AVG(NULLIF(ms_weight, 0)) * COALESCE(SUM(dipping_qty), 0),
        3
      ) AS total_ms_production_kg,

      ROUND(
        AVG(NULLIF(gi_weight, 0)) * COALESCE(SUM(dipping_qty), 0),
        3
      ) AS total_gi_production_kg,

      ROUND(
        (
          AVG(NULLIF(gi_weight, 0)) * COALESCE(SUM(dipping_qty), 0)
        ) -
        (
          AVG(NULLIF(ms_weight, 0)) * COALESCE(SUM(dipping_qty), 0)
        ),
        3
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
        (
          AVG(NULLIF(ms_weight, 0)) * COALESCE(SUM(dipping_qty), 0)
        )
        * 100,
        2
      ) AS zinc_consumption

    FROM production_entries
    ${whereQuery}
    GROUP BY material
    `,
        params,
      );

      return rows;
    };

    const getTotalSummary = async (whereQuery, params) => {
      const [rows] = await db.query(
        `
        SELECT
          ROUND(COALESCE(SUM(ms_material_weight), 0), 3)
            AS total_ms_production_kg,

          ROUND(COALESCE(SUM(gi_material_weight), 0), 3)
            AS total_gi_production_kg,
          COALESCE(SUM(material_qty), 0) AS total_dipping_qty

        FROM (
          SELECT
            material,

            AVG(NULLIF(ms_weight, 0)) * COALESCE(SUM(dipping_qty), 0)
              AS ms_material_weight,

            AVG(NULLIF(gi_weight, 0)) * COALESCE(SUM(dipping_qty), 0)
              AS gi_material_weight,
            COALESCE(SUM(dipping_qty), 0) AS material_qty

          FROM production_entries
          ${whereQuery}
          GROUP BY material
        ) AS material_total
        `,
        params,
      );

      const totalMs = Number(rows[0]?.total_ms_production_kg) || 0;
      const totalGi = Number(rows[0]?.total_gi_production_kg) || 0;
      const totalQty = Number(rows[0]?.total_dipping_qty) || 0;

      const differenceKg = Number((totalGi - totalMs).toFixed(1));

      const differencePercentage =
        totalMs > 0 ? Number(((differenceKg / totalMs) * 100).toFixed(2)) : 0;

      return {
        total_ms_production_kg: totalMs,
        total_gi_production_kg: totalGi,
        zink_used: differenceKg,
        zinc_consumption: differencePercentage,
        total_dipping_qty: totalQty,
      };
    };

    const dayWhere = `
      WHERE shift_date = ?
      AND shift_name = 'day'
    `;

    const nightWhere = `
      WHERE shift_date = ?
      AND shift_name = 'night'
    `;

    // Use Luxon's India-time operational month instead of the database server timezone.
    const monthWhere = `
      WHERE MONTH(shift_date) = ?
      AND YEAR(shift_date) = ?
    `;

    const activeWhere = "WHERE shift_id = ?";
    const emptyActiveSummary = {
      total_ms_production_kg: 0,
      total_gi_production_kg: 0,
      zink_used: 0,
      zinc_consumption: 0,
    };

    const [
      dayTotalSummary,
      nightTotalSummary,
      monthTotalSummary,
      activeShiftTotalSummary,
    ] = await Promise.all([
      getTotalSummary(dayWhere, [todayDate]),
      getTotalSummary(nightWhere, [todayDate]),
      getTotalSummary(monthWhere, [shiftInfo.month, shiftInfo.year]),
      activeShift
        ? getTotalSummary(activeWhere, [activeShift.id])
        : Promise.resolve(emptyActiveSummary),
    ]);

    const [monthlyRows] = await db.query(
      `SELECT DATE_FORMAT(production_date,'%Y-%m-%d') production_date,
              COALESCE(SUM(material_qty),0) total_dipping_qty,
              ROUND(COALESCE(SUM(ms_total),0),3) total_ms_production_kg,
              ROUND(COALESCE(SUM(gi_total),0),3) total_gi_production_kg
       FROM (
         SELECT shift_date production_date, material,
                COALESCE(SUM(dipping_qty),0) material_qty,
                AVG(NULLIF(ms_weight,0))*COALESCE(SUM(dipping_qty),0) ms_total,
                AVG(NULLIF(gi_weight,0))*COALESCE(SUM(dipping_qty),0) gi_total
         FROM production_entries
         WHERE MONTH(shift_date)=? AND YEAR(shift_date)=?
           AND COALESCE(row_type,'entry')='entry'
         GROUP BY shift_date, material
       ) daily_materials
       GROUP BY production_date ORDER BY production_date ASC`,
      [shiftInfo.month, shiftInfo.year],
    );
    const monthlyProductionSummary = monthlyRows.map((row) => {
      const totalMs = Number(row.total_ms_production_kg) || 0;
      const totalGi = Number(row.total_gi_production_kg) || 0;
      return {
        ...row,
        zink_used: Number((totalGi-totalMs).toFixed(3)),
        zinc_consumption: totalMs > 0 ? Number((((totalGi-totalMs)/totalMs)*100).toFixed(2)) : 0,
      };
    });

    const activeShiftZincConsumption =
      activeShiftTotalSummary.zinc_consumption;

    return res.json({
      success: true,
      message: "Dashboard data fetched successfully",
      data: {
        today_date: todayDate,

        plant_status: plantStatus,

        shift_status: {
          current_shift: currentShift,
          is_shift_active: !!activeShift,
          active_shift: activeShift,
          automatic: Boolean(schedule.automatic),
          timezone: shiftInfo.timezone,
          shift_start: shiftInfo.shift_start,
          shift_end: shiftInfo.shift_end,
        },

        today_summary: {
          day_shift: {
            ...dayTotalSummary,
          },

          night_shift: {
            ...nightTotalSummary,
          },
        },

        current_month: {
          ...monthTotalSummary,
          daily_summary: monthlyProductionSummary,
        },

        active_shift_summary: {
          ...activeShiftTotalSummary,
          zinc_consumption: activeShiftZincConsumption,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = {
  getDashboardData,
};
