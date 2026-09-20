const db = require('../config/db');
const { DateTime } = require('luxon');
const { resolveRotation } = require('../services/contractorRotationService');

const loadRotations = async () => {
  const [rows] = await db.query(`SELECT r.id, DATE_FORMAT(r.effective_from, '%Y-%m-%d') AS effective_from,
    r.day_contractor_id, r.night_contractor_id, r.rotate_monthly, r.revision,
    d.name AS day_contractor_name, n.name AS night_contractor_name
    FROM contractor_rotations r
    LEFT JOIN contractors d ON d.id = r.day_contractor_id
    LEFT JOIN contractors n ON n.id = r.night_contractor_id
    ORDER BY r.effective_from DESC`);
  return rows;
};

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
    const rotations = await loadRotations();
    return res.json({ success: true, data: { contractors, assignments, rotations } });
  } catch (error) { return fail(res, error); }
};

// Settings only needs the master list, independently of shift/rotation tables.
const listContractorDirectory = async (req, res) => {
  try {
    const [contractors] = await db.query('SELECT id, name FROM contractors ORDER BY name, id');
    return res.json({ success: true, data: contractors });
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

const updateContractor = async (req, res) => {
  const id = Number(req.params.id);
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ') : '';
  if (!positiveId(id) || !name || name.length > 120) return res.status(400).json({ success: false, message: 'Enter a valid contractor name (1–120 characters).' });
  try {
    const [result] = await db.query('UPDATE contractors SET name = ? WHERE id = ?', [name, id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Contractor not found.' });
    emitChange(req);
    return res.json({ success: true, message: 'Contractor updated successfully' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ success: false, message: 'This contractor name already exists.' });
    return fail(res, error);
  }
};

const deleteContractor = async (req, res) => {
  const id = Number(req.params.id);
  if (!positiveId(id)) return res.status(400).json({ success: false, message: 'Invalid contractor.' });
  try {
    // Foreign keys restrict deletion of linked production/shift assignments;
    // saved personal defaults alone are cleared via ON DELETE SET NULL.
    const [result] = await db.query('DELETE FROM contractors WHERE id = ?', [id]);
    if (!result.affectedRows) return res.status(404).json({ success: false, message: 'Contractor not found.' });
    emitChange(req);
    return res.json({ success: true, message: 'Contractor deleted successfully' });
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') return res.status(409).json({ success: false, message: 'This contractor is linked to production or shift assignments and cannot be deleted. You can edit its name.' });
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

const saveRotation = async (req, res) => {
  const { effective_from, day_contractor_id, night_contractor_id, rotate_monthly, expected_revision } = req.body || {};
  if (!validDate(effective_from) || typeof rotate_monthly !== 'boolean' ||
      ![day_contractor_id, night_contractor_id].every(id => id === null || positiveId(id)) ||
      !(expected_revision === null || positiveId(expected_revision)) ||
      (day_contractor_id !== null && day_contractor_id === night_contractor_id)) {
    return res.status(400).json({ success: false, message: 'Select different contractors for Day and Night, an effective date and rotation mode.' });
  }
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    for (const id of [day_contractor_id, night_contractor_id].filter(id => id !== null)) {
      const [rows] = await connection.query('SELECT id FROM contractors WHERE id = ?', [id]);
      if (!rows.length) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'Contractor not found. Refresh the list.' });
      }
    }
    const [rows] = await connection.query('SELECT id, revision FROM contractor_rotations WHERE effective_from = ? FOR UPDATE', [effective_from]);
    const row = rows[0];
    if ((row ? Number(row.revision) : null) !== expected_revision) {
      await connection.rollback();
      return res.status(409).json({ success: false, message: 'This schedule changed on another device. Refresh and try again.' });
    }
    if (row) {
      await connection.query(`UPDATE contractor_rotations SET day_contractor_id = ?, night_contractor_id = ?,
        rotate_monthly = ?, revision = revision + 1, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [day_contractor_id, night_contractor_id, Number(rotate_monthly), req.user.id, row.id]);
    } else {
      await connection.query(`INSERT INTO contractor_rotations
        (effective_from, day_contractor_id, night_contractor_id, rotate_monthly, updated_by) VALUES (?, ?, ?, ?, ?)`,
      [effective_from, day_contractor_id, night_contractor_id, Number(rotate_monthly), req.user.id]);
    }
    await connection.commit();
    emitChange(req);
    return res.json({ success: true, message: 'Contractor shift schedule saved.' });
  } catch (error) {
    if (connection) await connection.rollback();
    if (['ER_DUP_ENTRY', 'ER_LOCK_DEADLOCK'].includes(error.code)) return res.status(409).json({ success: false, message: 'The schedule changed. Refresh and try again.' });
    return fail(res, error);
  } finally { connection?.release(); }
};

const getContractorReport = async (req, res) => {
  const year = req.financialYear;
  const month = req.query.month;
  if (month !== undefined && (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month) || !validDate(`${month}-01`))) {
    return res.status(400).json({ success: false, message: 'Select a valid report month.' });
  }
  const from = month ? `${month}-01` : req.query.from || year.start_date;
  const to = month ? DateTime.fromISO(from).endOf('month').toISODate() : req.query.to || year.end_date;
  if (!validDate(from) || !validDate(to) || from > to || (!month && (from < year.start_date || to > year.end_date))) {
    return res.status(400).json({ success: false, message: `Select a date range within ${year.start_date} and ${year.end_date}.` });
  }
  try {
    // Resolve the assignment using the production shift date, not save time or current correction mode.
    // The most recent effective rule applies until the next rule for that shift.
    // Existing production and newly created assignment tables can have different
    // default collations. Normalize this cross-table text comparison explicitly.
    const [rows] = await db.query(`SELECT DATE_FORMAT(pe.shift_date, '%Y-%m-%d') AS shift_date,
      LOWER(pe.shift_name) AS shift_name, a.contractor_id, c.name AS contractor_name,
      pe.contractor_id AS selected_contractor_id, selected_contractor.name AS selected_contractor_name,
      DATE_FORMAT(a.effective_from, '%Y-%m-%d') AS effective_from,
      COUNT(*) AS entry_count, COALESCE(SUM(pe.dipping_qty), 0) AS qty,
      COALESCE(SUM(COALESCE(pe.ms_weight, 0) * COALESCE(pe.dipping_qty, 0)), 0) AS ms_kg,
      COALESCE(SUM(COALESCE(pe.gi_weight, 0) * COALESCE(pe.dipping_qty, 0)), 0) AS gi_kg
      FROM production_entries pe
      LEFT JOIN contractors selected_contractor ON selected_contractor.id = pe.contractor_id
      LEFT JOIN contractor_shift_assignments a ON a.id = (
        SELECT rule.id FROM contractor_shift_assignments rule
        WHERE CONVERT(rule.shift_name USING utf8mb4) COLLATE utf8mb4_unicode_ci
          = CONVERT(LOWER(pe.shift_name) USING utf8mb4) COLLATE utf8mb4_unicode_ci
          AND rule.effective_from <= pe.shift_date
        ORDER BY rule.effective_from DESC LIMIT 1
      )
      LEFT JOIN contractors c ON c.id = a.contractor_id
      WHERE pe.shift_date BETWEEN ? AND ? AND COALESCE(pe.row_type, 'entry') = 'entry'
      GROUP BY pe.shift_date, LOWER(pe.shift_name), a.contractor_id, c.name, a.effective_from, pe.contractor_id, selected_contractor.name
      ORDER BY pe.shift_date DESC, shift_name ASC`, [from, to]);
    const rotations = await loadRotations();
    const attributed = rows.map(row => ({ ...row, ...(row.selected_contractor_id != null
      ? { contractor_id: row.selected_contractor_id, contractor_name: row.selected_contractor_name }
      : resolveRotation(rotations, row.shift_name, row.shift_date, row)),
      entry_count: Number(row.entry_count), qty: Number(row.qty), ms_kg: Number(row.ms_kg), gi_kg: Number(row.gi_kg) }));
    const grouped = new Map();
    for (const row of attributed) {
      const key = `${row.shift_date}:${row.shift_name}:${row.contractor_id ?? 'unassigned'}`;
      if (!grouped.has(key)) grouped.set(key, { ...row, entry_count: 0, qty: 0, ms_kg: 0, gi_kg: 0 });
      for (const field of ['entry_count', 'qty', 'ms_kg', 'gi_kg']) grouped.get(key)[field] += row[field];
    }
    const shifts = [...grouped.values()];
    shifts.forEach(row => { row.contractor_name = row.contractor_name || 'Unassigned'; });
    const summaries = buildSummary(shifts);
    const [contractors] = await db.query('SELECT id, name FROM contractors ORDER BY name, id');
    for (const contractor of contractors) {
      if (!summaries.some(row => Number(row.contractor_id) === Number(contractor.id))) {
        summaries.push({ contractor_id: contractor.id, contractor_name: contractor.name, shift_count: 0, entry_count: 0, qty: 0, ms_kg: 0, gi_kg: 0 });
      }
    }
    return res.json({ success: true, data: { from, to, month: month || null, financial_year: year.financial_year, summaries, shifts } });
  } catch (error) { return fail(res, error); }
};

module.exports = { listContractors, listContractorDirectory, createContractor, updateContractor, deleteContractor, saveAssignment, saveRotation, getContractorReport, buildSummary, validDate };
