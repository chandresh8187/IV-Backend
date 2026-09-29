const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture({ secondItem = 7, nextCapacity = 30 } = {}) {
  const weight = { id: 9, ms_weight: 12, dipping_qty: 40, consumed_qty: 0, production_entry_id: null, status: 'pending', pickling_duration_seconds: 206, flux_duration_seconds: 93, hot_drier_duration_seconds: 60 };
  const writes = [];
  let nextId = 101;
  const plans = {
    1: { planning_id: 11, planning_item_id: 1, item_id: 7, challan_no: 'A', party_name: 'Party', material_description: 'Pipe', planned_qty: 10, completed_qty: 0 },
    2: { planning_id: 12, planning_item_id: 2, item_id: secondItem, challan_no: 'B', party_name: 'Party', material_description: secondItem === 7 ? 'Pipe' : 'Angle', planned_qty: nextCapacity, completed_qty: 0 },
  };
  const production = new Map();
  const query = async (sql, params = []) => {
    if (sql.includes('SELECT *') && sql.includes('FROM production_entries')) return [[]];
    if (sql.includes('SELECT id FROM production_entries')) return [[]];
    if (sql.includes('SELECT ppi.item_id, ppi.material_description')) return [[plans[2]]];
    if (sql.includes('FROM production_planning_items ppi JOIN')) return [[plans[params[0]]]];
    if (sql.includes('AS used_qty')) return [[{ used_qty: plans[params[0] === 11 ? 1 : 2].completed_qty }]];
    if (sql.includes('SELECT id, ms_weight, dipping_qty, consumed_qty')) return [weight.status === 'pending' ? [{ ...weight }] : []];
    if (sql.includes('SELECT item_id, material FROM production_entries')) return [[production.get(params[0])]];
    if (sql.includes('AS next_sr_no')) return [[{ next_sr_no: nextId - 100 }]];
    if (sql.includes('INSERT INTO production_entries')) {
      const id = nextId++;
      production.set(id, { item_id: params[6], material: params[9] });
      writes.push({ sql, params });
      return [{ insertId: id }];
    }
    if (sql.includes('UPDATE labour_weight_entries SET status')) {
      weight.consumed_qty += params[0];
      weight.status = weight.consumed_qty >= weight.dipping_qty ? 'used' : 'pending';
      weight.production_entry_id ||= params[2];
    }
    writes.push({ sql, params });
    return [{ affectedRows: 1 }];
  };
  const connection = { query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
  const mocks = {
    '../config/db': { query, getConnection: async () => connection },
    '../services/permissionService': { hasPermission: async () => true },
    '../services/productionShiftContextService': { getProductionContext: async () => ({ shift: { id: 1, shift_date: '2026-09-28', shift_name: 'day' } }), assertContext() {}, lockProductionContext: async () => {} },
    './plantStatusController': { getPlantStatusRow: async () => ({ status: 'running' }) },
    '../services/productionContractorService': { validateContractor: async () => null },
    '../services/productionZincStockService': { calculateProductionZincKg: () => 0, applyProductionZinc: async () => {} },
    '../services/productionPlanningFlowService': { recalculatePlanningProgress: async () => ({ status: 'pending' }) },
    '../services/productionCostService': { refreshProductionCost: async () => ({}) },
    '../utils/checkEntryZincNotification': { checkEntryZincNotification: async () => ({}) },
    '../utils/checkProductionFlowCompletion': {},
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/productionController.js'), 'utf8'), { module, console, require: name => mocks[name] || {} });
  async function save(planId, qty) {
    const req = { body: { entry_type: 'full', sr_no: nextId - 100, planning_item_id: planId, dipping_qty: qty, ms_weight: 12, gi_weight: 13, production_time: '10:00:00', labour_weight_id: 9 }, user: { id: 1, role: 'supervisor' }, app: { get: () => ({ emit() {} }) } };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await module.exports.saveProductionEntry(req, res);
    if (res.code === 201) plans[planId].completed_qty += qty;
    return res;
  }
  return { save, weight, writes, plans };
}

test('40 labour NOS can save 10 then 30 on same-material challans', async () => {
  const f = fixture();
  assert.equal((await f.save(1, 10)).code, 201);
  assert.equal(f.weight.consumed_qty, 10);
  assert.equal(f.weight.status, 'pending');
  assert.equal((await f.save(2, 30)).code, 201);
  assert.equal(f.weight.consumed_qty, 40);
  assert.equal(f.weight.status, 'used');
  assert.equal(f.writes.filter(write => write.sql.includes('INSERT INTO labour_weight_consumptions')).length, 2);
  for (const insert of f.writes.filter(write => write.sql.includes('INSERT INTO production_entries'))) {
    assert.deepEqual(Array.from(insert.params.slice(23, 26)), [206, 93, 60]);
    assert.equal((insert.sql.match(/\?/g) || []).length, insert.params.length);
  }
});

test('split refuses a different material or insufficient same-material capacity', async () => {
  const wrongMaterial = fixture({ secondItem: 8 });
  assert.equal((await wrongMaterial.save(1, 10)).code, 409);
  const shortPlan = fixture({ nextCapacity: 20 });
  assert.equal((await shortPlan.save(1, 10)).code, 409);
});

test('remaining labour quantity cannot move to a different material after the first save', async () => {
  const f = fixture();
  assert.equal((await f.save(1, 10)).code, 201);
  f.plans[2].item_id = 8;
  f.plans[2].material_description = 'Angle';
  const result = await f.save(2, 30);
  assert.equal(result.code, 409);
  assert.match(result.body.message, /same material/);
  assert.equal(f.weight.consumed_qty, 10);
});
