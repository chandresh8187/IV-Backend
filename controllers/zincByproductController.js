const { editByproduct, byproductVersion } = require('../services/zincByproductEditService');
const db = require('../config/db');
const { DateTime } = require('luxon');
const { calculateByproductRecovery } = require('../services/zincByproductService');
const { generateZincByproductPdf } = require('../services/pdf/zincByproductPdfGenerator');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sendError = (res, error) => res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not complete the ash and dross request.' });
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value).isValid;
const selectSql = `SELECT t.*, DATE_FORMAT(t.transaction_date, '%Y-%m-%d') transaction_date,
  DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') created_at, u.name actor_name
  FROM zinc_byproduct_transactions t LEFT JOIN users u ON u.id=t.actor_user_id`;

const createByproduct = async (req, res) => {
  let connection;
  try {
    const date = req.body?.transaction_date || DateTime.now().setZone('Asia/Kolkata').toISODate();
    if (!validDate(date)) throw fail('Select a valid transaction date.');
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [stockRows] = await connection.query('SELECT current_zinc_rate FROM zinc_stock WHERE id=1 FOR UPDATE');
    const zincRate = Number(stockRows[0]?.current_zinc_rate);
    if (!zincRate) throw fail('Set the current zinc rate before recording ash or dross.', 409);
    const values = calculateByproductRecovery({ ...req.body, zinc_rate: zincRate });
    const note = String(req.body?.note || '').trim();
    if (note.length > 255) throw fail('Note must be 255 characters or fewer.');
    const [result] = await connection.query(`INSERT INTO zinc_byproduct_transactions
      (transaction_date, ash_weight_kg, ash_rate, ash_base_amount, ash_gst_amount,
       dross_weight_kg, dross_rate, dross_base_amount, dross_gst_amount,
       total_with_gst, zinc_rate_snapshot, recovered_zinc_kg, note, actor_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [date, values.ash_weight_kg, values.ash_rate, values.ash_base_amount, values.ash_gst_amount,
      values.dross_weight_kg, values.dross_rate, values.dross_base_amount, values.dross_gst_amount,
      values.total_with_gst, values.zinc_rate_snapshot, values.recovered_zinc_kg, note, req.user.id]);
    await connection.query(`INSERT INTO zinc_recovery_purchase_links (byproduct_id, purchase_id)
      SELECT ?, id FROM zinc_purchases WHERE zinc_rate_per_kg=?
      ORDER BY transaction_date DESC, COALESCE(transaction_time, '00:00:00') DESC, movement_id DESC LIMIT 1`, [result.insertId, zincRate]);
    await connection.commit();
    req.app.get('io')?.emit('zinc_byproduct_updated', { id: result.insertId });
    req.app.get('io')?.emit('dashboard_updated', {});
    return res.status(201).json({ success: true, message: 'Ash and dross recovery saved.', data: { id: result.insertId, transaction_date: date, ...values, note } });
  } catch (error) { if (connection) await connection.rollback(); return sendError(res, error); }
  finally { connection?.release(); }
};

const getByproducts = async (req, res) => {
  try {
    const month = req.query.month;
    if (month && !/^\d{4}-\d{2}$/.test(month)) throw fail('Month must use YYYY-MM format.');
    const params = month ? [`${month}-01`, DateTime.fromISO(`${month}-01`).endOf('month').toISODate()] : [];
    const [rows] = await db.query(`${selectSql} ${month ? 'WHERE t.transaction_date BETWEEN ? AND ?' : ''} ORDER BY t.transaction_date DESC, t.id DESC`, params);
    const summary = rows.reduce((total, row) => ({
      ash_weight_kg: total.ash_weight_kg + Number(row.ash_weight_kg),
      dross_weight_kg: total.dross_weight_kg + Number(row.dross_weight_kg),
      total_with_gst: total.total_with_gst + Number(row.total_with_gst),
      recovered_zinc_kg: total.recovered_zinc_kg + Number(row.recovered_zinc_kg),
    }), { ash_weight_kg: 0, dross_weight_kg: 0, total_with_gst: 0, recovered_zinc_kg: 0 });
    return res.json({ success: true, data: rows.map(row => ({ ...row, edit_version: byproductVersion(row) })), summary });
  } catch (error) { return sendError(res, error); }
};

const downloadByproductsPdf = async (req, res) => {
  try {
    const month = req.query.month;
    if (month && (!/^\d{4}-\d{2}$/.test(month) || !DateTime.fromISO(`${month}-01`).isValid)) throw fail('Month must use YYYY-MM format.');
    const params = month ? [`${month}-01`, DateTime.fromISO(`${month}-01`).endOf('month').toISODate()] : [];
    const [rows] = await db.query(`${selectSql} ${month ? 'WHERE t.transaction_date BETWEEN ? AND ?' : ''} ORDER BY t.transaction_date DESC, t.id DESC`, params);
    const pdf = await generateZincByproductPdf(rows);
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Length', pdf.length);
    res.setHeader('Content-Disposition', 'inline; filename="ash-dross-report.pdf"');
    return res.end(pdf);
  } catch (error) { return sendError(res, error); }
};

const updateByproduct = async (req, res) => {
  let connection;
  try {
    connection = await db.getConnection(); await connection.beginTransaction();
    const data = await editByproduct(connection, { id: Number(req.params.id), body: req.body, actorId: req.user.id });
    await connection.commit();
    for (const event of ['zinc_byproduct_updated', 'monthly_report_updated', 'expense_report_updated', 'dashboard_updated']) req.app.get('io')?.emit(event, { id: data.id });
    return res.json({ success: true, message: 'Ash and dross collection updated.', data });
  } catch (error) { if (connection) await connection.rollback(); return sendError(res, error); }
  finally { connection?.release(); }
};
module.exports = { updateByproduct, createByproduct, getByproducts, downloadByproductsPdf };
