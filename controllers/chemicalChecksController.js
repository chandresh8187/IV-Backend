const db = require('../config/db');
const { DateTime } = require('luxon');
const { generateChemicalChecksPdf } = require('../services/pdf/chemicalChecksPdfGenerator');

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const sendError = (res, error) => res.status(error.status || 500).json({
  success: false,
  message: error.status ? error.message : 'Could not complete the chemical tracking request.',
});
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value).isValid;
const selectSql = `SELECT c.id, DATE_FORMAT(c.inspection_date, '%Y-%m-%d') inspection_date,
  c.flux_ph, c.flux_density, c.flux_temperature_c, c.acid_ph, c.acid_density, c.note,
  DATE_FORMAT(c.created_at, '%Y-%m-%d %H:%i:%s') created_at,
  COALESCE(u.name, 'Deleted user') checked_by_name
  FROM chemical_checks c LEFT JOIN users u ON u.id = c.checked_by_user_id`;

const parseReading = (value, label) => {
  if (value == null || String(value).trim() === '') throw fail(`${label} is required.`);
  const valid = typeof value === 'number' || (typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()));
  const number = Number(value);
  if (!valid || !Number.isFinite(number)) throw fail(`${label} must be a valid number.`);
  return number;
};

const getRange = query => {
  if (query.month) {
    if (!/^\d{4}-\d{2}$/.test(query.month)) throw fail('Month must use YYYY-MM format.');
    const start = DateTime.fromISO(`${query.month}-01`);
    if (!start.isValid) throw fail('Select a valid month.');
    return { start: start.toISODate(), end: start.endOf('month').toISODate(), label: start.toFormat('LLLL yyyy') };
  }
  if (query.start_date || query.end_date) {
    if (!validDate(query.start_date) || !validDate(query.end_date)) throw fail('Select a valid start and end date.');
    if (query.start_date > query.end_date) throw fail('Start date cannot be after end date.');
    return { start: query.start_date, end: query.end_date, label: `${query.start_date} to ${query.end_date}` };
  }
  const now = DateTime.now().setZone('Asia/Kolkata');
  return { start: now.startOf('month').toISODate(), end: now.endOf('month').toISODate(), label: now.toFormat('LLLL yyyy') };
};

const saveChemicalCheck = async (req, res, editing = false) => {
  try {
    const id = Number(req.params?.id);
    if (editing && (!Number.isSafeInteger(id) || id < 1)) throw fail('Select a valid chemical check.');
    const inspectionDate = req.body?.inspection_date || DateTime.now().setZone('Asia/Kolkata').toISODate();
    if (!validDate(inspectionDate)) throw fail('Select a valid inspection date.');
    const fluxPh = parseReading(req.body?.flux_ph, 'Flux pH');
    const acidPh = parseReading(req.body?.acid_ph, 'Acid pH');
    const fluxDensity = parseReading(req.body?.flux_density, 'Flux density');
    const fluxTemperature = parseReading(req.body?.flux_temperature_c, 'Flux temperature');
    const acidDensity = parseReading(req.body?.acid_density, 'Acid density');
    const note = String(req.body?.note || '').trim();
    if (note.length > 255) throw fail('Note must be 255 characters or fewer.');
    const values = [inspectionDate, fluxPh, fluxDensity, fluxTemperature, acidPh, acidDensity, note || null];
    if (editing) {
      const [rows] = await db.query('SELECT id FROM chemical_checks WHERE id = ?', [id]);
      if (!rows.length) throw fail('Chemical check not found.', 404);
      await db.query(`UPDATE chemical_checks SET inspection_date = ?, flux_ph = ?, flux_density = ?,
        flux_temperature_c = ?, acid_ph = ?, acid_density = ?, note = ? WHERE id = ?`, [...values, id]);
      const [saved] = await db.query(`${selectSql} WHERE c.id = ?`, [id]);
      req.app.get('io')?.emit('chemical_checks_updated', { id, action: 'updated' });
      return res.json({ success: true, message: 'Chemical check updated.', data: saved[0] });
    }
    const [result] = await db.query(`INSERT INTO chemical_checks
      (inspection_date, flux_ph, flux_density, flux_temperature_c, acid_ph, acid_density, note, checked_by_user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [inspectionDate, fluxPh, fluxDensity, fluxTemperature, acidPh, acidDensity, note || null, req.user.id]);
    req.app.get('io')?.emit('chemical_checks_updated', { id: result.insertId });
    return res.status(201).json({ success: true, message: 'Chemical check saved.', data: { id: result.insertId } });
  } catch (error) { return sendError(res, error); }
};

const getChemicalChecks = async (req, res) => {
  try {
    const range = getRange(req.query);
    const [rows] = await db.query(`${selectSql} WHERE c.inspection_date BETWEEN ? AND ? ORDER BY c.inspection_date DESC, c.id DESC`, [range.start, range.end]);
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ success: true, data: rows, period: range });
  } catch (error) { return sendError(res, error); }
};

const downloadChemicalChecksPdf = async (req, res) => {
  try {
    const range = getRange(req.query);
    const [rows] = await db.query(`${selectSql} WHERE c.inspection_date BETWEEN ? AND ? ORDER BY c.inspection_date DESC, c.id DESC`, [range.start, range.end]);
    const pdf = await generateChemicalChecksPdf(rows, range.label);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Content-Disposition', `inline; filename="chemical-checks-${range.start}-${range.end}.pdf"`);
    return res.end(pdf);
  } catch (error) { return sendError(res, error); }
};

const createChemicalCheck = (req, res) => saveChemicalCheck(req, res);
const updateChemicalCheck = (req, res) => saveChemicalCheck(req, res, true);

module.exports = { createChemicalCheck, updateChemicalCheck, getChemicalChecks, downloadChemicalChecksPdf };
