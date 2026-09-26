const db = require('../config/db');
const { DateTime } = require('luxon');
const { ensureAutomaticShift, TIME_ZONE } = require('../services/automaticShiftService');
const { getCorrectionState, getProductionContext } = require('../services/productionShiftContextService');

const sendError = (res, error) => {
  if (!error.status) console.error('Shift correction:', error);
  return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Unable to change the production shift' });
};

const listPreviousShifts = async (req, res) => {
  try {
    const date = String(req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date).isValid) {
      return res.status(400).json({ success: false, message: 'Select a valid production date' });
    }
    await ensureAutomaticShift();
    const [rows] = await db.query(
      `SELECT s.id, s.shift_name, DATE_FORMAT(s.shift_date, '%Y-%m-%d') AS shift_date,
              (SELECT COUNT(*) FROM production_entries pe WHERE pe.shift_id = s.id
               AND COALESCE(pe.row_type, 'entry') = 'entry') AS entry_count
       FROM shifts s WHERE s.shift_date = ? AND s.status = 'closed'
       ORDER BY s.start_time, s.id`, [date],
    );
    return res.json({ success: true, data: rows });
  } catch (error) { return sendError(res, error); }
};

const changeCorrection = async (req, res, resume) => {
  let connection;
  try {
    const current = await ensureAutomaticShift();
    connection = await db.getConnection();
    await connection.beginTransaction();
    const state = await getCorrectionState(connection, true);
    if (req.body?.revision == null || Number(req.body.revision) !== Number(state.revision)) {
      throw Object.assign(new Error('Another manager changed the shift. Refresh and try again.'), { status: 409 });
    }
    if (resume) {
      await connection.query(
        `UPDATE production_shift_context SET correction_shift_id = NULL, correction_user_id = NULL, revision = revision + 1,
         resumed_by = ?, resumed_at = NOW() WHERE id = 1`, [req.user.id],
      );
    } else {
      const shiftId = Number(req.body?.shift_id);
      const targetUserId = Number(req.body?.user_id || req.user.id);
      if (!Number.isSafeInteger(shiftId) || shiftId < 1) {
        throw Object.assign(new Error('Select a previous shift'), { status: 400 });
      }
      if (!Number.isSafeInteger(targetUserId) || targetUserId < 1) throw Object.assign(new Error('Select the user who will correct this shift'), { status: 400 });
      if (req.body?.user_id != null) {
        const [users] = await connection.query("SELECT id FROM users WHERE id=? AND status='active' AND role IN ('supervisor','admin','plant_manager','superadmin')", [targetUserId]);
        if (!users.length) throw Object.assign(new Error('Select an active production user'), { status: 400 });
      }
      const [shifts] = await connection.query(
        `SELECT id FROM shifts WHERE id = ? AND status = 'closed' AND id <> ?
         AND start_time < ? FOR UPDATE`,
        [shiftId, current.id, DateTime.now().setZone(TIME_ZONE).toFormat('yyyy-MM-dd HH:mm:ss')],
      );
      if (!shifts.length) throw Object.assign(new Error('Only an ended shift can be opened for correction'), { status: 409 });
      await connection.query(
        `UPDATE production_shift_context SET correction_shift_id = ?, correction_user_id = ?, revision = revision + 1,
         opened_by = ?, opened_at = NOW(), resumed_by = NULL, resumed_at = NULL WHERE id = 1`,
        [shiftId, targetUserId, req.user.id],
      );
    }
    await connection.commit();
    req.app.get('io')?.emit('shift_updated', { action: resume ? 'correction_resumed' : 'correction_opened' });
    req.app.get('io')?.emit('production_updated', { action: 'shift_context_changed' });
    return res.json({ success: true, message: resume ? 'Correction closed and the selected user returned to live production' : 'Previous shift opened for the selected user' });
  } catch (error) {
    if (connection) await connection.rollback();
    return sendError(res, error);
  } finally { connection?.release(); }
};

const getCorrectionPlanningItems = async (req, res) => {
  try {
    const context = await getProductionContext(null, true, req.user.id);
    if (!context.correction) return res.json({ success: true, data: [] });
    const [items] = await db.query(
      `SELECT pp.id AS planning_id, ppi.id AS planning_item_id, ppi.item_id,
              COALESCE(ppi.challan_no, pp.challan_no) AS challan_no,
              COALESCE(ppi.party_name, pp.party_name, '') AS party_name,
              ppi.material_description, ppi.planned_qty, ppi.completed_qty,
              GREATEST(ppi.planned_qty - ppi.completed_qty, 0) AS remaining_qty,
              ppi.target_zinc_percentage, ppi.sequence_no
       FROM production_planning_items ppi
       JOIN production_planning pp ON pp.id = ppi.planning_id
       WHERE pp.deleted_at IS NULL AND pp.status <> 'canceled'
       ORDER BY pp.id DESC, ppi.sequence_no`,
    );
    return res.json({ success: true, data: items });
  } catch (error) { return sendError(res, error); }
};

module.exports = {
  listPreviousShifts, getCorrectionPlanningItems,
  openCorrection: (req, res) => changeCorrection(req, res, false),
  resumeCurrentShift: (req, res) => changeCorrection(req, res, true),
};
