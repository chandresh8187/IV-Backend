const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('pending production weights follow the selected user correction shift while the labour screen stays live', async () => {
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
    '../services/automaticShiftService': {
      getShiftSchedule: async () => ({ day_start: '08:00' }),
      getCurrentShiftInfo: () => ({ shift_name: 'night', shift_date: '2026-10-01', shift_start: '2026-10-01 20:00:00', shift_end: '2026-10-02 08:00:00' }),
    },
    '../services/productionShiftContextService': {
      getProductionContext: async (_shift, _allow, userId) => ({ shift: userId === 1
        ? { start_time: '2026-10-01 20:00:00', end_time: '2026-10-02 08:00:00' }
        : { start_time: '2026-10-02 08:00:00', scheduled_end_time: '2026-10-02 20:00:00' } }),
    },
    '../services/gasProductionService': { productionAtSql: 'TIMESTAMP(pe.shift_date, pe.production_time)', getProductionTonsForPeriod: async () => 0 },
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
  assert.equal(reads[0].params[0], '2026-10-01 20:00:00');
  assert.equal(reads[0].params[1], '2026-10-02 08:00:00');
  await module.exports.listPending(req, res);
  assert.match(reads[1].sql, /e\.status='pending'/);
  assert.match(reads[1].sql, /e\.created_at >= \? AND e\.created_at < \?/);
  assert.deepEqual(Array.from(reads[1].params), ['2026-10-01 20:00:00', '2026-10-02 08:00:00']);
  await module.exports.listPending({ ...req, user: { ...req.user, id: 2 } }, res);
  assert.deepEqual(Array.from(reads[2].params), ['2026-10-02 08:00:00', '2026-10-02 20:00:00']);
});
