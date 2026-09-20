const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { validateMigrationSql } = require('../scripts/migrationSafety');

function fixture({ existing, contractorExists = true, rows = [], rotations = [], contractors = [], writeError, affectedRows = 1 } = {}) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    assert.equal((sql.match(/\?/g) || []).length, params?.length || 0);
    if (writeError && /^(UPDATE contractors|DELETE FROM contractors)/.test(sql)) throw { code: writeError };
    if (sql.startsWith('SELECT') && sql.includes('FROM contractors WHERE')) return [contractorExists ? [{ id: 1 }] : []];
    if (sql.includes('FOR UPDATE')) return [existing ? [existing] : []];
    if (sql.includes('FROM production_entries')) return [rows];
    if (sql.includes('FROM contractor_rotations r')) return [rotations];
    if (sql.includes('SELECT id, name FROM contractors')) return [contractors];
    return [{ insertId: 1, affectedRows }];
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
  for (const file of ['20260918000300_create_contractors.sql', '20260918000400_create_contractor_shift_assignments.sql', '20260919000200_create_contractor_rotations.sql']) {
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

const { resolveRotation } = require('../services/contractorRotationService');
test('contractor edits rename by ID without touching production', async () => {
  const f = fixture(); f.req.params = { id: '2' }; f.req.body = { name: ' New name ' };
  await f.controller.updateContractor(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  assert.deepEqual(Array.from(f.calls[0].params), ['New name', 2]);
  assert.ok(f.calls.includes('emit'));
});
test('linked contractor deletion is rejected by foreign-key protection', async () => {
  const f = fixture({ writeError: 'ER_ROW_IS_REFERENCED_2' }); f.req.params = { id: '2' };
  await f.controller.deleteContractor(f.req, f.res);
  assert.equal(f.res.statusCode, 409);
  assert.ok(!f.calls.includes('emit'));
});
test('unused contractor can be deleted by ID', async () => {
  const f = fixture(); f.req.params = { id: '2' };
  await f.controller.deleteContractor(f.req, f.res);
  assert.equal(f.res.statusCode, 200); assert.match(f.calls[0].sql, /WHERE id = \?/);
  assert.deepEqual(Array.from(f.calls[0].params), [2]);
});
test('duplicate contractor rename returns a useful conflict', async () => {
  const f = fixture({ writeError: 'ER_DUP_ENTRY' }); f.req.params = { id: '2' }; f.req.body = { name: 'Bintu' };
  await f.controller.updateContractor(f.req, f.res);
  assert.equal(f.res.statusCode, 409);
});

test('entry-selected contractor takes precedence over old shift rotation', async () => {
  const f = fixture({ rotations, rows: [
    { shift_date: '2026-10-01', shift_name: 'day', selected_contractor_id: 1, selected_contractor_name: 'Bintu', qty: 2, ms_kg: 200, gi_kg: 214, entry_count: 1 },
    { shift_date: '2026-10-01', shift_name: 'day', qty: 1, ms_kg: 100, gi_kg: 107, entry_count: 1 },
  ] });
  f.req.query = { month: '2026-10' };
  await f.controller.getContractorReport(f.req, f.res);
  assert.equal(f.res.body.data.summaries.find(row => row.contractor_id === 1).gi_kg, 214);
  assert.equal(f.res.body.data.summaries.find(row => row.contractor_id === 2).gi_kg, 107);
});
test('settings contractor directory reads only master records without assignment tables', async () => {
  const f = fixture({ contractors: [{ id: 1, name: 'Bintu' }, { id: 2, name: 'Bhagat' }] });
  await f.controller.listContractorDirectory(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  assert.equal(f.res.body.data.length, 2);
  assert.equal(f.res.body.data[0].name, 'Bintu');
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].sql, /FROM contractors ORDER BY name, id/);
});

test('adding a contractor inserts the name and notifies directory listeners', async () => {
  const f = fixture(); f.req.body = { name: ' Bintu ' };
  await f.controller.createContractor(f.req, f.res);
  assert.equal(f.res.statusCode, 201);
  assert.equal(f.res.body.data.name, 'Bintu');
  assert.equal(f.calls[0].params[0], 'Bintu');
  assert.ok(f.calls.includes('emit'));
});
const rotations = [{ id: 1, effective_from: '2026-09-18', day_contractor_id: 1, night_contractor_id: 2,
  day_contractor_name: 'Bintu', night_contractor_name: 'Bhagat', rotate_monthly: 1, revision: 1 }];

test('monthly rotation uses calendar boundaries, including year rollover and shift starting date', () => {
  for (const [date, day, night] of [
    ['2026-09-18', 1, 2], ['2026-09-30', 1, 2], ['2026-10-01', 2, 1],
    ['2026-11-01', 1, 2], ['2026-12-31', 2, 1], ['2027-01-01', 1, 2],
  ]) {
    assert.equal(resolveRotation(rotations, 'day', date).contractor_id, day);
    assert.equal(resolveRotation(rotations, 'night', date).contractor_id, night);
  }
  assert.equal(resolveRotation(rotations, 'day', '2026-09-17'), undefined);
});

test('mid-month change resets the rotation anchor and never rewrites earlier ownership', () => {
  const rules = [...rotations, { ...rotations[0], effective_from: '2026-10-15', day_contractor_id: 1, night_contractor_id: 2 }];
  assert.equal(resolveRotation(rules, 'day', '2026-10-14').contractor_id, 2);
  assert.equal(resolveRotation(rules, 'day', '2026-10-15').contractor_id, 1);
  assert.equal(resolveRotation(rules, 'day', '2026-11-01').contractor_id, 2);
  assert.equal(resolveRotation([{ ...rotations[0], rotate_monthly: 0 }], 'day', '2027-10-01').contractor_id, 1);
  assert.equal(resolveRotation(rotations, 'day', '2026-10-01', { effective_from: '2026-09-20', contractor_id: 9 }).contractor_id, 9);
});

test('month report attributes each date using rotation and includes zero-production contractors', async () => {
  const f = fixture({ rotations, contractors: [{ id: 1, name: 'Bintu' }, { id: 2, name: 'Bhagat' }, { id: 3, name: 'C' }], rows: [
    { shift_date: '2026-10-01', shift_name: 'day', qty: '5', gi_kg: '535', ms_kg: '500', entry_count: 1 },
    { shift_date: '2026-10-01', shift_name: 'night', qty: '10', gi_kg: '1070', ms_kg: '1000', entry_count: 2 },
  ] });
  f.req.query = { month: '2026-10' };
  await f.controller.getContractorReport(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  const result = f.res.body.data;
  assert.equal(result.from, '2026-10-01'); assert.equal(result.to, '2026-10-31');
  assert.equal(result.shifts[0].contractor_name, 'Bhagat');
  assert.equal(result.shifts[1].contractor_name, 'Bintu');
  assert.equal(result.summaries.find(row => row.contractor_id === 1).gi_kg, 1070);
  assert.equal(result.summaries.find(row => row.contractor_id === 3).gi_kg, 0);
});

test('past month outside selected FY works, including leap February', async () => {
  const f = fixture(); f.req.query = { month: '2024-02' };
  await f.controller.getContractorReport(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  assert.equal(f.res.body.data.to, '2024-02-29');
});

test('invalid month is rejected before database access', async () => {
  const f = fixture(); f.req.query = { month: '2026-13' };
  await f.controller.getContractorReport(f.req, f.res);
  assert.equal(f.res.statusCode, 400); assert.equal(f.calls.length, 0);
});

const rotationBody = { effective_from: '2026-09-18', day_contractor_id: 1, night_contractor_id: 2, rotate_monthly: true, expected_revision: null };
test('both assignments save atomically and notify after commit', async () => {
  const f = fixture(); f.req.body = rotationBody;
  await f.controller.saveRotation(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  const write = f.calls.find(call => call.sql?.startsWith('INSERT INTO contractor_rotations'));
  assert.deepEqual(Array.from(write.params), ['2026-09-18', 1, 2, 1, 2]);
  assert.ok(f.calls.indexOf('emit') > f.calls.indexOf('commit'));
  assert.equal(f.calls.at(-1), 'release');
});

test('rotation revision prevents concurrent overwrites', async () => {
  const f = fixture({ existing: { id: 4, revision: 2 } });
  f.req.body = { ...rotationBody, expected_revision: 1 };
  await f.controller.saveRotation(f.req, f.res);
  assert.equal(f.res.statusCode, 409);
  assert.ok(f.calls.includes('rollback')); assert.ok(!f.calls.includes('emit'));
});

test('editing a rotation updates both shifts and increments its revision', async () => {
  const f = fixture({ existing: { id: 4, revision: 2 } });
  f.req.body = { ...rotationBody, expected_revision: 2, rotate_monthly: false };
  await f.controller.saveRotation(f.req, f.res);
  assert.equal(f.res.statusCode, 200);
  assert.ok(f.calls.some(call => call.sql?.includes('revision = revision + 1')));
});

for (const invalid of [{ night_contractor_id: 1 }, { effective_from: '2026-02-30' }, { rotate_monthly: 'true' }, { expected_revision: undefined }]) {
  test(`invalid rotation rejected: ${JSON.stringify(invalid)}`, async () => {
    const f = fixture(); f.req.body = { ...rotationBody, ...invalid };
    await f.controller.saveRotation(f.req, f.res);
    assert.equal(f.res.statusCode, 400); assert.equal(f.calls.length, 0);
  });
}
