const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(entry = { id: 7, status: 'pending', consumed_qty: 0, production_entry_id: null }) {
  const queries = [];
  let commits = 0;
  let rollbacks = 0;
  const query = async (sql, params = []) => {
    queries.push({ sql, params });
    if (sql.includes('FROM labour_weight_entries WHERE id = ? FOR UPDATE')) return [[entry]];
    if (sql.includes('FROM labour_weight_consumptions')) return [[]];
    if (sql.includes('FROM labour_weight_entries e')) return [[]];
    if (sql.startsWith('DELETE FROM labour_weight_entries')) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const connection = { query, beginTransaction: async () => {}, commit: async () => { commits++; }, rollback: async () => { rollbacks++; }, release() {} };
  const mocks = {
    '../config/db': { query, getConnection: async () => connection },
    '../services/productionZincStockService': {},
    '../services/productionPlanningFlowService': {},
    '../services/productionCostService': {},
    luxon: require('luxon'),
    '../services/permissionService': {},
    '../services/appSettingsService': {},
    '../services/labourTimerService': {},
    '../services/automaticShiftService': { getShiftSchedule: async () => ({ day_start: '08:00' }) },
    '../services/productionShiftContextService': {},
    '../services/gasProductionService': {},
  };
  const module = { exports: {} };
  const filename = path.join(__dirname, '../controllers/labourWeightController.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => mocks[name], console });
  const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
  const app = { get: () => ({ emit() {} }) };
  return { controller: module.exports, response, app, queries, stats: () => ({ commits, rollbacks }) };
}

test('archive uses the selected night shift window across midnight', async () => {
  const f = fixture(); const res = f.response();
  await f.controller.listArchive({ user: { role: 'plant_manager' }, query: { date: '2026-10-01', shift: 'night' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.shift.name, 'night');
  const list = f.queries.find(item => item.sql.includes('FROM labour_weight_entries e'));
  assert.deepEqual(Array.from(list.params), ['2026-10-01 20:00:00', '2026-10-02 08:00:00']);
});

test('archive is restricted to management roles', async () => {
  const f = fixture(); const res = f.response();
  await f.controller.listArchive({ user: { role: 'supervisor' }, query: { date: '2026-10-01', shift: 'night' } }, res);
  assert.equal(res.code, 403);
  assert.equal(f.queries.length, 0);
});

test('only unused unlinked weights can be deleted', async () => {
  const unused = fixture(); const saved = unused.response();
  await unused.controller.remove({ params: { id: 7 }, app: unused.app }, saved);
  assert.equal(saved.code, 200);
  assert.equal(unused.stats().commits, 1);

  const used = fixture({ id: 7, status: 'used', consumed_qty: 1, production_entry_id: 22 });
  const blocked = used.response();
  await used.controller.remove({ params: { id: 7 }, app: used.app }, blocked);
  assert.equal(blocked.code, 409);
  assert.equal(used.stats().rollbacks, 1);
  assert.equal(used.queries.some(item => item.sql.startsWith('DELETE FROM')), false);
});
