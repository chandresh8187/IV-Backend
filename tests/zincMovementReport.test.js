const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { zincMovementLedgerSql, buildZincMovementReport } = require('../services/zincMovementReportService');
const { normalizeMovement } = require('../services/zincStockService');
const { validateMigrationSql } = require('../scripts/migrationSafety');
const { generateZincStockPdf, reportCells } = require('../services/pdf/zincStockPdfGenerator');
const { PDFDocument } = require('pdf-lib');
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { /* Node 20 does not include SQLite. */ }

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.function('DATE_FORMAT', (value, format) => value == null ? null : String(value).slice(0, format.includes('%H') ? 19 : 10));
  db.exec(`CREATE TABLE users (id INTEGER, name TEXT);
    CREATE TABLE production_entries (id INTEGER, shift_date TEXT, shift_name TEXT);
    CREATE TABLE zinc_stock_movements (id INTEGER, movement_type TEXT, amount_kg REAL,
      zinc_rate_per_kg REAL, plant_after_kg REAL, kettle_after_kg REAL, note TEXT,
      batch_number TEXT, invoice_number TEXT, created_at TEXT, actor_user_id INTEGER,
      production_entry_id INTEGER, shift_date TEXT, shift_name TEXT);`);
  const insert = (id, type, amount, entry = null, date = null, shift = null) => db.prepare(`INSERT INTO zinc_stock_movements
    VALUES (?, ?, ?, NULL, 1000, 500, NULL, NULL, NULL, '2026-10-16 02:00:00', NULL, ?, ?, ?)`)
    .run(id, type, amount, entry, date, shift);
  return { db, insert, rows: () => buildZincMovementReport(db.prepare(zincMovementLedgerSql).all()).rows };
}

test('shift summary includes all movements before pagination and nets corrections', { skip: !DatabaseSync }, () => {
  const f = fixture();
  f.db.exec(`INSERT INTO production_entries VALUES (1, '2026-10-15', 'night'), (2, '2026-10-16', 'day');`);
  for (let n = 1; n <= 60; n++) f.insert(n, 'production_use', 1, 1);
  f.insert(61, 'production_restore', 15, 1);
  f.insert(62, 'production_use', 12, 2);
  f.insert(63, 'receive', 100);
  f.insert(64, 'transfer', 50);
  const rows = f.rows();
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(0, 2).map(r => r.movement_type), ['transfer', 'receive']);
  assert.equal(rows[3].amount_kg, 45);
  assert.equal(rows[3].transaction_date, '2026-10-15');
  assert.equal(rows[3].shift_name, 'night');
  assert.equal(rows[3].movement_count, 61);
  assert.equal(rows[3].kettle_after_kg, null);
  f.db.close();
});

test('stored shift survives deletion; unknown legacy dates remain explicit; net returns stay visible', { skip: !DatabaseSync }, () => {
  const f = fixture();
  f.insert(1, 'production_use', 12, null, '2026-10-14', 'night');
  f.insert(2, 'production_restore', 20, null, '2026-10-14', 'night');
  f.insert(3, 'production_use', 4);
  const rows = f.rows();
  assert.equal(rows[1].amount_kg, -8);
  assert.equal(rows[1].transaction_date, '2026-10-14');
  assert.equal(rows[1].shift_name, 'night');
  assert.equal(rows[0].shift_name, 'unavailable');
  assert.equal(rows[0].transaction_date, '2026-10-16');
  assert.equal(reportCells(rows[1])[2], 'Production return (net)');
  f.db.close();
});

test('receipt references are trimmed, optional for old clients, and validated', () => {
  const body = { action: 'receive', expected_revision: 1, request_id: 'receipt_test_00001', amount_kg: 5, zinc_rate_per_kg: 200 };
  const movement = normalizeMovement({ ...body, batch_number: ' B-23 ', invoice_number: ' INV/26/4 ' });
  assert.equal(movement.batch_number, 'B-23');
  assert.equal(movement.invoice_number, 'INV/26/4');
  assert.equal(normalizeMovement(body).batch_number, undefined);
  for (const value of ['X'.repeat(101), 'bad\nreference', 123, {}]) {
    assert.throws(() => normalizeMovement({ ...body, batch_number: value }), /Batch number/);
    assert.throws(() => normalizeMovement({ ...body, invoice_number: value }), /Invoice number/);
  }
});

test('new migration statements are additive and safe', () => {
  for (const name of ['20261016000100_add_zinc_receipt_references.sql', '20261016000200_preserve_zinc_movement_shift.sql']) {
    assert.doesNotThrow(() => validateMigrationSql(fs.readFileSync(path.join(__dirname, '../migrations/versioned', name), 'utf8')));
  }
});

test('PDF explains receipts, balance corrections and summaries; wraps long details across pages', async () => {
  const receipt = { movement_type: 'receive', transaction_date: '2026-10-16', amount_kg: 1000,
    batch_number: 'B'.repeat(100), invoice_number: 'INV'.repeat(33), note: 'Receipt note '.repeat(21),
    zinc_rate_per_kg: 200, plant_after_kg: 2000, kettle_after_kg: 500 };
  assert.match(reportCells(receipt)[6], /Batch: B/);
  assert.match(reportCells(receipt)[6], /Invoice: INV/);
  assert.equal(reportCells({ movement_type: 'adjust', amount_kg: 0 })[3], 'Balances set');
  const summary = { movement_type: 'production_summary', transaction_date: '2026-10-15', shift_name: 'night', amount_kg: 45 };
  assert.deepEqual(reportCells(summary).slice(0, 6), ['15/10/2026', 'Night', 'Production usage', '45 kg', '-', '-']);
  const bytes = await generateZincStockPdf([receipt, ...Array(40).fill(summary)]);
  assert.ok((await PDFDocument.load(bytes)).getPageCount() > 1);
  assert.equal((await PDFDocument.load(await generateZincStockPdf([]))).getPageCount(), 1);
});
