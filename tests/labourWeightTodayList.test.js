const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('labour screen lists only the plant date while the production queue keeps pending weights', async () => {
  const reads = [];
  const module = { exports: {} };
  const mocks = {
    '../config/db': { query: async (sql, params) => { reads.push({ sql, params }); return [[]]; } },
    '../services/productionZincStockService': {},
    '../services/productionPlanningFlowService': {},
    '../services/productionCostService': {},
    '../services/permissionService': { hasPermission: async () => true },
    '../services/appSettingsService': {},
    '../services/labourTimerService': { expireDueTimers: async () => {}, DEFAULT_LIMIT_SECONDS: {} },
    luxon: require('luxon'),
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/labourWeightController.js'), 'utf8'), {
    module, require: name => mocks[name],
  });
  const req = { query: {}, user: { id: 1, role: 'superadmin' }, app: { get: () => null } };
  const res = { json: value => value };
  await module.exports.list(req, res);
  assert.match(reads[0].sql, /e\.created_at >= \? AND e\.created_at < \?/);
  assert.equal(reads[0].params.length, 2);
  assert.equal(reads[0].params[0], require('luxon').DateTime.now().setZone('Asia/Kolkata').toISODate());
  await module.exports.listPending(req, res);
  assert.match(reads[1].sql, /e\.status='pending'/);
  assert.doesNotMatch(reads[1].sql, /e\.created_at >= \?/);
});
