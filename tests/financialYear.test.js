const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// No database connection: tests exercise the service and HTTP boundary in isolation.
const dbPath = require.resolve('../config/db');
let rows;
const queries = [];
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  query: async (sql, params) => { queries.push({ sql, params }); return [rows]; },
} };
const { getConfiguredCurrentFinancialYear, currentHistoryYear } = require('../services/financialYearService');
beforeEach(() => { rows = [{ id: 3, financial_year: '2025-26' }]; queries.length = 0; });

test('selected year wins over calendar year and exposes inclusive April–March dates', async () => {
  const year = await getConfiguredCurrentFinancialYear();
  assert.equal(year.id, 3);
  assert.equal(year.start_date, '2025-04-01');
  assert.equal(year.end_date, '2026-03-31');
  assert.match(queries[0].sql, /NOT EXISTS/);
  assert.match(queries[0].sql, /current_financial_year WHERE id = 1/);
});
test('selection changes are read fresh without a stale setting cache', async () => {
  await getConfiguredCurrentFinancialYear();
  rows = [{ id: 4, financial_year: '2026-27' }];
  assert.equal((await getConfiguredCurrentFinancialYear()).start_date, '2026-04-01');
});
test('unconfigured current year fails clearly', async () => {
  rows = [];
  await assert.rejects(getConfiguredCurrentFinancialYear(), { status: 409, code: 'CURRENT_FINANCIAL_YEAR_NOT_CONFIGURED' });
});
for (const date of ['2025-04-01', '2026-03-31']) {
  test(`history permits boundary ${date}`, async () => {
    let continued = false;
    const req = { path: '/date-summary', query: { date } };
    await currentHistoryYear(req, {}, () => { continued = true; });
    assert.equal(continued, true);
    assert.equal(req.financialYear.id, 3);
  });
}
for (const date of ['2025-03-31', '2026-04-01']) {
  test(`history blocks dates from another financial year: ${date}`, async () => {
    let status;
    let result;
    const res = { status(value) { status = value; return this; }, json(value) { result = value; } };
    await currentHistoryYear({ path: '/shift-table', query: { date } }, res, () => assert.fail('Must not continue'));
    assert.equal(status, 409);
    assert.equal(result.code, 'DATE_OUTSIDE_CURRENT_FINANCIAL_YEAR');
  });
}
test('challan reports keep their lifetime scope, independent of active archive year', async () => {
  let continued = false;
  await currentHistoryYear({ path: '/report', query: { type: 'challan' } }, {}, () => { continued = true; });
  assert.equal(continued, true);
  assert.equal(queries.length, 0);
});

test('set-current persists one selection and broadcasts the new year', async () => {
  const { setCurrentFinancialYear } = require('../controllers/financialYearsController');
  const events = [];
  let result;
  const req = { params: { id: '3' }, app: { get: () => ({ emit: (...args) => events.push(args) }) } };
  const res = { json(value) { result = value; }, status() { return this; } };
  await setCurrentFinancialYear(req, res);
  assert.equal(result.success, true);
  assert.equal(result.data.id, 3);
  assert.ok(queries.some(query => /INSERT INTO current_financial_year/.test(query.sql) && query.params[0] === 3));
  assert.equal(events[0][0], 'financial_years_updated');
  assert.equal(events[0][1].action, 'current_changed');
});
test('invalid year selection performs no database writes', async () => {
  const { setCurrentFinancialYear } = require('../controllers/financialYearsController');
  let status;
  const res = { status(value) { status = value; return this; }, json() {} };
  await setCurrentFinancialYear({ params: { id: 'not-an-id' } }, res);
  assert.equal(status, 400);
  assert.equal(queries.length, 0);
});
