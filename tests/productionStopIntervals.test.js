const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('gas production-active time excludes only overlapping stop intervals across shifts', async () => {
  const filename = path.join(__dirname, '../services/gasProductionService.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => require(name) });
  const periods = [
    { started_at: '2026-10-01 23:00:00', ended_at: '2026-10-02 01:00:00' },
    { started_at: '2026-10-02 03:30:00', ended_at: '2026-10-02 04:30:00' },
  ];
  const queryable = { query: async () => [periods] };
  const result = await module.exports.getRunTimeBreakdown(queryable, [
    { id: 1, started_at: '2026-10-01 22:00:00', finished_at: '2026-10-02 02:00:00' },
    { id: 2, started_at: '2026-10-02 02:00:00', finished_at: '2026-10-02 04:00:00' },
  ]);
  assert.deepEqual(Array.from(result.get(1) && Object.values(result.get(1))), [14400, 7200, 1800, 5400]);
  assert.deepEqual(Array.from(result.get(2) && Object.values(result.get(2))), [7200, 1800, 1800, 3600]);
});

test('gas bottle time deducts 30 minutes per 12-hour period without creating a production stop', async () => {
  const { getRunTimeBreakdown } = require('../services/gasProductionService');
  const queryable = { query: async () => [[
    { started_at: '2026-10-01 12:00:00', ended_at: '2026-10-01 12:30:00' },
    { started_at: '2026-10-01 19:00:00', ended_at: '2026-10-01 20:00:00' },
  ]] };
  const result = await getRunTimeBreakdown(queryable, [
    { id: 1, started_at: '2026-10-01 08:00:00', finished_at: '2026-10-01 18:30:00' },
    { id: 2, started_at: '2026-10-01 18:30:00', finished_at: '2026-10-02 07:31:00' },
    { id: 3, started_at: '2026-10-02 08:00:00', finished_at: '2026-10-02 18:30:00' },
  ]);
  assert.deepEqual(result.get(1), { elapsed_seconds: 37800, stopped_seconds: 1800, lunch_break_seconds: 1800, production_active_seconds: 34200 });
  assert.deepEqual(result.get(2), { elapsed_seconds: 46860, stopped_seconds: 3600, lunch_break_seconds: 3600, production_active_seconds: 39660 });
  assert.deepEqual(result.get(3), { elapsed_seconds: 37800, stopped_seconds: 0, lunch_break_seconds: 1800, production_active_seconds: 36000 });
});

test('plant stop requires a reason and records the effective time rather than the time saved', async () => {
  const filename = path.join(__dirname, '../controllers/plantStatusController.js');
  const module = { exports: {} };
  const writes = [];
  const query = async (sql, params = []) => {
    if (sql.includes('FROM plant_status ps')) return [[{ id: 1, status: 'stopped', started_at: '2026-10-01 10:00:00' }]];
    if (sql.includes('SELECT * FROM plant_status WHERE id')) return [[{ id: 1, status: 'running', started_at: '2026-10-01 08:00:00' }]];
    writes.push({ sql, params });
    return [{ affectedRows: 1 }];
  };
  const connection = { query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: name => name === '../config/db' ? { query, getConnection: async () => connection } : require(name) });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await module.exports.changePlantStatus({ body: { status: 'stopped', message: 'Holiday', occurred_at: '2026-10-01 09:00' }, user: { id: 4 }, app: { get: () => null } }, res);
  assert.equal(res.code, 200);
  const historyInsert = writes.find(write => write.sql.includes('INSERT INTO plant_status_history'));
  assert.deepEqual(Array.from(historyInsert.params), ['Holiday', 'Holiday', '2026-10-01 09:00:00', 4]);
});
