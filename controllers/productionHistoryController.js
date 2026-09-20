const db = require("../config/db");

const toNumber = (value) => Number(value || 0);

const calculateZinc = (totalMs, totalGi) => {
  const ms = toNumber(totalMs);
  const gi = toNumber(totalGi);
  if (ms <= 0.001) return 0;
  return Math.round((((gi - ms) / ms) * 100) * 100) / 100;
};

// Each entry can have a different unit weight, so use weight × quantity per row.
const enrichSummary = (row = {}) => {
  const totalMs = toNumber(row.total_ms_production_kg);
  const totalGi = toNumber(row.total_gi_production_kg);
  return {
    ...row,
    entry_count: toNumber(row.entry_count),
    total_production_qty: toNumber(row.total_production_qty),
    total_ms_production_kg: Number(totalMs.toFixed(4)),
    total_gi_production_kg: Number(totalGi.toFixed(4)),
    zink_used: Number((totalGi - totalMs).toFixed(4)),
    zinc_consumption: calculateZinc(totalMs, totalGi),
  };
};

const getTotalSummary = async (whereQuery, params) => {
  const [rows] = await db.query(
    `SELECT
       COUNT(*) AS entry_count,
       COALESCE(SUM(dipping_qty), 0) AS total_production_qty,
       ROUND(COALESCE(SUM(COALESCE(ms_weight, 0) * COALESCE(dipping_qty, 0)), 0), 4)
         AS total_ms_production_kg,
       ROUND(COALESCE(SUM(COALESCE(gi_weight, 0) * COALESCE(dipping_qty, 0)), 0), 4)
         AS total_gi_production_kg,
       ROUND(AVG(NULLIF(avg_coating, 0)), 0) AS avg_coating
     FROM production_entries
     ${whereQuery}
       AND COALESCE(row_type, 'entry') = 'entry'`,
    params,
  );
  return enrichSummary(rows[0]);
};

