const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Exercise handlers without loading .env, connecting to MySQL or sending notifications.
function load(relative, dependencies) {
  const filename = path.join(__dirname, '..', relative);
  const module = { exports: {} };
  const realRequire = createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require: name => name in dependencies ? dependencies[name] : realRequire(name),
    console: { info() {}, error() {} },
  }, { filename });
  return module.exports;
}

function fixture({ correction = true, existing = false, usedQty = 2, switchDuringSave = false, contractorExists = true, existingContractor = null, weightMode = 'manual', targetUserId = 4, entryOwner = 4, manageAll = false, labour = null } = {}) {
  let state = { id: 1, correction_shift_id: correction ? 10 : null, correction_user_id: correction ? targetUserId : null, revision: correction ? 1 : 2 };
  const current = { id: 20, shift_date: '2026-09-12', shift_name: 'day', status: 'active' };
  const previous = { id: 10, shift_date: '2026-09-11', shift_name: 'night', status: 'closed' };
  const entry = existing ? { created_by: entryOwner, id: 50, sr_no: 1, shift_id: 10, planning_id: 7, planning_item_id: 8, contractor_id: existingContractor } : null;
  const plan = { planning_id: 7, planning_item_id: 8, item_id: 3, challan_no: 'DC/2026-27/001',
    party_name: 'Test party', material_description: 'MS W BEAM + 1.7mm', planned_qty: 10,
    completed_qty: usedQty, target_zinc_percentage: 7, sequence_no: 1 };
  const calls = [];
  const writes = [];
  const events = [];
  let commits = 0;
  let rollbacks = 0;
  let autoAssignments = 0;
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    assert.equal((sql.match(/\?/g) || []).length, params.length, `SQL parameters: ${sql}`);
    if (sql.includes('FROM contractors')) return [contractorExists ? [{ id: params[0] }] : []];
    if (sql.includes('FROM production_shift_context')) {
      if (switchDuringSave && sql.includes('FOR UPDATE')) state = { ...state, correction_shift_id: null, revision: 2 };
      return [[{ ...state }]];
    }
    if (sql.includes('UPDATE production_shift_context')) {
      writes.push({ sql, params });
      state = { ...state, correction_user_id: sql.includes('correction_shift_id = NULL') ? null : params[1], correction_shift_id: sql.includes('correction_shift_id = NULL') ? null : params[0], revision: state.revision + 1 };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM shifts')) {
      const shift = Number(params[0]) === 10 ? previous : Number(params[0]) === 20 ? current : null;
      if (!shift || (sql.includes("status = 'closed'") && shift.status !== 'closed')) return [[]];
      return [[shift]];
    }
    if (sql.includes('production_edit_grants')) return [[]];
    if (sql.includes('FROM labour_weight_entries')) return [labour ? [{ dipping_qty: labour.total, consumed_qty: labour.cached }] : []];
    if (sql.includes('FROM labour_weight_consumptions')) {
      if (!labour || sql.includes('JOIN production_entries')) return [[]];
      if (sql.includes('WHERE production_entry_id = ?')) return [[{ labour_weight_id: 9, dipping_qty: labour.original }]];
      return [[{ production_entry_id: 50, dipping_qty: labour.original }, { production_entry_id: 51, dipping_qty: labour.other }]];
    }
    if (sql.includes('UPDATE labour_weight_')) { writes.push({ sql, params }); return [{ affectedRows: 1 }]; }
    if (sql.includes("FROM app_settings WHERE setting_key = 'labour_weight_mode'")) return [[{ setting_value: JSON.stringify({ mode: weightMode }) }]];
    if (sql.includes('AS used_qty')) return [[{ used_qty: usedQty }]];
    if (sql.includes('AS next_sr_no')) return [[{ next_sr_no: 4 }]];
    if (sql.includes('FROM production_planning')) return [[plan]];
    if (sql.includes('SELECT') && sql.includes('FROM production_entries')) return [entry ? [entry] : []];
    if (sql.includes('UPDATE production_entries') || sql.includes('INSERT INTO production_entries')) {
      writes.push({ sql, params });
      return [{ insertId: 99, affectedRows: 1 }];
    }
    throw new Error(`Unhandled test query ${sql}`);
  };
  const connection = { query, beginTransaction: async () => {}, commit: async () => { commits += 1; },
    rollback: async () => { rollbacks += 1; }, release() {} };
  const db = { query, getConnection: async () => connection };
  const automatic = { ensureAutomaticShift: async () => current, TIME_ZONE: 'Asia/Kolkata' };
  const context = load('services/productionShiftContextService.js', {
    '../config/db': db, './automaticShiftService': automatic,
  });
  const production = load('controllers/productionController.js', {
    '../config/db': db,
    '../services/productionShiftContextService': context,
    '../services/permissionService': {
      hasPermission: async ({ permissionKey }) =>
        permissionKey === 'shifts.correct' ? correction : permissionKey === 'production.save' ? true : permissionKey === 'production.manage_all' ? manageAll : false,
    },
    './plantStatusController': { getPlantStatusRow: async () => ({ status: 'running' }) },
    '../utils/checkEntryZincNotification': { checkEntryZincNotification: async () => ({ triggered: false }) },
    '../utils/checkProductionFlowCompletion': { notifyProductionFlowCompletion: async () => null },
    '../services/productionPlanningFlowService': {
      getActivePlanningItem: async () => { autoAssignments += 1; return plan; },
      recalculatePlanningProgress: async () => ({ status: 'pending' }),
    },
    '../services/productionZincStockService': {
      calculateProductionZincKg: ({ dipping_qty, ms_weight, gi_weight }) =>
        Math.max(0, Number(gi_weight) - Number(ms_weight)) * Number(dipping_qty),
      applyProductionZinc: async () => {},
    },
    '../services/productionCostService': {
      refreshProductionCost: async () => ({ production_cost: 0 }),
    },
  });
  const managers = load('controllers/shiftCorrectionController.js', {
    '../config/db': db, '../services/automaticShiftService': automatic,
    '../services/productionShiftContextService': context,
  });
  const app = { get: () => ({ emit: (...args) => events.push(args) }) };
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  return { context, production, managers, app, response, writes, events, calls,
    stats: () => ({ commits, rollbacks, autoAssignments }),
    request: overrides => ({ app, user: { id: 4, role: 'supervisor' }, body: {
      entry_type: 'full', shift_id: correction ? 10 : 20, shift_revision: correction ? 1 : 0,
      entry_id: existing ? 50 : 0, sr_no: 1, planning_item_id: 8,
      dipping_qty: 3, production_time: '22:00:00', ms_weight: 10, gi_weight: 10.5,
      ...overrides,
    } }),
  };
}

