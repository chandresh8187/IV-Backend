const db = require('../config/db');
const { calculateProductionZincKg, applyProductionZinc } = require('../services/productionZincStockService');
const { recalculatePlanningProgress } = require('../services/productionPlanningFlowService');
const { refreshProductionCost } = require('../services/productionCostService');
const { DateTime } = require('luxon');
const { hasPermission } = require('../services/permissionService');
const { getSetting } = require('../services/appSettingsService');
const { DEFAULT_LIMIT_SECONDS, effectiveStartMs, finishTimer, expireDueTimers } = require('../services/labourTimerService');

const fail = (res, error) => res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'Could not complete the labour weight request.' });
const bad = message => Object.assign(new Error(message), { status: 400 });
const timerColumns = {
  pickling: ['pickling_started_at', 'pickling_duration_seconds', 'pickling_client_started_at_ms'],
  flux: ['flux_started_at', 'flux_duration_seconds', 'flux_client_started_at_ms'],
  hot_drier: ['hot_drier_started_at', 'hot_drier_duration_seconds', 'hot_drier_client_started_at_ms'],
  zinc_kettle: ['zinc_kettle_started_at', 'zinc_kettle_duration_seconds', 'zinc_kettle_client_started_at_ms'],
};

const fetchEntries = async (pendingOnly, todayOnly = false) => {
  const today = DateTime.now().setZone('Asia/Kolkata').toISODate();
  const conditions = [
    ...(pendingOnly ? ["e.status='pending'"] : []),
    ...(todayOnly ? ['e.created_at >= ? AND e.created_at < ?'] : []),
  ];
  const params = todayOnly ? [today, DateTime.fromISO(today).plus({ days: 1 }).toISODate()] : [];
  const [rows] = await db.query(`SELECT e.id, e.labour_user_id, e.ms_weight, e.dipping_qty, e.consumed_qty,
    e.pickling_started_at, e.pickling_duration_seconds, e.pickling_client_started_at_ms,
    e.flux_started_at, e.flux_duration_seconds, e.flux_client_started_at_ms,
    e.hot_drier_started_at, e.hot_drier_duration_seconds, e.hot_drier_client_started_at_ms,
    e.zinc_kettle_started_at, e.zinc_kettle_duration_seconds, e.zinc_kettle_client_started_at_ms,
    e.pickling_limit_seconds, e.flux_limit_seconds, e.hot_drier_limit_seconds, e.zinc_kettle_limit_seconds,
    GREATEST(e.dipping_qty - e.consumed_qty, 0) AS remaining_qty, e.status, e.production_entry_id,
    p.item_id AS locked_item_id, p.material AS locked_material,
    DATE_FORMAT(e.created_at, '%Y-%m-%d %H:%i:%s') created_at, u.name labour_name
    FROM labour_weight_entries e JOIN users u ON u.id=e.labour_user_id
    LEFT JOIN production_entries p ON p.id=e.production_entry_id
    ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY e.id ASC`, params);
  return rows;
};

const list = async (req, res) => {
  try {
    await expireDueTimers(req.app.get('io'));
    const pendingOnly = req.query.pending === '1';
    const rows = await fetchEntries(pendingOnly, true);
    const permitted = await hasPermission({ userId: req.user.id, role: req.user.role, permissionKey: 'labour_weights.timer' });
    return res.json({ success: true, data: rows.map(row => ({
      ...row,
      can_run_timer: permitted && (req.user.role !== 'labour' || Number(row.labour_user_id) === Number(req.user.id)),
    })) });
  } catch (error) { return fail(res, error); }
};

