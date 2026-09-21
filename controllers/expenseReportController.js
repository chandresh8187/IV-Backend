const db = require('../config/db');
const { DateTime } = require('luxon');
const { SETTING_FIELDS, normalizeExpenseSettings, validateExpenseSettings, calculateExpenseReport } = require('../services/expenseReportService');
const { generateExpenseReportPdf } = require('../services/pdf/expenseReportPdfGenerator');

const monthBounds = value => {
  const month = value || DateTime.now().setZone('Asia/Kolkata').toFormat('yyyy-MM');
  if (!/^\d{4}-\d{2}$/.test(month)) throw Object.assign(new Error('Month must use YYYY-MM format.'), { status: 400 });
  const start = DateTime.fromISO(`${month}-01`);
  if (!start.isValid) throw Object.assign(new Error('Select a valid report month.'), { status: 400 });
  return { month, from: start.toISODate(), to: start.endOf('month').toISODate() };
};

const readSettings = async () => {
  const [rows] = await db.query('SELECT * FROM expense_settings WHERE id = 1');
  return normalizeExpenseSettings(rows[0]);
};

const buildReport = async monthValue => {
  const period = monthBounds(monthValue);
  const [settings, productionResult, stockResult, purchasedResult, recoveryResult] = await Promise.all([
    readSettings(),
    db.query(`SELECT
      ROUND(COALESCE(SUM(COALESCE(ms_weight, 0) * COALESCE(dipping_qty, 0)), 0), 3) total_ms_kg,
      ROUND(COALESCE(SUM(COALESCE(gi_weight, 0) * COALESCE(dipping_qty, 0)), 0), 3) total_gi_kg,
      COUNT(DISTINCT shift_date) production_days
      FROM production_entries WHERE shift_date BETWEEN ? AND ? AND COALESCE(row_type, 'entry') = 'entry'`, [period.from, period.to]),
    db.query('SELECT plant_kg FROM zinc_stock WHERE id = 1'),
    db.query(`SELECT ROUND(COALESCE(SUM(amount_kg), 0), 3) purchased_zinc_kg
      FROM zinc_stock_movements WHERE movement_type = 'receive' AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`, [period.from, period.to]),
    db.query(`SELECT ROUND(COALESCE(SUM(recovered_zinc_kg), 0), 3) recovered_zinc_kg
      FROM zinc_byproduct_transactions WHERE transaction_date BETWEEN ? AND ?`, [period.from, period.to]),
  ]);
  return {
    period,
    ...calculateExpenseReport({
      settings,
      production: productionResult[0][0],
      stock: stockResult[0][0],
      purchasedZincKg: purchasedResult[0][0]?.purchased_zinc_kg,
      recoveredZincKg: recoveryResult[0][0]?.recovered_zinc_kg,
    }),
  };
};

const sendError = (res, error) => {
  if (!error.status) console.error('Expense report:', error);
  return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not complete the expense report request.' });
};

const getExpenseReport = async (req, res) => {
  try { return res.json({ success: true, data: await buildReport(req.query.month) }); }
  catch (error) { return sendError(res, error); }
};

const getExpenseSettings = async (req, res) => {
  try { return res.json({ success: true, data: await readSettings() }); }
  catch (error) { return sendError(res, error); }
};

const saveExpenseSettings = async (req, res) => {
  let connection;
  try {
    const settings = validateExpenseSettings(req.body || {});
    const columns = SETTING_FIELDS.join(', ');
    const placeholders = SETTING_FIELDS.map(() => '?').join(', ');
    const updates = SETTING_FIELDS.map(field => `${field} = VALUES(${field})`).join(', ');
    connection = await db.getConnection();
    await connection.beginTransaction();
    const values = SETTING_FIELDS.map(field => settings[field]);
    await connection.query(`INSERT INTO expense_settings (id, ${columns}, updated_by) VALUES (1, ${placeholders}, ?)
      ON DUPLICATE KEY UPDATE ${updates}, updated_by = VALUES(updated_by), updated_at = CURRENT_TIMESTAMP`, [...SETTING_FIELDS.map(field => settings[field]), req.user.id]);
    await connection.query(`INSERT INTO expense_settings_history (${columns}, actor_user_id) VALUES (${placeholders}, ?)`, [...values, req.user.id]);
    await connection.commit();
    req.app.get('io')?.emit('expense_report_updated', {});
    return res.json({ success: true, message: 'Expense settings updated.', data: settings });
  } catch (error) { if (connection) await connection.rollback().catch(() => {}); return sendError(res, error); }
  finally { connection?.release(); }
};

const downloadExpenseReportPdf = async (req, res) => {
  try {
    const report = await buildReport(req.query.month);
    const pdf = await generateExpenseReportPdf(report);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Content-Disposition', `inline; filename="expense-report-${report.period.month}.pdf"`);
    return res.end(pdf);
  } catch (error) { return sendError(res, error); }
};

module.exports = { getExpenseReport, getExpenseSettings, saveExpenseSettings, downloadExpenseReportPdf, buildReport, monthBounds };
