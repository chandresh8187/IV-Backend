const crypto = require('crypto');
const db = require('../config/db');
const { normalizeMovement, applyMovement, serializeStock } = require('../services/zincStockService');
const { generateZincStockPdf } = require('../services/pdf/zincStockPdfGenerator');
const { hasPermission } = require('../services/permissionService');

const sendError = (res, error) => {
  if (!error.status) console.error('Zinc stock:', error);
  return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not complete the zinc stock request.' });
};

const readStock = async (queryable = db) => {
  const [rows] = await queryable.query('SELECT * FROM zinc_stock WHERE id = 1');
  return serializeStock(rows[0]);
};

const getZincStock = async (req, res) => {
  try { return res.json({ success: true, data: await readStock() }); }
  catch (error) { return sendError(res, error); }
};

const getAverageZincRate = async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT ROUND(AVG(zinc_rate_per_kg), 2) AS average_zinc_rate,
      COUNT(zinc_rate_per_kg) AS rate_count
      FROM zinc_stock_movements
      WHERE movement_type = 'receive' AND zinc_rate_per_kg IS NOT NULL AND zinc_rate_per_kg > 0`);
    return res.json({
      success: true,
      data: {
        average_zinc_rate: rows[0]?.average_zinc_rate == null ? null : Number(rows[0].average_zinc_rate),
        rate_count: Number(rows[0]?.rate_count || 0),
      },
    });
  } catch (error) { return sendError(res, error); }
};

const getZincMovements = async (req, res) => {
  try {
    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = (page - 1) * limit;
    const [rows] = await db.query(`SELECT m.id, m.movement_type, m.amount_kg, m.zinc_rate_per_kg,
      m.plant_after_kg, m.kettle_after_kg, m.note,
      m.production_entry_id,
      DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS created_at, u.name AS actor_name
      FROM zinc_stock_movements m LEFT JOIN users u ON u.id = m.actor_user_id
      ORDER BY m.id DESC LIMIT ? OFFSET ?`, [limit, offset]);
    return res.json({ success: true, data: rows, pagination: { page, limit, has_more: rows.length === limit } });
  } catch (error) { return sendError(res, error); }
};

const downloadZincMovementsPdf = async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT m.id, m.movement_type, m.amount_kg, m.zinc_rate_per_kg,
      m.plant_after_kg, m.kettle_after_kg, m.note, m.production_entry_id,
      DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
      u.name AS actor_name
      FROM zinc_stock_movements m LEFT JOIN users u ON u.id = m.actor_user_id
      ORDER BY m.id DESC`);
    const pdf = await generateZincStockPdf(rows);
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
      (request_id, request_hash, movement_type, amount_kg, zinc_rate_per_kg, plant_after_kg, kettle_after_kg, note, actor_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [movement.request_id, hash, movement.action, (movement.amountGrams || 0) / 1000,
      movement.zincRatePerKg || null, next.plant_kg, next.kettle_kg, movement.note, req.user.id]);
    await connection.commit();
    transaction = false;
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

module.exports = { getZincStock, getAverageZincRate, getZincMovements, downloadZincMovementsPdf, saveZincMovement };
