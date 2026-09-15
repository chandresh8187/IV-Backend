const db = require("../config/db");
const { getConfiguredCurrentFinancialYear } = require('../services/financialYearService');
const { DateTime } = require("luxon");

const normalizeFinancialYear = (value) =>
  String(value || "")
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, "");

const validateFinancialYear = (value) => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return "Financial year must use YYYY-YY format, for example 2026-27";

  const startYear = Number(match[1]);
  const expectedEnd = String((startYear + 1) % 100).padStart(2, "0");
  if (match[2] !== expectedEnd) {
    return `Financial year ending must be ${expectedEnd} for start year ${startYear}`;
  }

  return null;
};

const parseFinancialYearId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const findFinancialYearById = async (id) => {
  const [rows] = await db.query(
    `SELECT
       financial_years.id,
       financial_years.financial_year,
       financial_years.created_by,
       financial_years.created_at,
       financial_years.updated_at,
       users.name AS created_by_name
     FROM financial_years
     LEFT JOIN users ON users.id = financial_years.created_by
     WHERE financial_years.id = ?
     LIMIT 1`,
    [id],
  );

  return rows[0] || null;
};

const getCurrentFinancialYearValue = () => {
  const today = DateTime.now().setZone("Asia/Kolkata");
  const startYear = today.month >= 4 ? today.year : today.year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
};

const getCurrentFinancialYear = async (req, res) => {
  try {
    const year = await getConfiguredCurrentFinancialYear();

    return res.json({
      success: true,
      message: "Current financial year fetched successfully",
      data: year,
    });
  } catch (error) {
    console.error("getCurrentFinancialYear:", error);
    return res.status(error.status || 500).json({
      success: false,
      code: error.code,
      message: error.status ? error.message : "Could not load the current financial year",
    });
  }
};

const getFinancialYears = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
         financial_years.id,
         financial_years.financial_year,
         financial_years.created_by,
         financial_years.created_at,
         financial_years.updated_at,
         users.name AS created_by_name
       FROM financial_years
       LEFT JOIN users ON users.id = financial_years.created_by
       ORDER BY financial_years.financial_year DESC, financial_years.id DESC`,
    );

    return res.json({
      success: true,
      message: "Financial years fetched successfully",
      data: rows,
    });
  } catch (error) {
    console.error("getFinancialYears:", error);
    return res.status(500).json({
      success: false,
      message: "Could not load financial years",
    });
  }
};

const createFinancialYear = async (req, res) => {
  try {
    const financialYear = normalizeFinancialYear(req.body?.financial_year);
    const validationError = validateFinancialYear(financialYear);

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const [result] = await db.query(
      "INSERT INTO financial_years (financial_year, created_by) VALUES (?, ?)",
      [financialYear, req.user.id],
    );
    const record = await findFinancialYearById(result.insertId);

    req.app.get("io")?.emit("financial_years_updated", {
      action: "created",
      financial_year: record,
    });

    return res.status(201).json({
      success: true,
      message: "Financial year added successfully",
      data: record,
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "This financial year already exists",
      });
    }

    console.error("createFinancialYear:", error);
    return res.status(500).json({
      success: false,
      message: "Could not add financial year",
    });
  }
};

const updateFinancialYear = async (req, res) => {
  try {
    const id = parseFinancialYearId(req.params.id);
    const financialYear = normalizeFinancialYear(req.body?.financial_year);
    const validationError = validateFinancialYear(financialYear);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid financial year id",
      });
    }

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const existingRecord = await findFinancialYearById(id);
    if (!existingRecord) {
      return res.status(404).json({
        success: false,
        message: "Financial year not found",
      });
    }

    await db.query(
      `UPDATE financial_years
       SET financial_year = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [financialYear, id],
    );
    const record = await findFinancialYearById(id);

    req.app.get("io")?.emit("financial_years_updated", {
      action: "updated",
      financial_year: record,
    });

    return res.json({
      success: true,
      message: "Financial year updated successfully",
      data: record,
    });
  } catch (error) {
    if (error?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "This financial year already exists",
      });
    }

    console.error("updateFinancialYear:", error);
    return res.status(500).json({
      success: false,
      message: "Could not update financial year",
    });
  }
};

const deleteFinancialYear = async (req, res) => {
  try {
    const id = parseFinancialYearId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Invalid financial year id",
      });
    }

    const record = await findFinancialYearById(id);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: "Financial year not found",
      });
    }

    const [result] = await db.query(
      "DELETE FROM financial_years WHERE id = ?",
      [id],
    );
    if (!result.affectedRows) {
      return res.status(404).json({
        success: false,
        message: "Financial year not found",
      });
    }

    req.app.get("io")?.emit("financial_years_updated", {
      action: "deleted",
      financial_year: { id, financial_year: record.financial_year },
    });

    return res.json({
      success: true,
      message: "Financial year deleted successfully",
      data: { id },
    });
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ success: false,
        message: 'This year is current or linked to production plans and cannot be deleted. Set another year as current first.' });
    }
    console.error("deleteFinancialYear:", error);
    return res.status(500).json({
      success: false,
      message: "Could not delete financial year",
    });
  }
};

const setCurrentFinancialYear = async (req, res) => {
  try {
    const id = parseFinancialYearId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid financial year id' });
    const record = await findFinancialYearById(id);
    if (!record) return res.status(404).json({ success: false, message: 'Financial year not found' });
    await db.query(`INSERT INTO current_financial_year (id, financial_year_id) VALUES (1, ?)
      ON DUPLICATE KEY UPDATE financial_year_id = VALUES(financial_year_id)`, [id]);
    const year = await getConfiguredCurrentFinancialYear();
    req.app.get('io')?.emit('financial_years_updated', { action: 'current_changed', financial_year: year });
    return res.json({ success: true, message: `${year.financial_year} is now the current financial year`, data: year });
  } catch (error) {
    console.error('setCurrentFinancialYear:', error);
    return res.status(500).json({ success: false, message: 'Could not set the current financial year' });
  }
};

module.exports = {
  setCurrentFinancialYear,
  createFinancialYear,
  deleteFinancialYear,
  getFinancialYears,
  getCurrentFinancialYear,
  getCurrentFinancialYearValue,
  normalizeFinancialYear,
  parseFinancialYearId,
  updateFinancialYear,
  validateFinancialYear,
};
