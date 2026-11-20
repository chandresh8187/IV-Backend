const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('backdated recovery is saved and counted in its transaction month, not its creation month', async () => {
  const rows = [];
  const selectedRows = params => rows.filter(row => row.transaction_date >= params[0] && row.transaction_date <= params[1]);
  const db = { query: async (sql, params = []) => {
    if (sql.includes('SELECT current_zinc_rate')) return [[{ current_zinc_rate: 300 }]];
    if (sql.includes('INSERT INTO zinc_byproduct_transactions')) {
      const fields = ['transaction_date', 'ash_weight_kg', 'ash_rate', 'ash_base_amount', 'ash_gst_amount',
        'dross_weight_kg', 'dross_rate', 'dross_base_amount', 'dross_gst_amount', 'total_with_gst',
        'zinc_rate_snapshot', 'recovered_zinc_kg', 'note', 'actor_user_id'];
      rows.push({ ...Object.fromEntries(fields.map((field, i) => [field, params[i]])), created_at: '2026-11-01 12:00:00' });
      return [{ insertId: rows.length }];
    }
    if (sql.includes('FROM zinc_byproduct_transactions')) {
      assert.match(sql, /transaction_date BETWEEN \? AND \?/);
      const filtered = selectedRows(params);
      if (sql.includes('SUM(')) return [[filtered.reduce((sum, row) => ({
        ash_weight_kg: sum.ash_weight_kg + row.ash_weight_kg,
        dross_weight_kg: sum.dross_weight_kg + row.dross_weight_kg,
        total_with_gst: sum.total_with_gst + row.total_with_gst,
        recovered_zinc_kg: sum.recovered_zinc_kg + row.recovered_zinc_kg,
      }), { ash_weight_kg: 0, dross_weight_kg: 0, total_with_gst: 0, recovered_zinc_kg: 0 })]];
      return [filtered];
    }
    if (sql.includes('SELECT COUNT(*) entry_count')) return [[{ total_ms_kg: 1000, total_gi_kg: 1100, production_days: 1 }]];
    if (sql.includes('FROM production_entries') && !sql.includes('GROUP BY')) return [[{ total_ms_kg: 1000, total_gi_kg: 1100, production_days: 1 }]];
    return [[]];
  } };
  db.getConnection = async () => ({ query: db.query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} });
  const load = filename => {
    const fullPath = path.join(__dirname, '../controllers', filename);
    const localRequire = createRequire(fullPath);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(fullPath, 'utf8'), { module, console, require: name => {
      if (name === '../config/db') return db;
      if (name.includes('/pdf/')) return {};
      if (name === '../services/financialYearService') return { getConfiguredCurrentFinancialYear: async () => ({ id: 1, start_date: '2026-04-01', financial_year: '2026-27' }) };
      return localRequire(name);
    } });
    return module.exports;
  };
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
  const byproduct = load('zincByproductController.js');
  const saved = response();
  await byproduct.createByproduct({ body: { transaction_date: '2026-10-31', ash_weight_kg: 100, ash_rate: 173, note: 'October collection' }, user: { id: 7 }, app: { get: () => ({ emit() {} }) } }, saved);
  assert.equal(saved.statusCode, 201);
  assert.equal(saved.body.data.transaction_date, '2026-10-31');
  assert.equal(saved.body.data.recovered_zinc_kg, 68.047);
  assert.equal(rows[0].actor_user_id, 7);
  assert.equal(rows[0].note, 'October collection');
  for (const [month, expected] of [['2026-10', 68.047], ['2026-11', 0]]) {
    const list = response();
    await byproduct.getByproducts({ query: { month } }, list);
    assert.equal(list.body.summary.recovered_zinc_kg, expected);
    const expenses = await load('expenseReportController.js').buildReport(month);
    assert.equal(expenses.totals.recovered_zinc_kg, expected);
    const monthly = await load('monthlyReportController.js').buildMonthlyReport({ month: Number(month.slice(5)), financialYearId: 1 });
    assert.equal(monthly.byproducts.recovered_zinc_kg, expected);
    assert.equal(monthly.expenses.totals.recovered_zinc_kg, expected);
  }
});
