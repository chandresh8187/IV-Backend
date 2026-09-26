const db = require('../config/db');

const fail = (res, error) => res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not complete the labour weight request.' });
const bad = message => Object.assign(new Error(message), { status: 400 });

const fetchEntries = async pendingOnly => {
  const [rows] = await db.query(`SELECT e.id, e.ms_weight, e.dipping_qty, e.status,
    DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i:%s') created_at, u.name labour_name
    FROM labour_weight_entries e JOIN users u ON u.id=e.labour_user_id
    ${pendingOnly ? "WHERE e.status='pending'" : ''} ORDER BY e.id ASC`);
  return rows;
};

const list = async (req, res) => {
  try {
    const pendingOnly = req.query.pending === '1';
    const rows = await fetchEntries(pendingOnly);
    return res.json({ success: true, data: rows });
  } catch (error) { return fail(res, error); }
};

const listPending = async (req, res) => {
  try {
    const rows = await fetchEntries(true);
    return res.json({ success: true, data: rows });
  } catch (error) { return fail(res, error); }
};

const create = async (req, res) => {
  try {
    const ms = Number(req.body.ms_weight); const qty = Number(req.body.dipping_qty);
    if (!Number.isFinite(ms) || ms <= 0) throw bad('MS weight must be greater than zero.');
    if (!Number.isInteger(qty) || qty <= 0) throw bad('Dip quantity must be a whole number greater than zero.');
    const [result] = await db.query('INSERT INTO labour_weight_entries (labour_user_id, ms_weight, dipping_qty) VALUES (?, ?, ?)', [req.user.id, ms, qty]);
    req.app.get('io')?.emit('labour_weights_updated');
    return res.status(201).json({ success: true, message: 'Weight entry added.', data: { id: result.insertId } });
  } catch (error) { return fail(res, error); }
};

const update = async (req, res) => {
  try {
    const id = Number(req.params.id); const ms = Number(req.body.ms_weight); const qty = Number(req.body.dipping_qty);
    if (!Number.isInteger(id) || id < 1 || !Number.isFinite(ms) || ms <= 0 || !Number.isInteger(qty) || qty <= 0) throw bad('Enter valid MS weight and dip quantity.');
    const [result] = await db.query("UPDATE labour_weight_entries SET ms_weight=?, dipping_qty=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'", [ms, qty, id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Pending entry not found.' });
    req.app.get('io')?.emit('labour_weights_updated');
    return res.json({ success: true, message: 'Weight entry updated.' });
  } catch (error) { return fail(res, error); }
};

const consume = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [result] = await db.query("UPDATE labour_weight_entries SET status='used' WHERE id=? AND status='pending'", [id]);
    if (!result.affectedRows) return res.status(409).json({ success: false, message: 'This labour entry was already used.' });
    req.app.get('io')?.emit('labour_weights_updated');
    return res.json({ success: true });
  } catch (error) { return fail(res, error); }
};

module.exports = { list, listPending, create, update, consume };
