const db = require('../config/db');
const { ensureAutomaticShift } = require('./automaticShiftService');

const conflict = (message) => Object.assign(new Error(message), {
  status: 409, code: 'PRODUCTION_SHIFT_CHANGED',
});

const getCorrectionState = async (executor = db, lock = false) => {
  const [rows] = await executor.query(
    `SELECT * FROM production_shift_context WHERE id = 1${lock ? ' FOR UPDATE' : ''}`,
  );
  if (!rows.length) throw new Error('Production shift context is not initialized. Run migrations.');
  return rows[0];
};

const canUseShiftCorrection = user => ['superadmin', 'plant_manager', 'supervisor'].includes(String(user?.role || '').trim().toLowerCase());

const getProductionContext = async (currentShift = null, allowCorrection = true, userId = null) => {
  const current = currentShift || await ensureAutomaticShift();
  const state = await getCorrectionState();
  if (!allowCorrection && state.correction_user_id == null) return {
    state: { revision: 0, correction_shift_id: null, opened_by: null, opened_at: null },
    shift: current, correction: false, ignoreCorrection: true,
  };
  if (!state.correction_shift_id || (state.correction_user_id != null && userId != null && Number(state.correction_user_id) !== Number(userId))) return { state, shift: current, correction: false };
  const [rows] = await db.query(
    `SELECT *, DATE_FORMAT(shift_date, '%Y-%m-%d') AS shift_date
     FROM shifts WHERE id = ? AND status = 'closed'`, [state.correction_shift_id],
  );
  // Never silently redirect a correction to today's shift.
  if (!rows.length) throw conflict('The correction shift is unavailable. A manager must resume the current shift.');
  return { state, shift: rows[0], correction: true };
};

const assertContext = (body, context) => {
  if ((context.correction && body.shift_id == null) ||
      (body.shift_id != null && Number(body.shift_id) !== Number(context.shift.id)) ||
      (context.correction && body.shift_revision == null) ||
      (body.shift_revision != null && Number(body.shift_revision) !== Number(context.state.revision))) {
    throw conflict('The production shift changed. Refresh Live Production and reopen the entry before saving.');
  }
};

// Serialize saves with manager selection/resume. Call inside the save transaction.
const lockProductionContext = async (executor, context, body) => {
  const state = await getCorrectionState(executor, true);
  if (!context.ignoreCorrection && (Number(state.revision) !== Number(context.state.revision) ||
      Number(state.correction_shift_id) !== Number(context.state.correction_shift_id))) {
    throw conflict('A manager changed the production shift. Reopen the entry and try again.');
  }
  assertContext(body, context);
  const [rows] = await executor.query('SELECT id, status FROM shifts WHERE id = ? FOR UPDATE', [context.shift.id]);
  if (!rows.length || rows[0].status !== (context.correction ? 'closed' : 'active')) {
    throw conflict('The shift has ended or changed. Refresh Live Production before saving.');
  }
};

module.exports = { canUseShiftCorrection, getCorrectionState, getProductionContext, assertContext, lockProductionContext };
