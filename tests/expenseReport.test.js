const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calculateExpenseReport, validateExpenseSettings } = require('../services/expenseReportService');
const { validateMigrationSql } = require('../scripts/migrationSafety');

const settings = {
  rate_per_ton: 1000, staff_salary: 500, hardware_expense: 100,
  maintenance_expense: 200, zinc_spray_expense: 300, electricity_per_day: 400,
  gas_bottle_rate: 10, chemicals_per_day: 600, ms_wire_per_day: 700,
  rent_expense: 800, acid_expense: 900, crane_expense: 1000, other_expense: 1100,
};

test('expense report calculates daily costs, recovery and running cost', () => {
  const result = calculateExpenseReport({
    settings,
    production: { total_ms_kg: 100000, total_gi_kg: 107000, production_days: 10 },
    stock: { plant_kg: 7000 }, purchasedZincKg: 47817, recoveredZincKg: 220,
  });
  assert.equal(result.expenses.salary_per_day, 10500);
  assert.equal(result.expenses.gas_per_day, 8500);
  assert.equal(result.totals.total_expense, 25100);
  assert.equal(result.totals.average_ms_production_per_day_kg, 10000);
  assert.equal(result.totals.net_zinc_consumed_kg, 6780);
  assert.equal(result.totals.average_zinc_consumption_percent, 6.78);
  assert.equal(result.totals.running_plant_cost, 2.51);
  assert.equal(result.totals.plant_zinc_stock_kg, 7000);
  assert.equal(result.totals.purchased_zinc_kg, 47817);
});

test('zero production produces stable zero averages without invalid numbers', () => {
  const result = calculateExpenseReport({ settings, production: {}, stock: {} });
  assert.equal(result.totals.running_plant_cost, 0);
  assert.equal(result.totals.average_zinc_consumption_percent, 0);
  assert.equal(result.expenses.salary_per_day, 500);
});

test('expense settings require all non-negative currency values', () => {
  assert.deepEqual(validateExpenseSettings(settings), settings);
  assert.throws(() => validateExpenseSettings({ ...settings, acid_expense: -1 }), /zero or a positive/);
  assert.throws(() => validateExpenseSettings({ ...settings, acid_expense: '' }), /every expense/);
});

test('expense settings migration is additive and safe', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/versioned/20260921000400_create_expense_settings.sql'), 'utf8');
  assert.doesNotThrow(() => validateMigrationSql(sql));
});
