const db = require('../config/db');
const { DateTime } = require('luxon');
const { editPurchase } = require('../services/zincPurchaseService');
const { generateZincPurchasePdf } = require('../services/pdf/zincPurchasePdfGenerator');
const { checkStockAlerts } = require('../services/stockAlertService');

const purchaseSql = `SELECT p.*, DATE_FORMAT(p.transaction_date, '%Y-%m-%d') transaction_date,
  TIME_FORMAT(p.transaction_time, '%H:%i') transaction_time, DATE_FORMAT(p.created_at, '%Y-%m-%d %H:%i:%s') created_at,
  DATE_FORMAT(p.updated_at, '%Y-%m-%d %H:%i:%s') updated_at, u.name actor_name
  FROM zinc_purchases p LEFT JOIN users u ON u.id=p.actor_user_id`;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sendError = (res, error) => res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not complete the zinc purchase request.' });
async function readPurchases(query) {
  const month = query.month;
  if (month && (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month) || !DateTime.fromISO(`${month}-01`).isValid)) throw fail('Select a valid purchase month.');
  const params = month ? [`${month}-01`, DateTime.fromISO(`${month}-01`).endOf('month').toISODate()] : [];
  const [rows] = await db.query(`${purchaseSql}${month ? ' WHERE p.transaction_date BETWEEN ? AND ?' : ''} ORDER BY p.transaction_date DESC, p.transaction_time DESC, p.id DESC`, params);
  return rows;
}
const getPurchases = async (req, res) => {
  try {
    const rows = await readPurchases(req.query);
    return res.json({ success: true, data: rows, summary: { count: rows.length, amount_kg: rows.reduce((sum, row) => sum + Number(row.amount_kg), 0), purchase_value: rows.reduce((sum, row) => sum + Number(row.amount_kg) * Number(row.zinc_rate_per_kg), 0) } });
  } catch (error) { return sendError(res, error); }
};
const updatePurchase = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const result = await editPurchase(connection, { id: Number(req.params.id), body: req.body || {}, actorId: req.user.id });
    await connection.commit();
    if (!result.alreadySaved) {
      ['zinc_stock_updated', 'zinc_byproduct_updated', 'expense_report_updated', 'dashboard_updated'].forEach(event => req.app.get('io')?.emit(event, {}));
      checkStockAlerts().catch(error => console.error('Stock alert check failed:', error));
    }
    return res.json({ success: true, message: result.alreadySaved ? 'Purchase correction already saved.' : 'Zinc purchase updated.', data: result.data });
  } catch (error) {
    if (connection) await connection.rollback();
    return sendError(res, error);
  } finally { connection?.release(); }
};
const downloadPurchasesPdf = async (req, res) => {
  try {
    const rows = await readPurchases(req.query);
    const pdf = await generateZincPurchasePdf(rows, { scopeLabel: req.query.month ? `Purchases | ${req.query.month}` : 'All recorded zinc purchases' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="zinc-purchase.pdf"');
    return res.end(pdf);
  } catch (error) { return sendError(res, error); }
};
module.exports = { getPurchases, updatePurchase, downloadPurchasesPdf };
