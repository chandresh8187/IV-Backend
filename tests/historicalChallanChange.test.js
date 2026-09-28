const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture({ usedQty = 5, plannedQty = 20 } = {}) {
  const writes = []; const progress = []; const events = []; let committed = false;
  const current = { id: 42, sr_no: 2, planning_id: 10, planning_item_id: 11, item_id: 1, challan_no: 'OLD', party_name: 'Old party', material: 'Old material', dipping_qty: 8, ms_weight: 10, gi_weight: 11, shift_date: '2026-09-28', zinc_stock_deducted_kg: 8 };
  const query = async (sql, params) => {
    if (sql.includes('SELECT * FROM production_entries')) return [[current]];
    if (sql.includes('SELECT ppi.id AS planning_item_id')) return [[{ planning_item_id: 21, planning_id: 20, item_id: 3, planned_qty: plannedQty, challan_no: 'NEW', party_name: 'New party', material_description: 'New material' }]];
    if (sql.includes('AS used_qty')) return [[{ used_qty: usedQty }]];
    writes.push({ sql, params }); return [{ affectedRows: 1 }];
  };
  const connection = { query, beginTransaction: async () => {}, commit: async () => { committed = true; }, rollback: async () => {}, release() {} };
  const mocks = {
    '../config/db': { getConnection: async () => connection },
    '../services/productionZincStockService': { calculateProductionZincKg: () => 8, applyProductionZinc: async () => {} },
    '../services/productionPlanningFlowService': { recalculatePlanningProgress: async (_, id) => { progress.push(id); return { status: 'pending' }; } },
    '../services/productionCostService': { refreshProductionCost: async () => ({}) },
    '../utils/checkEntryZincNotification': { checkEntryZincNotification: async () => ({}) },
    '../utils/checkProductionFlowCompletion': {},
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/productionController.js'), 'utf8'), { module, console, require: name => mocks[name] || {} });
  const req = { params: { id: 42 }, body: { planning_item_id: 21, production_time: '10:30:00', dipping_qty: 8 }, user: { id: 1, role: 'superadmin' }, app: { get: () => ({ emit: (...args) => events.push(args) }) } };
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  return { run: () => module.exports.updateProductionById(req, res), req, res, writes, progress, events, committed: () => committed };
}

test('history edit moves the entry to the chosen challan and updates both plans', async () => {
  const f = fixture(); await f.run();
  assert.equal(f.res.code, 200); assert.equal(f.committed(), true);
  const update = f.writes.find(write => write.sql.includes('UPDATE production_entries SET production_time'));
  assert.deepEqual(Array.from(update.params.slice(-7)), [20, 21, 3, 'NEW', 'New party', 'New material', 42]);
  assert.deepEqual(f.progress, [10, 20]);
  assert.equal(f.events.filter(event => event[0] === 'production_planning_updated').length, 2);
});

test('history edit cannot move a quantity beyond the destination challan capacity', async () => {
  const f = fixture({ usedQty: 18 }); await f.run();
  assert.equal(f.res.code, 409); assert.equal(f.res.body.code, 'PLANNED_QTY_EXCEEDED');
  assert.equal(f.committed(), false);
  assert.equal(f.writes.some(write => write.sql.includes('UPDATE production_entries')), false);
});
