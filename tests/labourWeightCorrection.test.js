const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(role = 'supervisor') {
  const writes = []; const zinc = []; const costs = []; const plans = []; let committed = false;
  const entry = { id: 1, status: 'used', ms_weight: 10, dipping_qty: 5, production_entry_id: 8 };
  const production = { id: 8, sr_no: 2, shift_id: 1, shift_date: '2026-09-27', production_time: '10:00:00', planning_id: 3, planning_item_id: 4, gi_weight: 11, zinc_stock_deducted_kg: 5 };
  const query = async (sql, params) => {
    if (sql.includes('FROM labour_weight_entries WHERE id')) return [[entry]];
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
    luxon: require('luxon'),
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/labourWeightController.js'), 'utf8'), { module, require: name => mocks[name] });
  const req = { params: { id: 1 }, body: { ms_weight: 9, dipping_qty: 6 }, user: { id: 2, role }, app: { get: () => ({ emit() {} }) } };
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