const listPending = async (req, res) => {
  try {
    await expireDueTimers(req.app.get('io'));
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
  let connection;
  try {
    const id = Number(req.params.id); const ms = Number(req.body.ms_weight); const qty = Number(req.body.dipping_qty);
    if (!Number.isInteger(id) || id < 1 || !Number.isFinite(ms) || ms <= 0 || !Number.isInteger(qty) || qty <= 0) throw bad('Enter valid MS weight and dip quantity.');
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [entries] = await connection.query('SELECT * FROM labour_weight_entries WHERE id = ? FOR UPDATE', [id]);
    const entry = entries[0];
    if (!entry) throw Object.assign(new Error('Labour weight entry not found.'), { status: 404 });
    const role = String(req.user?.role || '').toLowerCase();
    if (entry.status === 'used' && !['supervisor', 'superadmin'].includes(role)) {
      throw Object.assign(new Error('Only a supervisor or superadmin can edit a used weight.'), { status: 403 });
    }
    if (entry.status === 'pending' && qty < Number(entry.consumed_qty)) throw Object.assign(new Error(`At least ${entry.consumed_qty} NOS were already assigned to production.`), { status: 409 });
    if (Number(entry.consumed_qty) > 0 && entry.status === 'pending' && ms !== Number(entry.ms_weight)) {
      throw Object.assign(new Error('Finish assigning the remaining quantity before changing its MS weight.'), { status: 409 });
    }
    let productionId = entry.production_entry_id;
    if (entry.status === 'used' && !productionId) {
      const [matches] = await connection.query(`SELECT p.id FROM production_entries p
        LEFT JOIN labour_weight_entries linked ON linked.production_entry_id = p.id
        WHERE linked.id IS NULL AND p.ms_weight = ? AND p.dipping_qty = ?
          AND p.created_at >= ? AND COALESCE(p.row_type, 'entry') = 'entry'
        ORDER BY p.created_at ASC LIMIT 2 FOR UPDATE`, [entry.ms_weight, entry.dipping_qty, entry.created_at]);
      if (matches.length > 1) throw Object.assign(new Error('This older used weight matches multiple production entries. Link it to the correct production entry before editing.'), { status: 409 });
      if (matches.length === 1) productionId = matches[0].id;
    }
    const [links] = await connection.query('SELECT production_entry_id, dipping_qty FROM labour_weight_consumptions WHERE labour_weight_id = ? ORDER BY id FOR UPDATE', [id]);
    const targets = entry.status === 'pending' ? [] : links.length ? links.map((link, index) => ({
      id: link.production_entry_id,
      qty: Number(link.dipping_qty) + (index === links.length - 1 ? qty - Number(entry.dipping_qty) : 0),
    })) : productionId ? [{ id: productionId, qty }] : [];
    if (targets.some(target => target.qty <= 0)) throw Object.assign(new Error('The last linked production entry must keep at least 1 NOS.'), { status: 409 });
    let production = null;
    for (const target of targets) {
      productionId = target.id;
      const targetQty = target.qty;
      const [rows] = await connection.query('SELECT * FROM production_entries WHERE id = ? FOR UPDATE', [productionId]);
      production = rows[0];
      if (!production) throw Object.assign(new Error('Linked production entry was not found.'), { status: 409 });
      const [plans] = await connection.query('SELECT planned_qty FROM production_planning_items WHERE id = ? FOR UPDATE', [production.planning_item_id]);
      if (plans.length) {
        const [totals] = await connection.query(`SELECT COALESCE(SUM(dipping_qty), 0) AS used_qty FROM production_entries
          WHERE planning_item_id = ? AND id <> ? AND COALESCE(row_type, 'entry') = 'entry'`, [production.planning_item_id, productionId]);
        const remaining = Number(plans[0].planned_qty) - Number(totals[0].used_qty);
        if (targetQty > remaining) throw Object.assign(new Error(`Only ${remaining} NOS remain in this production plan.`), { status: 409 });
      }
      const zincKg = calculateProductionZincKg({ dipping_qty: targetQty, ms_weight: ms, gi_weight: production.gi_weight });
      const zincPercentage = Number(production.gi_weight) > 0 ? Number((((Number(production.gi_weight) - ms) / ms) * 100).toFixed(2)) : null;
      await applyProductionZinc(connection, { entryId: productionId, srNo: production.sr_no, actorUserId: req.user.id, previousKg: production.zinc_stock_deducted_kg, nextKg: zincKg });
      await connection.query(`UPDATE production_entries SET ms_weight = ?, dipping_qty = ?, production_weight = ?, zinc_percentage = ?, zinc_stock_deducted_kg = ?, updated_by = ? WHERE id = ?`,
        [ms, targetQty, Math.round(ms * targetQty * 1000) / 1000, zincPercentage, zincKg, req.user.id, productionId]);
      if (production.planning_id) await recalculatePlanningProgress(connection, production.planning_id);
      const shiftDate = production.shift_date instanceof Date
        ? DateTime.fromJSDate(production.shift_date).setZone('Asia/Kolkata').toISODate()
        : String(production.shift_date).slice(0, 10);
      const monthStart = `${shiftDate.slice(0, 7)}-01`;
      const monthEnd = DateTime.fromISO(monthStart).endOf('month').toISODate();
      const [monthEntries] = await connection.query(`SELECT id, zinc_percentage FROM production_entries
        WHERE shift_date BETWEEN ? AND ? AND COALESCE(row_type, 'entry') = 'entry'`, [monthStart, monthEnd]);
      for (const monthEntry of monthEntries) {
        if (monthEntry.zinc_percentage == null) {
          await connection.query('UPDATE production_entries SET production_cost = NULL, production_cost_zinc_rate = NULL, production_cost_plant_cost = NULL WHERE id = ?', [monthEntry.id]);
        } else {
          await refreshProductionCost(connection, { entryId: monthEntry.id, shiftDate, zincPercentage: monthEntry.zinc_percentage });
        }
      }
      const [gasRuns] = await connection.query(`SELECT id, started_at, finished_at, consumed_gas_kg
        FROM gas_bottle_runs WHERE finished_at IS NOT NULL
          AND TIMESTAMP(?, ?) BETWEEN started_at AND finished_at FOR UPDATE`, [shiftDate, production.production_time]);
      for (const run of gasRuns) {
        const [totals] = await connection.query(`SELECT ROUND(COALESCE(SUM(ms_weight * dipping_qty), 0) / 1000, 3) production_ton
          FROM production_entries WHERE TIMESTAMP(shift_date, production_time) BETWEEN ? AND ?
          AND COALESCE(row_type, 'entry') = 'entry'`, [run.started_at, run.finished_at]);
        const tons = Number(totals[0].production_ton) || 0;
        await connection.query('UPDATE gas_bottle_runs SET production_ton = ?, gas_kg_per_ton = ? WHERE id = ?',
          [tons, tons ? Number(run.consumed_gas_kg) / tons : null, run.id]);
      }
    }
    if (links.length && entry.status === 'used') await connection.query('UPDATE labour_weight_consumptions SET dipping_qty = ? WHERE production_entry_id = ?', [targets[targets.length - 1].qty, targets[targets.length - 1].id]);
    const nextConsumed = entry.status === 'used' && links.length ? qty : Number(entry.consumed_qty);
    const nextStatus = entry.status === 'used' && !links.length ? 'used' : nextConsumed >= qty ? 'used' : 'pending';
    await connection.query('UPDATE labour_weight_entries SET ms_weight = ?, dipping_qty = ?, consumed_qty = ?, status = ?, production_entry_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [ms, qty, nextConsumed, nextStatus, links[0]?.production_entry_id || productionId || null, id]);
    await connection.commit();
    const io = req.app.get('io');
    io?.emit('labour_weights_updated', { action: 'updated', id });
    if (production) {
      io?.emit('production_updated', { action: 'labour_weight_updated', production_id: productionId, shift_id: production.shift_id });
      io?.emit('production_planning_updated', { action: 'progress_updated', id: production.planning_id });
      io?.emit('zinc_stock_updated', { action: 'production_updated' });
      io?.emit('gas_management_updated');
    }
    return res.json({ success: true, message: 'Weight entry updated.' });
  } catch (error) { if (connection) await connection.rollback(); return fail(res, error); }
  finally { connection?.release(); }
};

const toggleTimer = async (req, res) => {
  const columns = timerColumns[req.params.process];
  const id = Number(req.params.id);
  const requestedAction = req.body?.action;
  if (!columns || !Number.isSafeInteger(id) || id < 1 || !['start', 'stop'].includes(requestedAction)) return res.status(400).json({ success: false, message: 'Select a valid weight, timer and action.' });
  const [startedColumn, durationColumn, clientStartedColumn] = columns;
  const limitColumn = `${req.params.process}_limit_seconds`;
  const clientEventAtMs = Number(req.body?.client_event_at_ms);
  const validClientEvent = Number.isSafeInteger(clientEventAtMs) && clientEventAtMs > 0;
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT * FROM labour_weight_entries WHERE id = ? FOR UPDATE', [id]);
    const entry = rows[0];
    if (!entry) throw Object.assign(new Error('Labour weight entry not found.'), { status: 404 });
    if (req.user.role === 'labour' && Number(entry.labour_user_id) !== Number(req.user.id)) {
      throw Object.assign(new Error('Only the labour user who entered this weight can run its timer.'), { status: 403 });
    }
    if (entry[durationColumn] != null) throw Object.assign(new Error('This timer has already been stopped and saved.'), { status: 409 });
    if (entry[startedColumn] && Date.now() - effectiveStartMs(entry, req.params.process) >= (Number(entry[limitColumn]) || DEFAULT_LIMIT_SECONDS[req.params.process]) * 1000) {
      const limitSeconds = Number(entry[limitColumn]) || DEFAULT_LIMIT_SECONDS[req.params.process];
      await finishTimer(connection, entry, req.params.process, limitSeconds);
      await connection.commit();
      req.app.get('io')?.emit('labour_weights_updated', { action: 'timer_auto_stopped', id });
      req.app.get('io')?.emit('production_updated', { action: 'labour_timer_auto_stopped' });
      return res.json({ success: true, action: 'stopped', data: { id, process: req.params.process, duration_seconds: limitSeconds, duration_source: 'limit' } });
    }
    if (requestedAction === 'start' && entry[startedColumn]) throw Object.assign(new Error('This timer is already running. Refresh the weight list.'), { status: 409 });
    if (requestedAction === 'stop' && !entry[startedColumn]) throw Object.assign(new Error('This timer has not started. Refresh the weight list.'), { status: 409 });
    let action;
    let seconds = null;
    let durationSource = null;
    if (!entry[startedColumn]) {
      const limits = await getSetting('labour_timer_limits', connection);
      const limitSeconds = Number(limits[req.params.process]) * 60;
      await connection.query(`UPDATE labour_weight_entries SET ${startedColumn} = CURRENT_TIMESTAMP(3), ${clientStartedColumn} = ?, ${limitColumn} = ? WHERE id = ?`, [validClientEvent ? clientEventAtMs : null, limitSeconds, id]);
      action = 'started';
    } else {
      const [durationRows] = await connection.query(
        `SELECT GREATEST(0, TIMESTAMPDIFF(SECOND, ${startedColumn}, CURRENT_TIMESTAMP(3))) AS seconds FROM labour_weight_entries WHERE id = ?`,
        [id],
      );
      const serverSeconds = Number(durationRows[0]?.seconds) || 0;
      const clientStartedAtMs = Number(entry[clientStartedColumn]);
      const clientSeconds = validClientEvent && Number.isSafeInteger(clientStartedAtMs) && clientStartedAtMs > 0
        ? Math.floor((clientEventAtMs - clientStartedAtMs) / 1000)
        : null;
      const useClientDuration = Number.isSafeInteger(clientSeconds) && clientSeconds >= 0 && Math.abs(clientSeconds - serverSeconds) <= 10;
      seconds = Math.min(useClientDuration ? clientSeconds : serverSeconds, Number(entry[limitColumn]) || DEFAULT_LIMIT_SECONDS[req.params.process]);
      durationSource = useClientDuration ? 'client' : 'server';
      await finishTimer(connection, entry, req.params.process, seconds);
      action = 'stopped';
    }
    await connection.commit();
    const io = req.app.get('io');
    io?.emit('labour_weights_updated', { action, id, process: req.params.process });
    if (action === 'stopped') io?.emit('production_updated', { action: 'labour_timer_stopped', production_id: entry.production_entry_id });
    return res.json({ success: true, action, data: { id, process: req.params.process, duration_seconds: seconds, duration_source: durationSource } });
  } catch (error) {
    if (connection) await connection.rollback();
    return fail(res, error);
  } finally { connection?.release(); }
};

const consume = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [result] = await db.query("UPDATE labour_weight_entries SET status='used' WHERE id=? AND status='pending' AND consumed_qty=0", [id]);
    if (!result.affectedRows) return res.status(409).json({ success: false, message: 'This labour entry was already used.' });
    req.app.get('io')?.emit('labour_weights_updated');
    return res.json({ success: true });
  } catch (error) { return fail(res, error); }
};

module.exports = { list, listPending, create, update, consume, toggleTimer };
