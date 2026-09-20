const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const service = require('../services/zincStockService');
const { validateMigrationSql } = require('../scripts/migrationSafety');
const initial = { initialized: 1, plant_kg: 9989, kettle_kg: 0, kg_per_mm: 35.65, revision: 1 };
const body = overrides => ({ action: 'transfer', amount_kg: 1000, expected_revision: 1, request_id: 'zinc_test_request_0001', ...overrides });

test('9989 kg plant minus 1000 kg transfer leaves 8989 kg and raises kettle level by 28.1 mm', () => {
  const result = service.applyMovement(initial, service.normalizeMovement(body()));
  assert.equal(result.plant_kg, 8989);
  assert.equal(result.kettle_kg, 1000);
  assert.equal(result.plant_kg + result.kettle_kg, 9989);
  const snapshot = service.serializeStock(result);
  assert.equal(snapshot.level_mm.toFixed(1), '28.1');
  assert.equal(snapshot.capacity_kg, 44562.5);
});
test('opening stock is independent and receipts do not change kettle', () => {
  const movement = service.normalizeMovement(body({ action: 'initialize', expected_revision: 0, plant_kg: 9989, kettle_kg: 30000, kg_per_mm: 35.65 }));
  const opened = service.applyMovement({ revision: 0, initialized: 0, plant_kg: 0, kettle_kg: 0 }, movement);
  assert.equal(opened.plant_kg, 9989);
  assert.equal(opened.kettle_kg, 30000);
  const received = service.applyMovement(opened, service.normalizeMovement(body({ action: 'receive', amount_kg: 500 })));
  assert.equal(received.plant_kg, 10489);
  assert.equal(received.kettle_kg, 30000);
});
test('adjustment replaces both balances after initialization and keeps density', () => {
  const movement = service.normalizeMovement(body({
    action: 'adjust',
    plant_kg: 8500,
    kettle_kg: 16500,
    kg_per_mm: 35.65,
  }));
  const changed = service.applyMovement(initial, movement);
  assert.equal(changed.plant_kg, 8500);
  assert.equal(changed.kettle_kg, 16500);
  assert.equal(service.serializeStock(changed).level_mm.toFixed(1), '462.8');
  assert.equal(changed.revision, 2);
});
test('adjustment requires initialized stock and respects kettle capacity', () => {
  const valid = service.normalizeMovement(body({
    action: 'adjust',
    plant_kg: 1,
    kettle_kg: 1,
    kg_per_mm: 35.65,
  }));
  assert.throws(
    () => service.applyMovement({ ...initial, initialized: 0 }, valid),
    /opening stock/,
  );
  assert.throws(
    () => service.applyMovement(initial, service.normalizeMovement(body({
      action: 'adjust', plant_kg: 1, kettle_kg: 44562.501, kg_per_mm: 35.65,
    }))),
    /tank volume/,
  );
});
test('decimal kg arithmetic is exact to a gram and volume limit is enforced', () => {
  const result = service.applyMovement({ ...initial, plant_kg: 0.3, kettle_kg: 44562.4 }, service.normalizeMovement(body({ amount_kg: '0.1' })));
  assert.equal(result.plant_kg, 0.2);
  assert.equal(result.kettle_kg, 44562.5);
  assert.equal(service.serializeStock(result).level_mm, 1250);
  assert.throws(() => service.applyMovement(result, service.normalizeMovement(body({ expected_revision: 2, amount_kg: 0.001 }))), /tank volume/);
});
test('rejects insufficient stock, stale revisions and uninitialized or repeated setup', () => {
  assert.throws(() => service.applyMovement(initial, service.normalizeMovement(body({ amount_kg: 9990 }))), /not enough/);
  assert.throws(() => service.applyMovement(initial, service.normalizeMovement(body({ expected_revision: 0 }))), /changed/);
  assert.throws(() => service.applyMovement({ ...initial, initialized: 0 }, service.normalizeMovement(body())), /opening stock/);
  assert.throws(() => service.applyMovement(initial, service.normalizeMovement(body({ action: 'initialize', plant_kg: 1, kettle_kg: 1, kg_per_mm: 35.65 }))), /already/);
  assert.equal(service.serializeStock().level_mm, null);
});
test('rejects malformed weights and supports explicit zero opening stock', () => {
  for (const value of [-1, 0, 'NaN', Infinity, '', null, true, '1e3', '1.0001', {}, [], 1000000001]) {
    assert.throws(() => service.normalizeMovement(body({ amount_kg: value })), undefined, String(value));
  }
  assert.equal(service.grams('0', 'Opening', true), 0);
});
test('new migrations each contain one safe additive statement', () => {
  for (const name of ['20260920000100_create_zinc_stock.sql', '20260920000200_create_zinc_stock_movements.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/versioned', name), 'utf8');
    assert.doesNotThrow(() => validateMigrationSql(sql));
  }
});

