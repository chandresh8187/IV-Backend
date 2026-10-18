const test = require('node:test');
const assert = require('node:assert/strict');
const { returnCoil } = require('../services/unit1ReturnCoil');

function fixture(status = 'running', usedKg = 500) {
  const run = { status, coilId: 4, coilNumber: 2, jobCardId: 9, producedPieces: 100 };
  const writes = [];
  const connection = { execute: async (sql, params) => {
    assert.equal((sql.match(/\?/g) || []).length, params.length);
    if (sql.startsWith('SELECT status')) return [[run]];
    if (sql.startsWith('SELECT id FROM coils')) return [[{ id: 4 }]];
    if (sql.includes('AS startingKg')) {
      assert.deepEqual(params, [2, 4]);
      return [[{ startingKg: 1000, usedKg }]];
    }
    writes.push({ sql, params });
    if (sql.startsWith('UPDATE unit1_production_runs')) run.status = 'returned';
    return [{ affectedRows: 1 }];
  } };
  return { run, writes, connection };
}

for (const status of ['running', 'paused']) {
  test(`returns a ${status} coil without deleting production or changing job progress`, async () => {
    const f = fixture(status);
    assert.equal((await returnCoil(f.connection, 10, 3)).remainingKg, 500);
    assert.equal(f.run.status, 'returned');
    assert.equal(f.run.producedPieces, 100);
    assert.equal(f.writes.length, 2);
    assert.match(f.writes[0].sql, /last_resumed_at=NULL,status='returned'/);
    assert.match(f.writes[1].sql, /coil_returned/);
    assert.deepEqual(f.writes[1].params, [10, 'Returned to stock; calculated remaining 500.000 kg', 3]);
    await assert.rejects(returnCoil(f.connection, 10, 3), { status: 409 });
    assert.equal(f.writes.length, 2);
  });
}

for (const status of ['setup', 'returned', 'completed']) {
  test(`rejects a ${status} coil without stock or history changes`, async () => {
    const f = fixture(status);
    await assert.rejects(returnCoil(f.connection, 10, 3), { status: 409 });
    assert.equal(f.writes.length, 0);
  });
}

test('rejects exhausted and overdrawn coils', async () => {
  for (const used of [1000, 1001]) {
    const f = fixture('running', used);
    await assert.rejects(returnCoil(f.connection, 10, 3), { status: 409 });
    assert.equal(f.writes.length, 0);
  }
});
