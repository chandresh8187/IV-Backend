const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateProductionZincKg,
  applyProductionZinc,
} = require('../services/productionZincStockService');

test('production zinc is GI minus MS unit weight multiplied by dipping quantity', () => {
  assert.equal(calculateProductionZincKg({ dipping_qty: 20, ms_weight: 12.5, gi_weight: 13.2 }), 14);
  assert.equal(calculateProductionZincKg({ dipping_qty: 3, ms_weight: 10, gi_weight: 9 }), 0);
});

test('production use deducts kettle stock and writes an auditable movement', async () => {
  const calls = [];
  const connection = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT * FROM zinc_stock')) {
        return [[{ initialized: 1, plant_kg: 8989, kettle_kg: 1000, revision: 4 }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
  await applyProductionZinc(connection, {
    entryId: 51,
    srNo: 12,
    actorUserId: 7,
    nextKg: 125.5,
  });
  const update = calls.find(call => call.sql.includes('UPDATE zinc_stock SET kettle_kg'));
  assert.deepEqual(update.params, [874.5, 35.7, 5]);
  const movement = calls.find(call => call.sql.includes('INSERT INTO zinc_stock_movements'));
  assert.equal(movement.params[2], 'production_use');
  assert.equal(movement.params[3], 125.5);
  assert.equal(movement.params.at(-1), 51);
});

test('editing a production entry applies only the zinc difference', async () => {
  const calls = [];
  const connection = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT * FROM zinc_stock')) {
        return [[{ initialized: 1, plant_kg: 8000, kettle_kg: 500, revision: 2 }]];
      }
      return [{ affectedRows: 1 }];
    },
  };
  await applyProductionZinc(connection, {
    entryId: 9,
    srNo: 3,
    actorUserId: 7,
    previousKg: 100,
    nextKg: 75,
  });
  const update = calls.find(call => call.sql.includes('UPDATE zinc_stock SET kettle_kg'));
  assert.equal(update.params[0], 525);
  const movement = calls.find(call => call.sql.includes('INSERT INTO zinc_stock_movements'));
  assert.equal(movement.params[2], 'production_restore');
  assert.equal(movement.params[3], 25);
});

test('production save is rejected when the kettle does not have enough zinc', async () => {
  const connection = {
    query: async sql =>
      sql.includes('SELECT * FROM zinc_stock')
        ? [[{ initialized: 1, plant_kg: 100, kettle_kg: 10, revision: 1 }]]
        : [{ affectedRows: 1 }],
  };
  await assert.rejects(
    applyProductionZinc(connection, { entryId: 1, srNo: 1, actorUserId: 1, nextKg: 11 }),
    error => error.code === 'INSUFFICIENT_KETTLE_ZINC' && error.status === 409,
  );
});