test('missed entry is saved to the closed shift with selected planning IDs and auto SR', async () => {
  const f = fixture(); const res = f.response();
  await f.production.saveProductionEntry(f.request(), res);
  assert.equal(res.statusCode, 201);
  const insert = f.writes.find(write => write.sql.includes('INSERT INTO production_entries'));
  assert.deepEqual(Array.from(insert.params.slice(0, 7)), [10, '2026-09-11', 'night', 4, 7, 8, 3]);
  assert.equal(f.stats().autoAssignments, 0);
  assert.equal(f.stats().commits, 1);
});

test('supervisor can repeatedly edit a correction row without a one-time grant', async () => {
  const f = fixture({ existing: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = f.response(); await f.production.saveProductionEntry(f.request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, 'updated');
  }
  assert.equal(f.writes.length, 2);
});

test('normal shift still requires a grant for supervisor edits', async () => {
  const f = fixture({ correction: false, existing: true }); const res = f.response();
  await f.production.saveProductionEntry(f.request(), res);
  assert.equal(res.statusCode, 403);
  assert.equal(f.writes.length, 0);
});

test('normal additions require explicit selection instead of falling back to the first flow', async () => {
  const f = fixture({ correction: false }); const res = f.response();
  await f.production.saveProductionEntry(f.request({ planning_item_id: null }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(f.writes.length, 0);
  assert.equal(f.stats().autoAssignments, 0);
});

test('normal additions use the explicitly selected challan without auto assignment', async () => {
  const f = fixture({ correction: false }); const res = f.response();
  await f.production.saveProductionEntry(f.request(), res);
  assert.equal(res.statusCode, 201);
  assert.equal(f.stats().autoAssignments, 0);
  assert.equal(f.writes[0].params[0], 20);
});

test('production links the selected contractor ID in the same transaction', async () => {
  const f = fixture({ correction: false }); const res = f.response();
  await f.production.saveProductionEntry(f.request({ contractor_id: 2 }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(f.writes[0].params.at(-1), 2);
  assert.equal(res.body.data.contractor_id, 2);
});

test('unavailable contractor prevents any production write', async () => {
  const f = fixture({ contractorExists: false }); const res = f.response();
  await f.production.saveProductionEntry(f.request({ contractor_id: 2 }), res);
  assert.equal(res.statusCode, 409); assert.equal(f.writes.length, 0);
});

test('editing from an older client preserves the stored contractor', async () => {
  const f = fixture({ existing: true, existingContractor: 2 }); const res = f.response();
  await f.production.saveProductionEntry(f.request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(f.writes[0].params.at(-2), 2);
});

test('correction cannot exceed the planned quantity', async () => {
  const f = fixture({ usedQty: 9 }); const res = f.response();
  await f.production.saveProductionEntry(f.request(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'PLANNED_QTY_EXCEEDED');
  assert.equal(f.writes.length, 0);
});

test('missed entry requires an explicit planning item', async () => {
  const f = fixture(); const res = f.response();
  await f.production.saveProductionEntry(f.request({ planning_item_id: null }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(f.writes.length, 0);
});

test('stale or missing shift context cannot write during correction', async () => {
  for (const body of [{ shift_id: 20 }, { shift_revision: 0 }, { shift_id: undefined, shift_revision: undefined }]) {
    const f = fixture(); const res = f.response();
    await f.production.saveProductionEntry(f.request(body), res);
    assert.equal(res.statusCode, 409);
    assert.equal(f.writes.length, 0);
  }
});

test('resume racing a save is rejected by the transaction context check', async () => {
  const f = fixture({ switchDuringSave: true }); const res = f.response();
  await f.production.saveProductionEntry(f.request(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(f.writes.length, 0);
  assert.equal(f.stats().rollbacks, 1);
});

test('a stale edit form cannot overwrite a different entry', async () => {
  const f = fixture({ existing: true }); const res = f.response();
  await f.production.saveProductionEntry(f.request({ entry_id: 999 }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(f.writes.length, 0);
});

test('resume restores current automatic shift and invalidates old correction forms', async () => {
  const f = fixture(); const res = f.response();
  await f.managers.resumeCurrentShift({ app: f.app, user: { id: 1 }, body: { revision: 1 } }, res);
  assert.equal(res.statusCode, 200);
  const current = await f.context.getProductionContext();
  assert.equal(current.shift.id, 20);
  assert.equal(current.correction, false);
  assert.equal(current.state.revision, 2);
  assert.throws(() => f.context.assertContext({ shift_id: 10, shift_revision: 1 }, current));
  assert.ok(f.events.some(event => event[0] === 'shift_updated'));
});

test('concurrent manager selections require the latest revision', async () => {
  const f = fixture(); const res = f.response();
  await f.managers.openCorrection({ app: f.app, user: { id: 1 }, body: { revision: 0, shift_id: 10 } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(f.writes.length, 0);
});

test('only the explicitly selected user receives correction context regardless of manager role', async () => {
  const f = fixture({ targetUserId: 4 });
  for (const userId of [1, 2, 3, 5, null]) {
    const context = await f.context.getProductionContext(null, true, userId);
    assert.equal(context.shift.id, 20);
    assert.equal(context.correction, false);
  }
  const selected = await f.context.getProductionContext(null, false, 4);
  assert.equal(selected.shift.id, 10);
  assert.equal(selected.correction, true);
  const legacy = fixture({ targetUserId: null });
  assert.equal((await legacy.context.getProductionContext(null, true, 4)).correction, false);
});

test('opening correction changes only the shared context and persists across reads', async () => {
  const f = fixture({ correction: false }); const res = f.response();
  await f.managers.openCorrection({ app: f.app, user: { id: 1 }, body: { revision: 2, shift_id: 10 } }, res);
  assert.equal(res.statusCode, 200);
  for (let read = 0; read < 2; read += 1) {
    const context = await f.context.getProductionContext(null, true, 1);
    assert.equal(context.shift.id, 10);
    assert.equal(context.correction, true);
    assert.equal(context.state.revision, 3);
  }
  assert.equal(f.writes.length, 1);
  assert.ok(f.writes[0].sql.includes('UPDATE production_shift_context'));
});

test('an active or nonexistent shift cannot be selected for correction', async () => {
  for (const shiftId of [20, 999]) {
    const f = fixture(); const res = f.response();
    await f.managers.openCorrection({ app: f.app, user: { id: 1 }, body: { revision: 1, shift_id: shiftId } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(f.writes.length, 0);
  }
});

test('only superadmin and plant manager can manage correction, even with custom permissions', async () => {
  const middleware = load('middleware/roleMiddleware.js', {
    '../services/permissionService': { getPermissionDefinition: () => ({}), hasPermission: async () => true },
  })(['superadmin', 'plant_manager']);
  for (const role of ['superadmin', 'plant_manager', 'supervisor', 'admin']) {
    let permitted = false; const res = fixture().response();
    await middleware({ user: { id: 1, role } }, res, () => { permitted = true; });
    assert.equal(permitted, ['superadmin', 'plant_manager'].includes(role));
  }
});

test('selection weight mode rejects a new production entry without a chosen dip', async () => {
  const f = fixture({ correction: false, weightMode: 'selection' });
  const res = f.response();
  await f.production.saveProductionEntry(f.request(), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Select the labour weight/);
  assert.equal(f.stats().commits, 0);
});


test('selected user enters correction while another user remains on the active shift', async () => {
  const f = fixture({ targetUserId: 4 });
  const selected = await f.context.getProductionContext(null, false, 4);
  const other = await f.context.getProductionContext(null, true, 5);
  assert.equal(selected.correction, true);
  assert.equal(selected.shift.id, 10);
  assert.equal(other.correction, false);
  assert.equal(other.shift.id, 20);
});

test('the selected correction user can edit entries created by another supervisor without a grant', async () => {
  for (const manageAll of [false, true]) {
    const f = fixture({ targetUserId: 4, entryOwner: 5, existing: true, manageAll });
    const res = f.response();
    await f.production.saveProductionEntry(f.request(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, 'updated');
    assert.ok(f.writes.some(write => write.sql.includes('UPDATE production_entries')));
  }
});

test('targeted correction allows editing and server-assigns a new SR despite an existing SR', async () => {
  const own = fixture({ targetUserId: 4, existing: true });
  const edited = own.response();
  await own.production.saveProductionEntry(own.request(), edited);
  assert.equal(edited.statusCode, 200);
  const other = fixture({ targetUserId: 4, existing: true, entryOwner: 5 });
  const added = other.response();
  await other.production.saveProductionEntry(other.request({ entry_id: 0 }), added);
  assert.equal(added.statusCode, 201);
  assert.ok(other.writes.some(write => write.sql.includes('INSERT INTO production_entries')));
  assert.ok(!other.writes.some(write => write.sql.includes('UPDATE production_entries')));
});

let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch {}
test('only the selected user sees and can edit all creators in the correction shift; other users stay live', { skip: !DatabaseSync }, async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE production_entries (id INTEGER, shift_id INTEGER, created_by INTEGER, updated_by INTEGER, contractor_id INTEGER, shift_date TEXT, sr_no INTEGER);
    CREATE TABLE contractors (id INTEGER, name TEXT);
    CREATE TABLE users (id INTEGER, name TEXT);
    CREATE TABLE production_edit_grants (id INTEGER, production_entry_id INTEGER, user_id INTEGER, used_at TEXT, revoked_at TEXT);
    INSERT INTO production_entries VALUES (1,10,4,NULL,NULL,'2026-09-11',1),(2,10,5,NULL,NULL,'2026-09-11',2),(3,20,4,NULL,NULL,'2026-09-12',1),(4,20,5,NULL,NULL,'2026-09-12',2);`);
  try {
    for (const manageAll of [false, true]) {
      const f = fixture({ targetUserId: 4, manageAll });
      await f.production.getProductions({ user: { id: 4, role: manageAll ? 'superadmin' : 'supervisor' }, query: { shift_id: 10 } }, f.response());
      const listing = f.calls.find(call => call.sql.includes('active_grant.user_id AS editable_user_id'));
      const rows = db.prepare(listing.sql).all(...listing.params);
      assert.deepEqual(rows.map(row => row.id), [1,2]);
      assert.ok(rows.every(row => row.can_edit === 1));
    }
    const f = fixture({ targetUserId: 5 });
    await f.production.getProductions({ user: { id: 4, role: 'supervisor' }, query: { shift_id: 20 } }, f.response());
    const listing = f.calls.find(call => call.sql.includes('active_grant.user_id AS editable_user_id'));
    assert.deepEqual(db.prepare(listing.sql).all(...listing.params).map(row => row.id), [3,4]);
    // Live listing resolves each user's shift on the server, ignoring a stale client shift ID.
    for (const [id, role, expected] of [[4, 'supervisor', [1,2]], [5, 'superadmin', [3,4]], [6, 'superadmin', [3,4]], [7, 'plant_manager', [3,4]], [8, 'supervisor', [3,4]]]) {
      const live = fixture({ targetUserId: 4 });
      await live.production.getProductions({ user: { id, role }, query: { live: 'true', shift_id: id === 4 ? 20 : 10 } }, live.response());
      const call = live.calls.find(call => call.sql.includes('active_grant.user_id AS editable_user_id'));
      assert.deepEqual(db.prepare(call.sql).all(...call.params).map(row => row.id), expected);
    }
  } finally { db.close(); }
});


test('shift status does not send a past-shift preview to other users or managers', async () => {
  const f = fixture({ targetUserId: 4 });
  let previewReads = 0;
  const handler = load('controllers/shiftController.js', {
    '../services/automaticShiftService': { TIME_ZONE: 'Asia/Kolkata', getShiftSchedule: async () => ({}),
      ensureAutomaticShift: async () => ({ id: 20, shift_name: 'day', shift_date: '2026-09-12' }), getCurrentShiftInfo: () => ({}) },
    './plantStatusController': { getPlantStatusRow: async () => ({ status: 'running' }) },
    '../services/productionShiftContextService': f.context,
    '../services/permissionService': { hasPermission: async () => true },
    '../config/db': { query: async () => { previewReads++; return [[{ id: 10, shift_name: 'night' }]]; } },
  });
  const selected = f.response();
  await handler.getShiftStatus({ user: { id: 4, role: 'supervisor' } }, selected);
  assert.equal(selected.body.data.correction_mode, true);
  assert.equal(selected.body.data.production_shift.id, 10);
  assert.equal(selected.body.data.correction_shift.id, 10);
  for (const [id, role] of [[5, 'superadmin'], [6, 'superadmin'], [7, 'plant_manager'], [8, 'supervisor']]) {
  const manager = f.response();
  await handler.getShiftStatus({ user: { id, role } }, manager);
  assert.equal(manager.body.data.correction_mode, false);
  assert.equal(manager.body.data.production_shift.id, 20);
  assert.equal(manager.body.data.correction_shift, null);
  assert.equal(manager.body.data.correction_active, true);
  }
  assert.equal(previewReads, 1);
});


test('a non-selected supervisor cannot save against the past shift', async () => {
  const f = fixture({ targetUserId: 5, existing: true });
  const res = f.response();
  await f.production.saveProductionEntry(f.request(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(f.writes.length, 0);
});


test('correction reconciles stale labour counter from allocation ledger', async () => {
  const f = fixture({ existing: true, targetUserId: 4, labour: { total: 93, cached: 100, original: 3, other: 90 } });
  const res = f.response();
  await f.production.saveProductionEntry(f.request({ dipping_qty: 3 }), res);
  assert.equal(res.statusCode, 200);
  const update = f.writes.find(write => write.sql.includes('UPDATE labour_weight_entries'));
  assert.deepEqual(Array.from(update.params), [93, 93, 9]);
  assert.equal(f.stats().commits, 1);
});

test('correction rejects real labour over-allocation even when cached counter is too low', async () => {
  const f = fixture({ existing: true, targetUserId: 4, labour: { total: 93, cached: 3, original: 3, other: 90 } });
  const res = f.response();
  await f.production.saveProductionEntry(f.request({ dipping_qty: 4 }), res);
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /93 NOS total/);
  assert.match(res.body.message, /90 NOS assigned/);
  assert.match(res.body.message, /up to 3 NOS/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.stats().rollbacks, 1);
});

test('correction updates split labour allocation within its available balance', async () => {
  const f = fixture({ existing: true, targetUserId: 4, labour: { total: 93, cached: 93, original: 3, other: 88 } });
  const res = f.response();
  await f.production.saveProductionEntry(f.request({ dipping_qty: 5 }), res);
  assert.equal(res.statusCode, 200);
  const update = f.writes.find(write => write.sql.includes('UPDATE labour_weight_entries'));
  assert.deepEqual(Array.from(update.params), [93, 93, 9]);
});


test('other supervisors and managers can add live entries while the selected user corrects a past shift', async () => {
  for (const role of ['supervisor', 'superadmin', 'plant_manager']) {
    const f = fixture({ targetUserId: 5 });
    const req = f.request({ shift_id: 20, shift_revision: 1 });
    req.user.role = role;
    const res = f.response();
    await f.production.saveProductionEntry(req, res);
    assert.equal(res.statusCode, 201);
    const insert = f.writes.find(write => write.sql.includes('INSERT INTO production_entries'));
    assert.equal(insert.params[0], 20);
  }
});
