const db = require('../config/db');
const { DateTime } = require('luxon');

const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value).isValid;
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const emitChange = req => req.app.get('io')?.emit('contractors_updated', {});
const fail = (res, error) => {
  console.error('Contractor request failed:', error);
  return res.status(500).json({ success: false, message: 'Could not complete the contractor request.' });
};

const listContractors = async (req, res) => {
  try {
    const [contractors] = await db.query('SELECT id, name FROM contractors ORDER BY name, id');
    const [assignments] = await db.query(`SELECT a.id, a.shift_name,
      DATE_FORMAT(a.effective_from, '%Y-%m-%d') AS effective_from, a.contractor_id, c.name AS contractor_name
      FROM contractor_shift_assignments a LEFT JOIN contractors c ON c.id = a.contractor_id
      ORDER BY a.effective_from DESC, a.id DESC`);
    return res.json({ success: true, data: { contractors, assignments } });
  } catch (error) { return fail(res, error); }
};

const createContractor = async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 120) return res.status(400).json({ success: false, message: 'Enter a contractor name (1–120 characters).' });
  try {
    const [result] = await db.query('INSERT INTO contractors (name) VALUES (?)', [name]);
    emitChange(req);
    return res.status(201).json({ success: true, data: { id: result.insertId, name } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'This contractor name already exists.' });
    return fail(res, error);
  }
};

const saveAssignment = async (req, res) => {
  const { shift_name, effective_from, contractor_id, expected_id, expected_contractor_id } = req.body || {};
  if (!['day', 'night'].includes(shift_name) || !validDate(effective_from) ||
      !(contractor_id === null || positiveId(contractor_id)) ||
      !(expected_id === null || positiveId(expected_id)) ||
      !(expected_contractor_id === null || positiveId(expected_contractor_id))) {
    return res.status(400).json({ success: false, message: 'Select a valid shift, effective date and contractor.' });
  }
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    if (contractor_id !== null) {
      const [contractors] = await connection.query('SELECT id FROM contractors WHERE id = ?', [contractor_id]);
      if (!contractors.length) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'Contractor not found. Refresh the list.' });
      }
    }
    const [rows] = await connection.query(`SELECT id, contractor_id FROM contractor_shift_assignments
      WHERE shift_name = ? AND effective_from = ? FOR UPDATE`, [shift_name, effective_from]);
    const row = rows[0];
    if ((row ? Number(row.id) : null) !== expected_id ||
        (row?.contractor_id == null ? null : Number(row.contractor_id)) !== expected_contractor_id) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'This assignment changed on another device. Refresh and try again.' });
    }
    if (row) {
      await connection.query(`UPDATE contractor_shift_assignments SET contractor_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [contractor_id, req.user.id, row.id]);
    } else {
      await connection.query(`INSERT INTO contractor_shift_assignments (shift_name, effective_from, contractor_id, updated_by) VALUES (?, ?, ?, ?)`, [shift_name, effective_from, contractor_id, req.user.id]);
    }
    await connection.commit();
    emitChange(req);
    return res.json({ success: true, message: 'Repeating shift assignment saved.' });
  } catch (error) {
    if (connection) await connection.rollback();
    if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK'].includes(error.code)) return res.status(409).json({ success: false, message: 'The assignment changed. Refresh and try again.' });
    return fail(res, error);
  } finally { connection?.release(); }
};

const buildSummary = rows => {
  const summaries = new Map();
  for (const row of rows) {
    const key = row.contractor_id == null ? 'unassigned' : String(row.contractor_id);
    const item = summaries.get(key) || { contractor_id: row.contractor_id, contractor_name: row.contractor_name || 'Unassigned', shift_count: 0, entry_count: 0, qty: 0, ms_kg: 0, gi_kg: 0 };
    item.shift_count += 1;
    for (const field of ['entry_count', 'qty', 'ms_kg', 'gi_kg']) item[field] += Number(row[field]) || 0;
    summaries.set(key, item);
  }
  return [...summaries.values()];
};

const getContractorReport = async (req, res) => {
  const year = req.financialYear;
  const from = req.query.from || year.start_date;
  const to = req.query.to || year.end_date;
  if (!validDate(from) || !validDate(to) || from > to || from < year.start_date || to > year.end_date) {
    return res.status(400).json({ success: false, message: `Select a date range within ${year.start_date} and ${year.end_date}.` });
  }
  try {
    // Resolve the assignment using the production shift date, not save time or current correction mode.
    // The most recent effective rule applies until the next rule for that shift.
    // Existing production and newly created assignment tables can have different
    // default collations. Normalize this cross-table text comparison explicitly.
    const [rows] = await db.query(`SELECT DATE_FORMAT(pe.shift_date, '%Y-%m-%d') AS shift_date,
      LOWER(pe.shift_name) AS shift_name, a.contractor_id, c.name AS contractor_name,
      COUNT(*) AS entry_count, COALESCE(SUM(pe.dipping_qty), 0) AS qty,
      COALESCE(SUM(COALESCE(pe.ms_weight, 0) * COALESCE(pe.dipping_qty, 0)), 0) AS ms_kg,
      COALESCE(SUM(COALESCE(pe.gi_weight, 0) * COALESCE(pe.dipping_qty, 0)), 0) AS gi_kg
      FROM production_entries pe
      LEFT JOIN contractor_shift_assignments a ON a.id = (
        SELECT rule.id FROM contractor_shift_assignments rule
        WHERE CONVERT(rule.shift_name USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(LOWER(pe.shift_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci
          AND rule.effective_from <= pe.shift_date
        ORDER BY rule.effective_from DESC LIMIT 1
      )
      LEFT JOIN contractors c ON c.id = a.contractor_id
      WHERE pe.shift_date BETWEEN ? AND ? AND COALESCE(pe.row_type, 'entry') = 'entry'
      GROUP BY pe.shift_date, LOWER(pe.shift_name), a.contractor_id, c.name
      ORDER BY pe.shift_date DESC, shift_name ASC`, [from, to]);
    const shifts = rows.map(row => ({ ...row, contractor_name: row.contractor_name || 'Unassigned',
      entry_count: Number(row.entry_count), qty: Number(row.qty), ms_kg: Number(row.ms_kg), gi_kg: Number(row.gi_kg) }));
    return res.json({ success: true, data: { from, to, financial_year: year.financial_year, summaries: buildSummary(shifts), shifts } });
  } catch (error) { return fail(res, error); }
};

module.exports = { listContractors, createContractor, saveAssignment, getContractorReport, buildSummary, validDate };
