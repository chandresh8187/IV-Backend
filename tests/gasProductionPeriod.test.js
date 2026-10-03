const test = require('node:test');
const assert = require('node:assert/strict');
const { getProductionTonsForPeriod, getProductionTonsForRuns } = require('../services/gasProductionService');

test('gas production uses full bottle timestamps and rolls post-midnight shift entries forward', async () => {
  const calls = [];
  const db = { query: async (sql, params) => {
    calls.push({ sql, params });
    return [[{ production_ton: 32 }]];
  } };
  const start = '2026-10-01 23:45:51';
  const finish = '2026-10-02 09:33:00';
  assert.equal(await getProductionTonsForPeriod(db, start, finish), 32);
  assert.deepEqual(calls[0].params, [start, finish]);
  assert.match(calls[0].sql, /TIME\(s\.start_time\)/);
  assert.match(calls[0].sql, /INTERVAL IF\([\s\S]+\) DAY/);
  assert.match(calls[0].sql, />= \? AND[\s\S]+< \?/);
  assert.doesNotMatch(calls[0].sql, /WHERE\s+pe\.shift_date\s*=/);
});

test('finished gas runs are recalculated for movement and PDF reads', async () => {
  const db = { query: async (_sql, params) => {
    assert.deepEqual(params, [[1, 2]]);
    return [[{ id: 1, production_ton: 21 }, { id: 2, production_ton: 32 }]];
  } };
  const totals = await getProductionTonsForRuns(db, [
    { id: 1, finished_at: '2026-10-01 23:45:51' },
    { id: 2, finished_at: '2026-10-02 09:33:00' },
    { id: 3, finished_at: null },
  ]);
  assert.equal(totals.get(1), 21);
  assert.equal(totals.get(2), 32);
  assert.equal(totals.has(3), false);
});
