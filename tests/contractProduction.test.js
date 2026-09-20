const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { DateTime } = require('luxon');

function fixture(rows = []) {
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../controllers/contractProductionController'), 'utf8'), {
    module, console, require: name => name === '../config/db' ? {
      query: async (sql, params) => { calls.push({ sql, params }); return [rows]; },
    } : { DateTime },
  });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  const req = { financialYear: { id: 3, financial_year: '2023-24', start_date: '2023-04-01', end_date: '2024-03-31' }, query: {} };
  return { run: module.exports.getContractProduction, calls, req, res };
}
test('sums explicit contractor results, retains zero-output contractors and ignores legacy assignments', async () => {
  const f = fixture([
    { contractor_id: 1, contractor_name: 'Bhagat', entry_count: '2', qty: '5', ms_kg: '80', gi_kg: '88' },
    { contractor_id: 2, contractor_name: 'Bintu', entry_count: '1', qty: '2', ms_kg: '30', gi_kg: '33' },
    { contractor_id: 3, contractor_name: 'Other', entry_count: '0', qty: '0', ms_kg: '0', gi_kg: '0' },
  ]);
  f.req.query.month = '9';
  await f.run(f.req, f.res);
  assert.equal(f.res.body.data.totals.ms_kg, 110);
  assert.equal(f.res.body.data.totals.gi_kg, 121);
  assert.equal(f.res.body.data.totals.qty, 7);
  assert.equal(f.res.body.data.summaries.length, 3);
  const sql = f.calls[0].sql;
  assert.match(sql, /LEFT JOIN production_entries pe ON pe.contractor_id = c.id/);
  assert.match(sql, /COALESCE\(pe.ms_weight, 0\) \* COALESCE\(pe.dipping_qty, 0\)/);
  assert.match(sql, /COALESCE\(pe.row_type, 'entry'\) = 'entry'/);
  assert.doesNotMatch(sql, /rotations|shift_assignments/);
});
test('all 12 months stay in the configured financial year, including leap February', async () => {
  for (let month = 1; month <= 12; month++) {
    const f = fixture(); f.req.query.month = String(month);
    await f.run(f.req, f.res);
    const data = f.res.body.data;
    assert.ok(data.from >= '2023-04-01' && data.to <= '2024-03-31');
    assert.equal(data.from.slice(0, 4), month < 4 ? '2024' : '2023');
    if (month === 2) assert.equal(data.to, '2024-02-29');
  }
});
test('invalid months and stale year are rejected without querying production', async () => {
  for (const month of ['0', '13', '1.5', 'abc', '', '2026-09']) {
    const f = fixture(); f.req.query.month = month;
    await f.run(f.req, f.res); assert.equal(f.res.code, 400); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.req.query.financial_year_id = '99';
  await f.run(f.req, f.res); assert.equal(f.res.code, 409); assert.equal(f.calls.length, 0);
});