function controllerFixture({ failLedger = false } = {}) {
  let stock = { ...initial }, ledger = [], working, staged;
  const events = [], calls = [];
  const query = async (sql, params = []) => {
    calls.push(sql);
    if (sql.startsWith('INSERT IGNORE')) return [{}];
    if (sql.includes('SELECT * FROM zinc_stock')) return [[{ ...(working || stock) }]];
    if (sql.includes('SELECT request_hash')) return [ledger.filter(row => row.request_id === params[0])];
    if (sql.startsWith('UPDATE zinc_stock')) {
      const [plant_kg, kettle_kg, kg_per_mm, revision] = params;
      working = { initialized: 1, plant_kg, kettle_kg, kg_per_mm, revision }; return [{}];
    }
    if (sql.includes('INSERT INTO zinc_stock_movements')) {
      if (failLedger) throw Object.assign(new Error('Ledger unavailable'), { status: 503 });
      staged.push({ request_id: params[0], request_hash: params[1] }); return [{}];
    }
    throw new Error('Unexpected query');
  };
  const conn = { query, beginTransaction: async () => { working = { ...stock }; staged = []; },
    commit: async () => { stock = working; ledger.push(...staged); working = null; calls.push('COMMIT'); },
    rollback: async () => { working = null; staged = []; calls.push('ROLLBACK'); }, release() {} };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/zincStockController.js'), 'utf8'), {
    module, console, require: name => name === 'crypto' ? crypto : name === '../config/db' ? { getConnection: async () => conn, query } : service,
  });
  const run = async data => {
    const res = { code: 200, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } };
    await module.exports.saveZincMovement({ body: data, user: { id: 1 }, app: { get: () => ({ emit: (...args) => events.push(args) }) } }, res);
    return res;
  };
  return { run, calls, events, getStock: () => stock, getLedger: () => ledger };
}
test('retrying identical transfer cannot subtract twice; event is emitted after commit', async () => {
  const f = controllerFixture();
  const first = await f.run(body());
  assert.equal(first.code, 200);
  assert.ok(f.calls.some(sql => sql.includes('FOR UPDATE')));
  const duplicate = await f.run(body());
  assert.equal(duplicate.code, 200);
  assert.equal(f.getStock().plant_kg, 8989);
  assert.equal(f.getLedger().length, 1);
  assert.equal(f.events.length, 1);
});
test('reusing an ID for a different transfer and stale concurrent saves are rejected', async () => {
  const f = controllerFixture(); await f.run(body());
  assert.equal((await f.run(body({ amount_kg: 2000 }))).code, 409);
  assert.equal((await f.run(body({ request_id: 'zinc_test_request_0002' }))).code, 409);
  assert.equal(f.getStock().plant_kg, 8989);
});
test('failed ledger insert rolls back both balances and emits no update', async () => {
  const f = controllerFixture({ failLedger: true });
  assert.equal((await f.run(body())).code, 503);
  assert.equal(f.getStock().plant_kg, 9989);
  assert.equal(f.getStock().kettle_kg, 0);
  assert.equal(f.events.length, 0);
  assert.ok(f.calls.includes('ROLLBACK'));
});
