const test = require('node:test');
const assert = require('node:assert/strict');
const { traceZincBatches } = require('../services/zincBatchService');
const { buildZincMovementReport } = require('../services/zincMovementReportService');
const { reportCells } = require('../services/pdf/zincStockPdfGenerator');
const row = (id, type, amount, extra = {}) => ({ id, movement_type: type, amount_kg: amount,
  created_at: '2026-10-16 10:00:00', shift_date: '2026-10-16', shift_name: 'day', ...extra });
const scenario = () => [
  row(1, 'initialize', 0, { plant_after_kg: 0, kettle_after_kg: 0 }),
  row(2, 'receive', 5000, { batch_number: '123456', invoice_number: 'INV-1' }),
  row(3, 'transfer', 5000),
  row(4, 'production_use', 2000, { production_entry_id: 1, shift_date: '2026-10-15' }),
  row(5, 'receive', 3000, { batch_number: '654321', invoice_number: 'INV-2' }),
  row(6, 'transfer', 3000),
  row(7, 'production_use', 5000, { production_entry_id: 2 }),
];
const allocations = movement => movement.batch_allocations.map(b => [b.batch_number, b.invoice_number, b.amount_kg]);

test('5000 kg usage splits 3000 kg from old batch and 2000 kg from new batch through kettle transfers', () => {
  const rows = scenario();
  const first = traceZincBatches(rows.slice(0, 4));
  assert.deepEqual(allocations(first.movements[3]), [['123456', 'INV-1', 2000]]);
  assert.equal(first.batch_balances[0].remaining_kg, 3000);
  const traced = traceZincBatches(rows);
  assert.deepEqual(allocations(traced.movements.at(-1)), [['123456', 'INV-1', 3000], ['654321', 'INV-2', 2000]]);
  assert.deepEqual(traced.batch_balances.map(b => [b.batch_number, b.remaining_kg]), [['654321', 1000]]);
  const summary = buildZincMovementReport(rows).rows.find(r => r.movement_type === 'production_summary' && r.transaction_date === '2026-10-16');
  assert.equal(summary.amount_kg, 5000);
  assert.deepEqual(allocations(summary), allocations(traced.movements.at(-1)));
  assert.match(reportCells(summary)[6], /Used 3,000 kg.*Batch: 123456.*Invoice: INV-1/);
  assert.match(reportCells(summary)[6], /Used 2,000 kg.*Batch: 654321.*Invoice: INV-2/);
});

test('production edits and deletion return the original receipt allocations', () => {
  const rows = [...scenario(), row(8, 'production_restore', 2500, { production_entry_id: 2 })];
  let traced = traceZincBatches(rows);
  assert.deepEqual(allocations(traced.movements.at(-1)), [['654321', 'INV-2', -2000], ['123456', 'INV-1', -500]]);
  rows.push(row(9, 'production_restore', 2500, { production_entry_id: 2 }));
  traced = traceZincBatches(rows);
  assert.deepEqual(traced.batch_balances.map(b => [b.batch_number, b.remaining_kg]), [['123456', 3000], ['654321', 3000]]);
  rows.push(row(10, 'production_use', 3500, { production_entry_id: 3 }));
  assert.deepEqual(allocations(traceZincBatches(rows).movements.at(-1)), [['123456', 'INV-1', 3000], ['654321', 'INV-2', 500]]);
});

test('opening kettle stock does not inherit a later receipt batch; FIFO respects location', () => {
  const rows = [row(1, 'initialize', 0, { plant_after_kg: 0, kettle_after_kg: 100 }),
    row(2, 'receive', 200, { batch_number: 'NEW', invoice_number: '00123' }),
    row(3, 'production_use', 50, { production_entry_id: 1 }), row(4, 'transfer', 200),
    row(5, 'production_use', 100, { production_entry_id: 2 })];
  const traced = traceZincBatches(rows);
  assert.equal(traced.movements[2].batch_allocations[0].receipt_id, null);
  assert.match(traced.movements[2].batch_allocations[0].source_label, /Opening stock/);
  assert.deepEqual(traced.movements[4].batch_allocations.map(b => b.amount_kg), [50, 50]);
  assert.equal(traced.movements[4].batch_allocations[1].invoice_number, '00123');
});

test('monthly reports replay older receipts before filtering; returns reconcile within the recorded month', () => {
  const rows = scenario().map(r => ({ ...r, created_at: r.id < 7 ? '2026-09-30 10:00:00' : '2026-10-01 10:00:00' }));
  const report = buildZincMovementReport(rows, { period: { from: '2026-10-01', to: '2026-10-31' } });
  assert.equal(report.rows.length, 1);
  assert.equal(report.recorded_movements.length, 1);
  assert.deepEqual(allocations(report.rows[0]), [['123456', 'INV-1', 3000], ['654321', 'INV-2', 2000]]);
  const restored = [...rows, row(8, 'production_restore', 1000, { production_entry_id: 2, created_at: '2026-11-01 10:00:00' })];
  assert.equal(buildZincMovementReport(restored, { period: { from: '2026-10-01', to: '2026-10-31' } }).rows[0].amount_kg, 5000);
  assert.equal(buildZincMovementReport(restored, { period: { from: '2026-11-01', to: '2026-11-30' } }).rows[0].batch_allocations[0].amount_kg, -1000);
});

test('fractional kilograms remain exact; identical batch labels from distinct invoices remain distinct', () => {
  const rows = [row(1, 'receive', .1, { batch_number: 'SAME', invoice_number: '001' }),
    row(2, 'receive', .2, { batch_number: 'SAME', invoice_number: '002' }),
    row(3, 'transfer', .3), row(4, 'production_use', .3)];
  const result = traceZincBatches(rows);
  assert.deepEqual(allocations(result.movements.at(-1)), [['SAME', '001', .1], ['SAME', '002', .2]]);
  assert.equal(result.batch_balances.length, 0);
});

test('physical stock corrections reconcile batches and label newly found stock as unreferenced', () => {
  const rows = [row(1, 'receive', 100, { batch_number: 'A' }), row(2, 'receive', 200, { batch_number: 'B' }),
    row(3, 'adjust', 0, { plant_after_kg: 250, kettle_after_kg: 25 }), row(4, 'transfer', 250)];
  const result = traceZincBatches(rows);
  assert.deepEqual(result.movements[3].batch_allocations.map(b => [b.batch_number, b.amount_kg]), [['A', 50], ['B', 200]]);
  assert.equal(result.batch_balances.reduce((n, b) => n + b.remaining_kg, 0), 275);
  assert.ok(result.batch_balances.some(b => b.source_label === 'Stock correction (unreferenced)' && b.kettle_kg === 25));
});


test('large multi-batch PDF keeps every allocation on continuation pages', async () => {
  const { generateZincStockPdf } = require('../services/pdf/zincStockPdfGenerator');
  const { PDFParse } = require('pdf-parse');
  const batches = Array.from({length: 40}, (_, i) => ({ receipt_id: i + 1, batch_number: `BATCH-${i + 1}`, invoice_number: `INVOICE-${i + 1}`, amount_kg: 1 }));
  const bytes = await generateZincStockPdf([{ movement_type: 'production_summary', transaction_date: '2026-10-16', shift_name: 'day', amount_kg: 40, batch_allocations: batches }]);
  const parser = new PDFParse({data: bytes});
  try {
    const { text } = await parser.getText();
    assert.match(text, /Allocation continued/);
    for (const batch of batches) assert.ok(text.includes(batch.invoice_number), batch.invoice_number);
  } finally { await parser.destroy(); }
});
