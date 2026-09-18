const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { getActivePlanningItem } = require('../services/productionPlanningFlowService');

function fixture(current = [8, 7, 6]) {
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('FROM production_planning')) return [current.map(id => ({ id }))];
      return [[{ id: 1 }]];
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/planningQueueController.js'), 'utf8'), {
    module, require: () => ({ getConnection: async () => connection }), console,
  });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return { calls, res, run: body => module.exports.reorderPlanningQueue({ body, app: { get: () => ({ emit: () => calls.push('emit') }) } }, res) };
}

test('playlist priority saves only positions, after taking the production save lock', async () => {
  const f = fixture();
  await f.run({ expected_ids: [8, 7, 6], ordered_ids: [6, 8, 7] });
  assert.equal(f.res.statusCode, 200);
  assert.match(f.calls[1].sql, /production_shift_context.*FOR UPDATE/);
  const writes = f.calls.filter(call => call.sql?.startsWith('UPDATE'));
  assert.deepEqual(writes.map(call => Array.from(call.params)), [[1, 6], [2, 8], [3, 7]]);
  for (const write of writes) assert.equal(write.sql, 'UPDATE production_planning SET queue_position = ? WHERE id = ?');
  assert.ok(f.calls.indexOf('commit') < f.calls.indexOf('emit'));
  assert.equal(f.calls.at(-1), 'release');
});

for (const current of [[7, 8, 6], [8, 7], [9, 8, 7, 6]]) {
  test(`rejects stale queue snapshot against ${current}`, async () => {
    const f = fixture(current);
    await f.run({ expected_ids: [8, 7, 6], ordered_ids: [6, 8, 7] });
    assert.equal(f.res.statusCode, 409);
    assert.equal(f.res.body.code, 'PLANNING_QUEUE_CHANGED');
    assert.ok(f.calls.includes('rollback'));
    assert.ok(!f.calls.some(call => call.sql?.startsWith('UPDATE')));
  });
}

for (const order of [[8, 8, 6], [8, 7], [8, 7, 99], ['8', 7, 6], []]) {
  test(`rejects invalid queue ${JSON.stringify(order)} before opening a transaction`, async () => {
    const f = fixture();
    await f.run({ expected_ids: [8, 7, 6], ordered_ids: order });
    assert.equal(f.res.statusCode, 400);
    assert.equal(f.calls.length, 0);
  });
}

test('active item query follows queue then item sequence and skips completed items', async () => {
  let sql;
  const active = { planning_id: 6, planning_item_id: 21, completed_qty: 50 };
  const result = await getActivePlanningItem({ query: async query => { sql = query; return [[active]]; } }, { lock: true });
  assert.equal(result, active);
  assert.match(sql, /ORDER BY COALESCE\(pp.queue_position, pp.id\) ASC, pp.id ASC, ppi.sequence_no ASC/);
  assert.match(sql, /ppi.planned_qty > ppi.completed_qty/);
  assert.match(sql, /pp.status = 'pending'/);
  assert.match(sql, /ppi.status = 'pending'/);
  assert.match(sql, /LIMIT 1 FOR UPDATE/);
});
