const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture({ remaining = 30, targetExists = true } = {}) {
  const writes = []; const progress = []; const events = []; let committed = false;
  const original = { id: 5, sr_no: 1, planning_id: 10, planning_item_id: 11, dipping_qty: 8, zinc_stock_deducted_kg: 8 };
  const query = async (sql, params) => {
    if (sql.includes('SELECT *') && sql.includes('FROM production_entries')) return [[original]];
    if (sql.includes('SELECT id FROM production_entries')) return [[{ id: 5 }]];
    if (sql.includes('FROM production_planning_items ppi JOIN')) return [targetExists ? [{ planning_id: 20, planning_item_id: 21, item_id: 4, challan_no: 'NEW', party_name: 'New customer', material_description: 'New material', planned_qty: 100 }] : []];
    if (sql.includes('AS used_qty')) return [[{ used_qty: 100 - remaining }]];
    writes.push({ sql, params }); return [{ affectedRows: 1 }];
  };
  const connection = { query, beginTransaction: async () => {}, commit: async () => { committed = true; }, rollback: async () => {}, release() {} };
  const mocks = {
    '../config/db': { query, getConnection: async () => connection },
    '../services/permissionService': { hasPermission: async () => true },
    '../services/productionShiftContextService': { getProductionContext: async () => ({ shift: { id: 1, shift_date: '2026-09-27', shift_name: 'day' } }), assertContext() {}, lockProductionContext: async () => {} },
    './plantStatusController': { getPlantStatusRow: async () => ({ status: 'running' }) },
    '../services/productionContractorService': { validateContractor: async () => null },
    '../services/productionZincStockService': { calculateProductionZincKg: () => 8, applyProductionZinc: async () => {} },
    '../services/productionPlanningFlowService': { recalculatePlanningProgress: async (_, id) => { progress.push(id); return { status: 'pending' }; } },
    '../services/productionCostService': { refreshProductionCost: async () => ({}) },
    '../utils/checkEntryZincNotification': { checkEntryZincNotification: async () => ({}) },
    '../utils/checkProductionFlowCompletion': {},
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/productionController.js'), 'utf8'), { module, console, require: name => mocks[name] || {} });
  const req = { body: { entry_type: 'full', entry_id: 5, sr_no: 1, planning_item_id: 21, dipping_qty: 8, ms_weight: 10, gi_weight: 11, production_time: '10:00:00' }, user: { id: 1, role: 'superadmin' }, app: { get: () => ({ emit: (...args) => events.push(args) }) } };
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return { run: () => module.exports.saveProductionEntry(req, res), req, res, writes, progress, committed: () => committed };
}
test('editing moves entry to selected challan and recalculates old and new plans', async () => {
  const f = fixture(); await f.run();
  assert.equal(f.res.code, 200); assert.equal(f.committed(), true);
  assert.equal(f.res.body.data.challan_no, 'NEW');
  const update = f.writes.find(w => w.sql.includes('SET planning_id = ?'));
  assert.deepEqual(Array.from(update.params.slice(0, 6)), [20, 21, 4, 'NEW', 'New customer', 'New material']);
  assert.deepEqual(f.progress, [10, 20]);
});
test('changing challan cannot exceed destination remaining quantity', async () => {
  const f = fixture({ remaining: 7 }); await f.run();
  assert.equal(f.res.code, 409); assert.equal(f.res.body.code, 'PLANNED_QTY_EXCEEDED');
  assert.equal(f.committed(), false); assert.equal(f.writes.some(w => w.sql.includes('UPDATE production_entries')), false);
});
test('changing challan rejects deleted, canceled or unavailable destination', async () => {
  const f = fixture({ targetExists: false }); await f.run();
  assert.equal(f.res.code, 409); assert.equal(f.committed(), false);
});
