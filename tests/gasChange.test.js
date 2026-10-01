const test = require('node:test');
const assert = require('node:assert/strict');
const fakeDb = {};
require.cache[require.resolve('../config/db')] = { exports: fakeDb };
const { changeBottle } = require('../controllers/gasManagementController');

test('gas change finishes the old run without empty weight and starts the selected ready slot', async () => {
  const calls = []; let committed = false;
  fakeDb.getConnection = async () => ({
    beginTransaction: async () => {}, release() {}, rollback: async () => {}, commit: async () => { committed = true; },
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT * FROM gas_bottles')) return [[{ id: 1, status: 'ready', position_no: 4, remaining_gas_kg: 425, filled_weight_kg: 520 }, { id: 2, status: 'running', position_no: 2 }, { id: 3, status: 'filled', position_no: null, remaining_gas_kg: 425 }]];
      if (sql.startsWith('SELECT gr.')) return [[{ id: 10, bottle_id: 2, position_no: 2, started_at: '2026-09-27 08:00:00', start_gas_kg: 425, filled_weight_kg: 525, kg_per_bottle: 425, price_per_bottle: 44625 }]];
      if (sql.startsWith('SELECT ROUND')) return [[{ production_ton: 12 }]];
      return [{}];
    },
  });
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await changeBottle({ body: { bottle_number: 4, changed_at: '2026-09-27 12:00:00' }, user: { id: 5 }, app: { get: () => null } }, res);
  assert.equal(res.body.success, true); assert.equal(committed, true);
  assert.deepEqual(calls.find(c => c.sql.includes("SET status='running'")).values, [1]);
  const runUpdate = calls.find(c => c.sql.startsWith('UPDATE gas_bottle_runs'));
  assert.equal(runUpdate.values[2], 12);
  assert.equal(runUpdate.sql.includes('empty_weight_kg'), false);
  // Repeating the running number must not consume another bottle or commit.
  committed = false; calls.length = 0;
  await changeBottle({ body: { bottle_number: 2, changed_at: '2026-09-27 12:00:00' }, user: { id: 5 }, app: { get: () => null } }, res);
  assert.equal(res.code, 409); assert.equal(committed, false);
  assert.equal(calls.some(c => c.sql.startsWith('UPDATE')), false);
});
