const crypto = require('crypto');
const db = require('../config/db');
const { normalizeMovement, applyMovement, serializeStock } = require('../services/zincStockService');
const { generateZincStockPdf } = require('../services/pdf/zincStockPdfGenerator');
const { hasPermission } = require('../services/permissionService');
const { getConfiguredCurrentFinancialYear } = require('../services/financialYearService');
const { buildReport: buildExpenseReport } = require('./expenseReportController');
const { checkStockAlerts, ZINC_LIMIT_KG } = require('../services/stockAlertService');
const { zincMovementLedgerSql, buildZincMovementReport } = require('../services/zincMovementReportService');

const readFinancialYearAverageRate = async (queryable = db) => {
  const year = await getConfiguredCurrentFinancialYear(queryable);
  const [rows] = await queryable.query(`SELECT ROUND(AVG(zinc_rate_per_kg), 2) AS average_zinc_rate,
    COUNT(zinc_rate_per_kg) AS rate_count
    FROM zinc_stock_movements
    WHERE movement_type = 'receive' AND zinc_rate_per_kg IS NOT NULL AND zinc_rate_per_kg > 0
      AND DATE(created_at) BETWEEN ? AND ?`, [year.start_date, year.end_date]);
  return {
    average_zinc_rate: rows[0]?.average_zinc_rate == null ? null : Number(rows[0].average_zinc_rate),
    rate_count: Number(rows[0]?.rate_count || 0),
    financial_year: year.financial_year,
    from: year.start_date,
    to: year.end_date,
  };
};

const sendError = (res, error) => {
  if (!error.status) console.error('Zinc stock:', error);
  return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not complete the zinc stock request.' });
};

const readStock = async (queryable = db) => {
  const [rows] = await queryable.query('SELECT * FROM zinc_stock WHERE id = 1');
  return serializeStock(rows[0]);
};

const getZincStock = async (req, res) => {
  try {
    const [stock, rate, ledger] = await Promise.all([
      readStock(),
      readFinancialYearAverageRate(),
      db.query(zincMovementLedgerSql),
    ]);
    return res.json({
      success: true,
      data: {
        ...stock,
        ...rate,
        batch_balances: buildZincMovementReport(ledger[0]).batch_balances,
        low_stock: stock.initialized && Number(stock.plant_kg) <= ZINC_LIMIT_KG,
        stock_alert_threshold_kg: ZINC_LIMIT_KG,
      },
    });
  }
  catch (error) { return sendError(res, error); }
};

const getAverageZincRate = async (req, res) => {
  try {
    const rate = await readFinancialYearAverageRate();
    return res.json({
      success: true,
      data: rate,
    });
  } catch (error) { return sendError(res, error); }
};

const getRateCalculatorContext = async (req, res) => {
  try {
    const [stock, expenseReport] = await Promise.all([
      readStock(),
      buildExpenseReport(),
    ]);
    return res.json({
      success: true,
      data: {
        current_zinc_rate: stock?.current_zinc_rate ?? null,
        running_plant_cost: Number(expenseReport?.totals?.running_plant_cost || 0),
        expense_month: expenseReport?.period?.month || null,
      },
    });
  } catch (error) { return sendError(res, error); }
};

const getZincMovements = async (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = (page - 1) * limit;
    const [ledger] = await db.query(zincMovementLedgerSql);
    const rows = buildZincMovementReport(ledger).rows;
    return res.json({ success: true, data: rows.slice(offset, offset + limit), pagination: { page, limit, has_more: rows.length > offset + limit } });
  } catch (error) { return sendError(res, error); }
};

const downloadZincMovementsPdf = async (req, res) => {
  try {
    const [ledger] = await db.query(zincMovementLedgerSql);
    const pdf = await generateZincStockPdf(buildZincMovementReport(ledger).rows);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Content-Disposition', 'inline; filename="zinc-stock-report.pdf"');
    return res.end(pdf);
  } catch (error) { return sendError(res, error); }
};

const saveZincMovement = async (req, res) => {
  let connection;
  let transaction = false;
  try {
    const movement = normalizeMovement(req.body || {});
    const permissionKey = movement.action === 'receive'
      ? 'zinc_stock.receive'
      : movement.action === 'transfer'
        ? 'zinc_stock.transfer'
        : 'zinc_stock.adjust';
    const allowed = await hasPermission({
      userId: req.user.id,
      role: req.user.role,
      permissionKey,
    });
    if (!allowed) {
      throw Object.assign(new Error('You do not have access to perform this zinc stock operation.'), { status: 403 });
    }
    const hash = crypto.createHash('sha256').update(JSON.stringify({ ...movement, actor: req.user.id })).digest('hex');
    connection = await db.getConnection();
    await connection.beginTransaction();
    transaction = true;
    await connection.query('INSERT IGNORE INTO zinc_stock (id) VALUES (1)');
    const [rows] = await connection.query('SELECT * FROM zinc_stock WHERE id = 1 FOR UPDATE');
    const [previous] = await connection.query('SELECT request_hash FROM zinc_stock_movements WHERE request_id = ?', [movement.request_id]);
    if (previous.length) {
      if (previous[0].request_hash !== hash) throw Object.assign(new Error('This request ID has already been used for a different stock movement.'), { status: 409 });
      await connection.commit();
      transaction = false;
      return res.json({ success: true, message: 'Stock movement already saved.', data: serializeStock(rows[0]) });
    }
    const next = applyMovement(rows[0], movement);
    const nextRate = movement.action === 'receive'
      ? movement.zincRatePerKg
      : rows[0].current_zinc_rate;
    await connection.query(`UPDATE zinc_stock SET initialized = 1, plant_kg = ?, kettle_kg = ?,
      kg_per_mm = ?, current_zinc_rate = ?, revision = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
    [next.plant_kg, next.kettle_kg, next.kg_per_mm, nextRate, next.revision]);
    await connection.query(`INSERT INTO zinc_stock_movements
      (request_id, request_hash, movement_type, amount_kg, zinc_rate_per_kg, plant_after_kg, kettle_after_kg, note, actor_user_id, batch_number, invoice_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [movement.request_id, hash, movement.action, (movement.amountGrams || 0) / 1000,
      movement.zincRatePerKg || null, next.plant_kg, next.kettle_kg, movement.note, req.user.id,
      movement.batch_number || null, movement.invoice_number || null]);
    await connection.commit();
    transaction = false;
    checkStockAlerts().catch(error => console.error('Stock alert check failed:', error));
    req.app.get('io')?.emit('zinc_stock_updated', {});
    const message = movement.action === 'transfer'
      ? 'Zinc transferred from plant to kettle.'
      : movement.action === 'adjust'
        ? 'Plant and kettle stock balances changed.'
        : 'Zinc stock saved.';
    return res.json({ success: true, message, data: serializeStock({ ...next, current_zinc_rate: nextRate }) });
  } catch (error) {
    if (transaction) await connection.rollback();
    return sendError(res, error);
  } finally { connection?.release(); }
};

module.exports = { getZincStock, getAverageZincRate, getRateCalculatorContext, getZincMovements, downloadZincMovementsPdf, saveZincMovement };
