const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { validateMigrationSql } = require('../scripts/migrationSafety');

function fixture({ existing, contractorExists = true, rows = [] } = {}) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    assert.equal((sql.match(/\?/g) || []).length, params?.length || 0);
    if (sql.includes('FROM contractors WHERE')) return [contractorExists ? [{ id: 1 }] : []];
    if (sql.includes('FOR UPDATE')) return [existing ? [existing] : []];
    if (sql.includes('FROM production_entries')) return [rows];
    return [{ insertId: 1 }];
  };
  const connection = { query, beginTransaction: async () => calls.push('begin'), commit: async () => calls.push('commit'), rollback: async () => calls.push('rollback'), release: () => calls.push('release') };
  const filename = path.join(__dirname, '../controllers/contractorController.js');
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, console,
    require: name => name === '../config/db' ? { query, getConnection: async () => connection } : realRequire(name) });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const req = { body: { shift_name: 'day', effective_from: '2026-09-18', contractor_id: 1, expected_id: null, expected_contractor_id: null },
    query: {}, user: { id: 2 }, app: { get: () => ({ emit: () => calls.push('emit') }) }, financialYear: { start_date: '2026-04-01', end_date: '2027-03-31', financial_year: '2026-27' } };
  return { controller: module.exports, res, req, calls };
}

test('contractor migrations are single-statement additive migrations', () => {
  for (const file of ['20260918000300_create_contractors.sql', '20260918000400_create_contractor_shift_assignments.sql']) {
    assert.doesNotThrow(() => validateMigrationSql(fs.readFileSync(path.join(__dirname, '../migrations/versioned', file), 'utf8')));
  }
});

test('repeating assignment persists effective date and emits only after commit', async () => {
  const f = fixture();
  await f.controller.saveAssignment(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  const write = f.calls.find(call => call.sql?.startsWith('INSERT'));
  assert.deepEqual(Array.from(write.params), ['day', '2026-09-18', 1, 2]);
  assert.ok(f.calls.indexOf('emit') > f.calls.indexOf('commit'));
  assert.equal(f.calls.at(-1), 'release');
});

test('explicit unassigned rule stops a repeating contractor assignment', async () => {
  const f = fixture(); f.req.body.contractor_id = null;
  await f.controller.saveAssignment(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  assert.equal(f.calls.find(call => call.sql?.startsWith('INSERT')).params[2], null);
});

test('editing a rule uses the previous contractor as a concurrency guard', async () => {
  const f = fixture({ existing: { id: 5, contractor_id: 2 } });
  Object.assign(f.req.body, { expected_id: 5, expected_contractor_id: 2 });
  await f.controller.saveAssignment(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  assert.ok(f.calls.some(call => call.sql?.startsWith('UPDATE contractor_shift_assignments')));
  assert.ok(!f.calls.some(call => call.sql?.includes('UPDATE production_entries')));
});

test('stale assignment cannot overwrite another manager', async () => {
  const f = fixture({ existing: { id: 5, contractor_id: 2 } });
  await f.controller.saveAssignment(f.req, f.res);
  assert.equal(f.res.statusCode, 409);
  assert.ok(f.calls.includes('rollback'));
  assert.ok(!f.calls.includes('emit'));
});

test('unknown contractor is rejected without creating an assignment', async () => {
  const f = fixture({ contractorExists: false });
  await f.controller.saveAssignment(f.req, f.res);
  assert.equal(f.res.statusCode, 404);
  assert.ok(f.calls.includes('rollback'));
});

for (const overrides of [{ effective_from: '2026-02-30' }, { shift_name: 'evening' }, { contractor_id: -1 }, { expected_id: undefined }]) {
  test(`invalid assignment rejected: ${JSON.stringify(overrides)}`, async () => {
    const f = fixture(); Object.assign(f.req.body, overrides);
    await f.controller.saveAssignment(f.req, f.res);
    assert.equal(f.res.statusCode, 400); assert.equal(f.calls.length, 0);
  });
}

test('report totals combine dates/shifts by contractor without multiplying rows', async () => {
  const f = fixture({ rows: [
    { contractor_id: 1, contractor_name: 'A', shift_date: '2026-09-18', shift_name: 'day', entry_count: 2, qty: '10', ms_kg: '1000', gi_kg: '1070' },
    { contractor_id: 1, contractor_name: 'A', shift_date: '2026-09-19', shift_name: 'night', entry_count: 1, qty: '5', ms_kg: '500', gi_kg: '535' },
    { contractor_id: null, shift_date: '2026-09-17', shift_name: 'day', entry_count: 1, qty: '3', ms_kg: '300', gi_kg: '321' },
  ] });
  await f.controller.getContractorReport(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  const [a, unassigned] = f.res.body.data.summaries;
  assert.equal(a.gi_kg, 1605); assert.equal(a.ms_kg, 1500); assert.equal(a.qty, 15); assert.equal(a.shift_count, 2);
  assert.equal(unassigned.contractor_name, 'Unassigned');
  const { sql, params } = f.calls[0];
  assert.match(sql, /rule.effective_from <= pe.shift_date/);
  assert.match(sql, /CONVERT\(rule.shift_name USING utf8mb4\) COLLATE utf8mb4_unicode_ci\s*= CONVERT\(LOWER\(pe.shift_name\) USING utf8mb4\) COLLATE utf8mb4_unicode_ci/);
  assert.match(sql, /ORDER BY rule.effective_from DESC LIMIT 1/);
  assert.match(sql, /COALESCE\(pe.row_type, 'entry'\) = 'entry'/);
  assert.match(sql, /pe.gi_weight, 0\) \* COALESCE\(pe.dipping_qty, 0\)/);
  assert.deepEqual(Array.from(params), ['2026-04-01', '2027-03-31']);
});

for (const query of [{ from: '2025-01-01' }, { to: '2028-01-01' }, { from: '2026-09-20', to: '2026-09-18' }, { from: '2026-02-30' }]) {
  test(`invalid report period rejected: ${JSON.stringify(query)}`, async () => {
    const f = fixture(); f.req.query = query;
    await f.controller.getContractorReport(f.req, f.res);
    assert.equal(f.res.statusCode, 400); assert.equal(f.calls.length, 0);
  });
}

test('contractor access defaults separate report viewing from assignment management', () => {
  const filename = path.join(__dirname, '../services/permissionService.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, require: () => ({}) });
  const access = module.exports.isDefaultAllowed;
  assert.equal(access('admin', 'contractors.view'), true);
  assert.equal(access('admin', 'contractors.manage'), false);
  assert.equal(access('plant_manager', 'contractors.manage'), true);
  assert.equal(access('supervisor', 'contractors.view'), false);
});
