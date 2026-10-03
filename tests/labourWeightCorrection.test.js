const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(role = 'supervisor', { status, qty = 6, consumedQty = 5, links = [], productionEntryId = 8 } = {}) {
  const writes = []; const zinc = []; const costs = []; const plans = []; let committed = false;
  const entry = { id: 1, status: 'used', ms_weight: 10, dipping_qty: 5, consumed_qty: consumedQty, production_entry_id: productionEntryId };
  const production = { id: 8, sr_no: 2, shift_id: 1, shift_date: '2026-09-27', production_time: '10:00:00', planning_id: 3, planning_item_id: 4, gi_weight: 11, zinc_stock_deducted_kg: 5 };
  const query = async (sql, params) => {
    if (sql.includes('FROM labour_weight_entries WHERE id')) return [[entry]];
    if (sql.includes('LEFT JOIN labour_weight_entries linked')) return [[]];
    if (sql.includes('FROM labour_weight_consumptions')) return [links];
    if (sql.includes('FROM production_entries WHERE id')) return [[production]];
    if (sql.includes('SELECT planned_qty')) return [[{ planned_qty: 100 }]];
    if (sql.includes('AS used_qty')) return [[{ used_qty: 10 }]];
    if (sql.includes('SELECT id, zinc_percentage')) return [[{ id: 8, zinc_percentage: 0 }, { id: 9, zinc_percentage: 15 }]];
    if (sql.includes('FROM gas_bottle_runs')) return [[]];
    writes.push({ sql, params }); return [{}];
  };
  const connection = { query, beginTransaction: async () => {}, commit: async () => { committed = true; }, rollback: async () => {}, release() {} };
  const mocks = {
    '../config/db': { getConnection: async () => connection },
    '../services/productionZincStockService': { calculateProductionZincKg: ({ dipping_qty, ms_weight, gi_weight }) => (gi_weight - ms_weight) * dipping_qty, applyProductionZinc: async (_, values) => { zinc.push(values); } },
    '../services/productionPlanningFlowService': { recalculatePlanningProgress: async (_, id) => { plans.push(id); } },
    '../services/productionCostService': { refreshProductionCost: async (_, values) => { costs.push(values); } },
    '../services/permissionService': { hasPermission: async () => true },
    '../services/appSettingsService': { getSetting: async () => ({ pickling: 7, flux: 2, hot_drier: 5, zinc_kettle: 5 }) },
    '../services/labourTimerService': { DEFAULT_LIMIT_SECONDS: {}, expireDueTimers: async () => {} },
    '../services/automaticShiftService': {},
    '../services/productionShiftContextService': {},
    '../services/gasProductionService': { productionAtSql: 'TIMESTAMP(pe.shift_date, pe.production_time)', getProductionTonsForPeriod: async () => 0 },
    luxon: require('luxon'),
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/labourWeightController.js'), 'utf8'), { module, require: name => mocks[name] });
  const req = { params: { id: 1 }, body: { ms_weight: status === 'pending' ? 10 : 9, dipping_qty: qty, ...(status ? { status } : {}) }, user: { id: 2, role }, app: { get: () => ({ emit() {} }) } };
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return { run: () => module.exports.update(req, res), res, writes, zinc, costs, plans, committed: () => committed };
}

test('supervisor correction updates used labour weight and dependent production values', async () => {
  const f = fixture(); await f.run();
  assert.equal(f.res.code, 200);
  assert.equal(f.committed(), true);
  const productionWrite = f.writes.find(x => x.sql.includes('UPDATE production_entries SET ms_weight'));
  assert.deepEqual(Array.from(productionWrite.params.slice(0, 5)), [9, 6, 54, 22.22, 12]);
  assert.equal(f.zinc[0].previousKg, 5);
  assert.equal(f.zinc[0].nextKg, 12);
  assert.deepEqual(f.plans, [3]);
  assert.deepEqual(f.costs.map(x => x.entryId), [8, 9]);
});

test('other roles cannot edit a used weight', async () => {
  const f = fixture('labour'); await f.run();
  assert.equal(f.res.code, 403);
  assert.equal(f.committed(), false);
  assert.equal(f.writes.length, 0);
});

test('only superadmin can return a linked used weight to pending with a new available balance', async () => {
  const f = fixture('superadmin', { status: 'pending', qty: 8, links: [{ production_entry_id: 8, dipping_qty: 5 }] });
  await f.run();
  assert.equal(f.res.code, 200);
  const update = f.writes.find(x => x.sql.includes('UPDATE labour_weight_entries SET ms_weight'));
  assert.deepEqual(Array.from(update.params.slice(0, 5)), [10, 8, 5, 'pending', 8]);
  assert.equal(f.writes.some(x => x.sql.includes('UPDATE production_entries')), false);
  assert.equal(f.committed(), true);
  const supervisor = fixture('supervisor', { status: 'pending', qty: 8 });
  await supervisor.run();
  assert.equal(supervisor.res.code, 403);
  assert.equal(supervisor.committed(), false);
});

test('used weight cannot be made pending without unconsumed quantity', async () => {
  const f = fixture('superadmin', { status: 'pending', qty: 5, links: [{ production_entry_id: 8, dipping_qty: 5 }] });
  await f.run();
  assert.equal(f.res.code, 409);
  assert.equal(f.committed(), false);
});

test('superadmin can return an unlinked manually used weight to pending without changing its quantity', async () => {
  const f = fixture('superadmin', { status: 'pending', qty: 5, consumedQty: 0, productionEntryId: null });
  await f.run();
  assert.equal(f.res.code, 200);
  const update = f.writes.find(x => x.sql.includes('UPDATE labour_weight_entries SET ms_weight'));
  assert.deepEqual(Array.from(update.params.slice(0, 5)), [10, 5, 0, 'pending', null]);
});
