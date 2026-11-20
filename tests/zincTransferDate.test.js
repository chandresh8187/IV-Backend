const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildZincMovementReport } = require('../services/zincMovementReportService');
const { summarizeZincMovements } = require('../services/monthlyReportService');
const { validateMigrationSql } = require('../scripts/migrationSafety');

const ledger = [
  { id: 1, movement_type: 'initialize', amount_kg: 0, plant_after_kg: 1000, kettle_after_kg: 500, created_at: '2026-10-01 10:00:00' },
  { id: 2, movement_type: 'production_use', amount_kg: 100, plant_after_kg: 1000, kettle_after_kg: 400, created_at: '2026-10-28 10:00:00', shift_date: '2026-10-28', shift_name: 'day' },
  { id: 3, movement_type: 'receive', amount_kg: 200, plant_after_kg: 1200, kettle_after_kg: 400, created_at: '2026-11-01 09:00:00', batch_number: 'NOV-RECEIPT' },
  { id: 4, movement_type: 'transfer', amount_kg: 300, plant_after_kg: 900, kettle_after_kg: 700, created_at: '2026-11-01 10:00:00', transaction_date: '2026-10-27', transaction_time: '14:35' },
  { id: 5, movement_type: 'production_use', amount_kg: 50, plant_after_kg: 900, kettle_after_kg: 650, created_at: '2026-11-02 10:00:00', shift_date: '2026-11-02', shift_name: 'day' },
];

test('November-recorded October transfer updates October totals and November opening without double counting', () => {
  const october = buildZincMovementReport(ledger, { period: { from: '2026-10-01', to: '2026-10-31' } });
  const november = buildZincMovementReport(ledger, { period: { from: '2026-11-01', to: '2026-11-30' } });
  assert.equal(summarizeZincMovements(october.recorded_movements).transferred_to_kettle_kg, 300);
  assert.equal(summarizeZincMovements(november.recorded_movements).transferred_to_kettle_kg, 0);
  assert.deepEqual(october.closing_balance, { plant_after_kg: 700, kettle_after_kg: 700 });
  assert.deepEqual(november.opening_balance, october.closing_balance);
  assert.deepEqual(november.closing_balance, { plant_after_kg: 900, kettle_after_kg: 650 });
  const transfer = october.rows.find(row => row.id === 4);
  assert.equal(transfer.transaction_date, '2026-10-27');
  assert.equal(transfer.transaction_time, '14:35');
  assert.equal(transfer.created_at, '2026-11-01 10:00:00');
  assert.equal(transfer.batch_allocations[0].amount_kg, 300);
  assert.equal(november.recorded_movements.some(row => row.id === 4), false);
});

test('quiet following months carry corrected balances and FIFO/current ledger remain unchanged', () => {
  const december = buildZincMovementReport(ledger, { period: { from: '2026-12-01', to: '2026-12-31' } });
  assert.deepEqual(december.opening_balance, { plant_after_kg: 900, kettle_after_kg: 650 });
  assert.deepEqual(december.closing_balance, december.opening_balance);
  const legacy = ledger.map(({ transaction_date, ...row }) => row);
  assert.deepEqual(buildZincMovementReport(ledger).batch_balances, buildZincMovementReport(legacy).batch_balances);
  assert.equal(buildZincMovementReport(legacy, { period: { from: '2026-11-01', to: '2026-11-30' } }).recorded_movements.some(row => row.id === 4), true);
});

test('transfer date migration is additive', () => {
  validateMigrationSql(fs.readFileSync(path.join(__dirname, '../migrations/versioned/20261101000100_add_zinc_transfer_date.sql'), 'utf8'));
  validateMigrationSql(fs.readFileSync(path.join(__dirname, '../migrations/versioned/20261101000200_add_zinc_transfer_time.sql'), 'utf8'));
});

test('backdated receipt counts only in its selected month and corrects plant carry-forward balances', () => {
  const datedReceipt = { id: 6, movement_type: 'receive', amount_kg: 1000, plant_after_kg: 1900, kettle_after_kg: 650,
    created_at: '2026-11-03 12:00:00', transaction_date: '2026-10-27', transaction_time: '09:15', zinc_rate_per_kg: 240,
    batch_number: 'OCT-RECEIPT', invoice_number: 'OCT-123' };
  const all = [...ledger, datedReceipt];
  const oct = buildZincMovementReport(all, { period: { from: '2026-10-01', to: '2026-10-31' } });
  const nov = buildZincMovementReport(all, { period: { from: '2026-11-01', to: '2026-11-30' } });
  assert.equal(summarizeZincMovements(oct.recorded_movements).received_kg, 1000);
  assert.equal(summarizeZincMovements(nov.recorded_movements).received_kg, 200);
  assert.deepEqual(oct.closing_balance, { plant_after_kg: 1700, kettle_after_kg: 700 });
  assert.deepEqual(nov.opening_balance, oct.closing_balance);
  assert.deepEqual(nov.closing_balance, { plant_after_kg: 1900, kettle_after_kg: 650 });
  const receipt = oct.rows.find(row => row.id === 6);
  assert.equal(receipt.transaction_date, '2026-10-27');
  assert.equal(receipt.transaction_time, '09:15');
  assert.equal(receipt.batch_allocations[0].invoice_number, 'OCT-123');
});
