const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { validateMigrationSql } = require('../scripts/migrationSafety');
const contractorService = require('../services/productionContractorService');

function fixture({ items = [{ id: 20, planning_id: 10 }], contractorExists = true } = {}) {
  const calls = [];
  const query = async (sql, params) => {
    assert.equal((sql.match(/\?/g) || []).length, params?.length || 0);
    calls.push({ sql, params });
    if (sql.includes('FROM production_planning_items')) return [items];
    if (sql.includes('FROM contractors')) return [contractorExists ? [{ id: 2 }] : []];
    if (sql.startsWith('SELECT')) return [[]];
    return [{ affectedRows: 1 }];
  };
  const connection = { query, beginTransaction: async () => {}, commit: async () => calls.push('commit'), rollback: async () => calls.push('rollback'), release() {} };
  const db = { query, getConnection: async () => connection };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/productionController.js'), 'utf8'), {
    module, console, require: name => name === '../config/db' ? db : name === '../services/productionContractorService' ? contractorService : {},
  });
  const req = { user: { id: 7 }, body: {}, app: { get: () => ({ to: room => ({ emit: () => calls.push(room) }) }) } };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return { controller: module.exports, calls, req, res };
}

test('three schema additions are additive single-statement migrations', () => {
  for (const file of ['20260919000300_link_production_contractor.sql', '20260919000400_default_planning_item.sql', '20260919000500_default_contractor.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/versioned', file), 'utf8');
    assert.doesNotThrow(() => validateMigrationSql(sql));
    assert.doesNotMatch(sql, /DROP|TRUNCATE|UPDATE /);
    if (file.includes('default_planning_item')) assert.match(sql, /default_planning_item_id BIGINT UNSIGNED/);
  }
});
test('default item stores exact material ID and parent planning for current user', async () => {
  const f = fixture(); f.req.body = { planning_item_id: 20 };
  await f.controller.setProductionPreference(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  const write = f.calls.find(call => call.sql?.startsWith('INSERT'));
  assert.deepEqual(Array.from(write.params), [7, 10, 20]);
  assert.doesNotMatch(write.sql, /default_contractor_id/);
  assert.ok(f.calls.indexOf('user:7') > f.calls.indexOf('commit'));
});
test('saving or clearing contractor default does not overwrite the challan default', async () => {
  for (const id of [2, null]) {
    const f = fixture(); f.req.body = { contractor_id: id };
    await f.controller.setProductionPreference(f.req, f.res);
    assert.equal(f.res.statusCode, 200);
    const write = f.calls.find(call => call.sql?.startsWith('INSERT'));
    assert.deepEqual(Array.from(write.params), [7, id]);
    assert.doesNotMatch(write.sql, /default_planning/);
  }
});
test('completed or missing planning cannot be made default', async () => {
  const f = fixture({ items: [] }); f.req.body = { planning_item_id: 20 };
  await f.controller.setProductionPreference(f.req, f.res);
  assert.equal(f.res.statusCode, 409); assert.ok(f.calls.includes('rollback'));
});
test('legacy parent-only request is rejected when it has multiple materials', async () => {
  const f = fixture({ items: [{ id: 20, planning_id: 10 }, { id: 21, planning_id: 10 }] }); f.req.body = { planning_id: 10 };
  await f.controller.setProductionPreference(f.req, f.res);
  assert.equal(f.res.statusCode, 409);
});
test('missing contractor cannot be saved as a default', async () => {
  const f = fixture({ contractorExists: false }); f.req.body = { contractor_id: 2 };
  await f.controller.setProductionPreference(f.req, f.res);
  assert.equal(f.res.statusCode, 409);
});
for (const value of [-1, 'abc', false, '']) {
  test(`invalid default ID ${JSON.stringify(value)} performs no writes`, async () => {
    const f = fixture(); f.req.body = { contractor_id: value };
    await f.controller.setProductionPreference(f.req, f.res);
    assert.equal(f.res.statusCode, 400); assert.equal(f.calls.length, 0);
  });
}
