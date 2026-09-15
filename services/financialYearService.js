const db = require('../config/db');
const { DateTime } = require('luxon');

const getConfiguredCurrentFinancialYear = async (executor = db) => {
  const today = DateTime.now().setZone('Asia/Kolkata');
  const startYear = today.month >= 4 ? today.year : today.year - 1;
  const calendarYear = `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
  const [rows] = await executor.query(
    `SELECT fy.*, EXISTS(SELECT 1 FROM current_financial_year cfy WHERE cfy.id = 1 AND cfy.financial_year_id = fy.id) AS is_current FROM financial_years fy
     WHERE fy.id = (SELECT financial_year_id FROM current_financial_year WHERE id = 1)
        OR (NOT EXISTS (SELECT 1 FROM current_financial_year WHERE id = 1)
            AND fy.financial_year = ?)
     LIMIT 1`, [calendarYear],
  );
  if (!rows.length) {
    throw Object.assign(new Error('Set a current financial year in Settings > Financial Year before continuing.'), {
      status: 409, code: 'CURRENT_FINANCIAL_YEAR_NOT_CONFIGURED',
    });
  }
  const year = Number(String(rows[0].financial_year).slice(0, 4));
  return { ...rows[0], start_date: `${year}-04-01`, end_date: `${year + 1}-03-31` };
};

const currentHistoryYear = async (req, res, next) => {
  try {
    // Planning reports intentionally span a challan's lifetime.
    if (req.path === '/report' && String(req.query.type).toLowerCase() === 'challan') return next();
    const year = await getConfiguredCurrentFinancialYear();
    req.financialYear = year;
    const date = String(req.query.date || '').trim();
    if (date && (date < year.start_date || date > year.end_date)) {
      return res.status(409).json({ success: false, code: 'DATE_OUTSIDE_CURRENT_FINANCIAL_YEAR',
        message: `Select a production date between ${year.start_date} and ${year.end_date} (${year.financial_year}).` });
    }
    return next();
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, code: error.code,
      message: error.status ? error.message : 'Could not load the current financial year' });
  }
};

module.exports = { getConfiguredCurrentFinancialYear, currentHistoryYear };
