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

function fixture({ correction = true, existing = false, usedQty = 2, switchDuringSave = false } = {}) {
  let state = { id: 1, correction_shift_id: correction ? 10 : null, revision: correction ? 1 : 2 };
  const current = { id: 20, shift_date: '2026-09-12', shift_name: 'day', status: 'active' };
  const previous = { id: 10, shift_date: '2026-09-11', shift_name: 'night', status: 'closed' };
  const entry = existing ? { id: 50, sr_no: 1, shift_id: 10, planning_id: 7, planning_item_id: 8 } : null;
  const plan = { planning_id: 7, planning_item_id: 8, item_id: 3, challan_no: 'DC/2026-27/001',
    party_name: 'Test party', material_description: 'MS W BEAM + 1.7mm', planned_qty: 10,
    completed_qty: usedQty, target_zinc_percentage: 7, sequence_no: 1 };
  const writes = [];
  const events = [];
  let commits = 0;
  let rollbacks = 0;
  let autoAssignments = 0;
  const query = async (sql, params = []) => {
    assert.equal((sql.match(/\?/g) || []).length, params.length, `SQL parameters: ${sql}`);
    if (sql.includes('FROM production_shift_context')) {
      if (switchDuringSave && sql.includes('FOR UPDATE')) state = { ...state, correction_shift_id: null, revision: 2 };
      return [[{ ...state }]];
    }
    if (sql.includes('UPDATE production_shift_context')) {
      writes.push({ sql, params });
      state = { ...state, correction_shift_id: sql.includes('correction_shift_id = NULL') ? null : params[0], revision: state.revision + 1 };
      return [{ affectedRows: 1 }];
    }
    if (sql.includes('FROM shifts')) {
      const shift = Number(params[0]) === 10 ? previous : Number(params[0]) === 20 ? current : null;
      if (!shift || (sql.includes("status = 'closed'") && shift.status !== 'closed')) return [[]];
      return [[shift]];
    }
    if (sql.includes('production_edit_grants')) return [[]];
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
    '../services/permissionService': { hasPermission: async () => false },
    './plantStatusController': { getPlantStatusRow: async () => ({ status: 'running' }) },
    '../utils/checkEntryZincNotification': { checkEntryZincNotification: async () => ({ triggered: false }) },
    '../utils/checkProductionFlowCompletion': { notifyProductionFlowCompletion: async () => null },
    '../services/productionPlanningFlowService': {
      getActivePlanningItem: async () => { autoAssignments += 1; return plan; },
      recalculatePlanningProgress: async () => ({ status: 'pending' }),
    },
  });
  const managers = load('controllers/shiftCorrectionController.js', {
    '../config/db': db, '../services/automaticShiftService': automatic,
    '../services/productionShiftContextService': context,
  });
  const app = { get: () => ({ emit: (...args) => events.push(args) }) };
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  return { context, production, managers, app, response, writes, events,
    stats: () => ({ commits, rollbacks, autoAssignments }),
    request: overrides => ({ app, user: { id: 4, role: 'supervisor' }, body: {
      entry_type: 'full', shift_id: correction ? 10 : 20, shift_revision: correction ? 1 : 2,
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

test('normal additions retain automatic planning assignment', async () => {
  const f = fixture({ correction: false }); const res = f.response();
  await f.production.saveProductionEntry(f.request(), res);
  assert.equal(res.statusCode, 201);
  assert.equal(f.stats().autoAssignments, 1);
  assert.equal(f.writes[0].params[0], 20);
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

test('a stale add form cannot overwrite an existing SR', async () => {
  const f = fixture({ existing: true }); const res = f.response();
  await f.production.saveProductionEntry(f.request({ entry_id: 0 }), res);
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

test('admins stay on the current shift while supported roles see the correction shift', async () => {
  const f = fixture();
  for (const role of ['supervisor', 'plant_manager', 'superadmin', ' Supervisor ']) {
    const context = await f.context.getProductionContext(null, f.context.canUseShiftCorrection({ role }));
    assert.equal(context.shift.id, 10);
    assert.equal(context.correction, true);
  }
  for (const role of ['admin', ' ADMIN ', 'unknown']) {
    const context = await f.context.getProductionContext(null, f.context.canUseShiftCorrection({ role }));
    assert.equal(context.shift.id, 20);
    assert.equal(context.correction, false);
    assert.equal(context.state.revision, 0);
    assert.equal(context.state.correction_shift_id, null);
    assert.equal(context.ignoreCorrection, true);
    assert.throws(() => f.context.assertContext({ shift_id: 10 }, context));
  }
});

test('opening correction changes only the shared context and persists across reads', async () => {
  const f = fixture({ correction: false }); const res = f.response();
  await f.managers.openCorrection({ app: f.app, user: { id: 1 }, body: { revision: 2, shift_id: 10 } }, res);
  assert.equal(res.statusCode, 200);
  for (let read = 0; read < 2; read += 1) {
    const context = await f.context.getProductionContext();
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