const getHistoryDates = async (req, res) => {
  try {
    const month = String(req.query.month || "").trim();
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({
        success: false,
        message: "month must use YYYY-MM format",
      });
    }

    const [dates] = await db.query(
      `SELECT
         DATE_FORMAT(shift_date, '%Y-%m-%d') AS shift_date,
         COUNT(*) AS entry_count,
         COALESCE(SUM(dipping_qty), 0) AS total_production_qty,
         ROUND(COALESCE(SUM(COALESCE(ms_weight, 0) * COALESCE(dipping_qty, 0)), 0), 4)
           AS total_ms_production_kg,
         ROUND(COALESCE(SUM(COALESCE(gi_weight, 0) * COALESCE(dipping_qty, 0)), 0), 4)
           AS total_gi_production_kg
       FROM production_entries
       WHERE (? = '' OR DATE_FORMAT(shift_date, '%Y-%m') = ?)
         AND shift_date BETWEEN ? AND ?
         AND COALESCE(row_type, 'entry') = 'entry'
       GROUP BY shift_date
       ORDER BY shift_date DESC`,
      [month, month, req.financialYear.start_date, req.financialYear.end_date],
    );

    return res.json({
      success: true,
      message: "History dates fetched successfully",
      data: dates.map(enrichSummary),
    });
  } catch (error) {
    console.error("getHistoryDates:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getHistoryDateSummary = async (req, res) => {
  try {
    const date = String(req.query.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: "date must use YYYY-MM-DD format",
      });
    }

    const [daySummary, nightSummary, total] = await Promise.all([
      getTotalSummary("WHERE shift_date = ? AND LOWER(shift_name) = 'day'", [date]),
      getTotalSummary("WHERE shift_date = ? AND LOWER(shift_name) = 'night'", [date]),
      getTotalSummary("WHERE shift_date = ?", [date]),
    ]);

    return res.json({
      success: true,
      message: "Date summary fetched successfully",
      data: { date, day_shift: daySummary, night_shift: nightSummary, total },
    });
  } catch (error) {
    console.error("getHistoryDateSummary:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getHistoryShiftTable = async (req, res) => {
  try {
    const date = String(req.query.date || "").trim();
    const shiftName = String(req.query.shift_name || "").trim().toLowerCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !["day", "night"].includes(shiftName)) {
      return res.status(400).json({
        success: false,
        message: "A valid date and day or night shift_name are required",
      });
    }

    const summary = await getTotalSummary(
      "WHERE shift_date = ? AND LOWER(shift_name) = ?",
      [date, shiftName],
    );
    const [tableData] = await db.query(
      `SELECT id, shift_id, planning_id, planning_item_id, item_id, contractor_id,
              (SELECT name FROM contractors WHERE contractors.id = production_entries.contractor_id) AS contractor_name,
              DATE_FORMAT(shift_date, '%Y-%m-%d') AS shift_date,
              shift_name, sr_no, production_time, challan_no, party_name, material,
              dipping_qty, kettle_temperature, ms_weight, gi_weight,
              zinc_percentage, production_weight, c1, c2, c3, c4, c5, avg_coating
       FROM production_entries
       WHERE shift_date = ? AND LOWER(shift_name) = ?
         AND COALESCE(row_type, 'entry') = 'entry'
       ORDER BY sr_no ASC, id ASC`,
      [date, shiftName],
    );

    return res.json({
      success: true,
      message: "Shift table fetched successfully",
      data: { date, shift_name: shiftName, summary, table_data: tableData },
    });
  } catch (error) {
    console.error("getHistoryShiftTable:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getHistoryMaterialSummary = async (req, res) => {
  try {
    const date = String(req.query.date || "").trim();
    const shiftName = String(req.query.shift_name || "").trim().toLowerCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: "date must use YYYY-MM-DD format",
      });
    }
    if (shiftName && !["day", "night"].includes(shiftName)) {
      return res.status(400).json({ success: false, message: "shift_name must be day or night" });
    }
    const shiftFilter = shiftName ? " AND LOWER(pe.shift_name) = ?" : "";

    const [rows] = await db.query(
      `SELECT
         COALESCE(pe.item_id, ppi.item_id) AS item_id,
         COALESCE(i.item_name, NULLIF(pe.material, ''), 'Unassigned material') AS material_name,
         GROUP_CONCAT(DISTINCT NULLIF(COALESCE(ppi.material_description, pe.material), '')
           ORDER BY COALESCE(ppi.material_description, pe.material) SEPARATOR ' | ')
           AS material_descriptions,
         COUNT(*) AS entry_count,
         COALESCE(SUM(pe.dipping_qty), 0) AS total_production_qty,
         COALESCE(SUM(CASE WHEN LOWER(pe.shift_name) = 'day'
           THEN pe.dipping_qty ELSE 0 END), 0) AS day_produced_qty,
         COALESCE(SUM(CASE WHEN LOWER(pe.shift_name) = 'night'
           THEN pe.dipping_qty ELSE 0 END), 0) AS night_produced_qty,
         ROUND(AVG(NULLIF(pe.ms_weight, 0)), 3) AS avg_ms_weight,
         ROUND(AVG(NULLIF(pe.gi_weight, 0)), 3) AS avg_gi_weight,
         ROUND(COALESCE(SUM(COALESCE(pe.ms_weight, 0) * COALESCE(pe.dipping_qty, 0)), 0), 4)
           AS total_ms_production_kg,
         ROUND(COALESCE(SUM(COALESCE(pe.gi_weight, 0) * COALESCE(pe.dipping_qty, 0)), 0), 4)
           AS total_gi_production_kg,
         ROUND(AVG(NULLIF(pe.avg_coating, 0)), 0) AS avg_coating
       FROM production_entries pe
       LEFT JOIN production_planning_items ppi ON ppi.id = pe.planning_item_id
       LEFT JOIN items i ON i.id = COALESCE(pe.item_id, ppi.item_id)
       WHERE pe.shift_date = ?${shiftFilter} AND COALESCE(pe.row_type, 'entry') = 'entry'
       GROUP BY
         COALESCE(pe.item_id, ppi.item_id),
         COALESCE(i.item_name, NULLIF(pe.material, ''), 'Unassigned material')
       ORDER BY material_name ASC`,
      shiftName ? [date, shiftName] : [date],
    );

    return res.json({
      success: true,
      message: "Material summary fetched successfully",
      data: rows.map(enrichSummary),
    });
  } catch (error) {
    console.error("getHistoryMaterialSummary:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getHistoryPlanningSummary = async (req, res) => {
  try {
    const date = String(req.query.date || "").trim();
    const shiftName = String(req.query.shift_name || "").trim().toLowerCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: "date must use YYYY-MM-DD format",
      });
    }
    if (shiftName && !["day", "night"].includes(shiftName)) {
      return res.status(400).json({ success: false, message: "shift_name must be day or night" });
    }
    const shiftFilter = shiftName ? " AND LOWER(pe.shift_name) = ?" : "";

    const [rows] = await db.query(
      `SELECT
         pp.id AS planning_id,
         ppi.id AS planning_item_id,
         COALESCE(ppi.challan_no, pp.challan_no) AS challan_no,
         COALESCE(ppi.party_name, pp.party_name, '') AS party_name,
         COALESCE(i.item_name, ppi.material_description, pe.material) AS item_name,
         COALESCE(ppi.material_description, pp.material_description, pe.material) AS material_description,
         COALESCE(ppi.planned_qty, pp.planned_qty) AS planned_qty,
         COALESCE(ppi.completed_qty, pp.completed_qty) AS completed_qty,
         COALESCE(ppi.planned_qty - ppi.completed_qty, pp.planned_qty - pp.completed_qty)
           AS remaining_qty,
         COALESCE(ppi.target_zinc_percentage, pp.target_zinc_percentage)
           AS target_zinc_percentage,
         COALESCE(ppi.status, pp.status) AS status,
         COALESCE(MIN(ppi.sequence_no), 1) AS sequence_no,
         COALESCE(SUM(CASE WHEN LOWER(pe.shift_name) = 'day'
           THEN pe.dipping_qty ELSE 0 END), 0) AS day_produced_qty,
         COALESCE(SUM(CASE WHEN LOWER(pe.shift_name) = 'night'
           THEN pe.dipping_qty ELSE 0 END), 0) AS night_produced_qty,
         COALESCE(SUM(pe.dipping_qty), 0) AS total_produced_qty
       FROM production_entries pe
       INNER JOIN production_planning pp ON pp.id = pe.planning_id
       LEFT JOIN production_planning_items ppi ON ppi.id = pe.planning_item_id
       LEFT JOIN items i ON i.id = COALESCE(pe.item_id, ppi.item_id)
       WHERE pe.shift_date = ?${shiftFilter}
         AND COALESCE(pe.row_type, 'entry') = 'entry'
         AND pp.deleted_at IS NULL
       GROUP BY
         pp.id, ppi.id,
         COALESCE(ppi.challan_no, pp.challan_no),
         COALESCE(ppi.party_name, pp.party_name, ''),
         COALESCE(i.item_name, ppi.material_description, pe.material),
         COALESCE(ppi.material_description, pp.material_description, pe.material),
         COALESCE(ppi.planned_qty, pp.planned_qty),
         COALESCE(ppi.completed_qty, pp.completed_qty),
         COALESCE(ppi.target_zinc_percentage, pp.target_zinc_percentage),
         COALESCE(ppi.status, pp.status)
       ORDER BY pp.id DESC, sequence_no ASC`,
      shiftName ? [date, shiftName] : [date],
    );

    return res.json({
      success: true,
      message: "Planning item summary fetched successfully",
      data: rows,
    });
  } catch (error) {
    console.error("getHistoryPlanningSummary:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const getHistoryPartySummary = async (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    const shiftName = String(req.query.shift_name || '').trim().toLowerCase();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (shiftName && !['day', 'night'].includes(shiftName))) {
      return res.status(400).json({ success: false, message: 'A valid date and optional day or night shift are required' });
    }
    const party = "COALESCE(NULLIF(TRIM(ppi.party_name), ''), NULLIF(TRIM(pp.party_name), ''), NULLIF(TRIM(pe.party_name), ''), 'Unassigned party')";
    const material = "COALESCE(i.item_name, NULLIF(pe.material, ''), 'Unassigned material')";
    const [rows] = await db.query(`SELECT
      ${party} AS party_name,
      COALESCE(pe.item_id, ppi.item_id) AS item_id,
      ${material} AS material_name,
      COUNT(*) AS entry_count,
      COALESCE(SUM(pe.dipping_qty), 0) AS total_production_qty,
      COALESCE(SUM(CASE WHEN LOWER(pe.shift_name) = 'day' THEN pe.dipping_qty ELSE 0 END), 0) AS day_produced_qty,
      COALESCE(SUM(CASE WHEN LOWER(pe.shift_name) = 'night' THEN pe.dipping_qty ELSE 0 END), 0) AS night_produced_qty,
      COALESCE(SUM(COALESCE(pe.ms_weight, 0) * COALESCE(pe.dipping_qty, 0)), 0) AS total_ms_production_kg,
      COALESCE(SUM(COALESCE(pe.gi_weight, 0) * COALESCE(pe.dipping_qty, 0)), 0) AS total_gi_production_kg
      FROM production_entries pe
      LEFT JOIN production_planning pp ON pp.id = pe.planning_id
      LEFT JOIN production_planning_items ppi ON ppi.id = pe.planning_item_id
      LEFT JOIN items i ON i.id = COALESCE(pe.item_id, ppi.item_id)
      WHERE pe.shift_date = ? AND COALESCE(pe.row_type, 'entry') = 'entry'
      ${shiftName ? 'AND LOWER(pe.shift_name) = ?' : ''}
      GROUP BY ${party}, COALESCE(pe.item_id, ppi.item_id), ${material}
      ORDER BY party_name, material_name`, shiftName ? [date, shiftName] : [date]);
    return res.json({ success: true, data: rows.map(enrichSummary) });
  } catch (error) {
    console.error('getHistoryPartySummary:', error);
    return res.status(500).json({ success: false, message: 'Could not load party summary' });
  }
};

module.exports = {
  getHistoryPartySummary,
  getHistoryDates,
  getHistoryDateSummary,
  getHistoryShiftTable,
  getHistoryMaterialSummary,
  getHistoryPlanningSummary,
};
