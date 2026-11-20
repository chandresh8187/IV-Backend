const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PDFParse } = require('pdf-parse');
const { generateMonthlyDetailPdf } = require('../services/pdf/monthlyDetailPdfGenerator');

const report = {
  period: { label: 'October 2026', from: '2026-10-01', to: '2026-10-31' },
  financial_year: { id: 1, name: '2026-27' },
  planning: [{ id: 1, challan_no: 'CHALLAN-OCT-001', party_name: 'Sample engineering works', material_description: 'Structural steel angle with extended material description for wrapping', planned_qty: 1000, produced_qty: 750, status: 'pending' }],
  materials: [{ material: 'MATERIAL-ANGLE-001', quantity: 750, entry_count: 15, ms_kg: 15000, gi_kg: 15750 }],
  zinc_movements: [{ id: 1, movement_type: 'transfer', transaction_date: '2026-10-27', transaction_time: '14:35', created_at: '2026-11-01 10:00:00', amount_kg: 1000, plant_after_kg: 9000, kettle_after_kg: 4000, batch_allocations: [{ receipt_id: 2, lot_key: 'receipt:2', batch_number: 'ZINC-BATCH-001', invoice_number: 'ZINC-INVOICE-001', amount_kg: 1000 }] }],
  zinc_purchases: [{ id: 2, movement_type: 'receive', transaction_date: '2026-10-20', transaction_time: '10:00', created_at: '2026-10-20 10:00:00', amount_kg: 1000, zinc_rate_per_kg: 300, invoice_number: 'PURCHASE-INVOICE-001', batch_number: 'PURCHASE-BATCH-001' }],
};

test('each standalone monthly PDF has its month, selected list and no unrelated list', async () => {
  const dir = path.join(__dirname, '../tmp/pdfs/monthly-details');
  fs.mkdirSync(dir, { recursive: true });
  for (const type of ['zinc', 'planning', 'materials', 'purchases']) {
    const bytes = await generateMonthlyDetailPdf(report, type);
    fs.writeFileSync(path.join(dir, `${type}.pdf`), bytes);
    const parser = new PDFParse({ data: bytes });
    try {
      const { text } = await parser.getText();
      assert.match(text, /October 2026/);
      assert.match(text, /2026-27/);
      if (type === 'zinc') {
        assert.match(text, /ZINC-INVOICE-001/);
        assert.match(text, /27\/10\/2026\s+14:35/);
      } else assert.doesNotMatch(text, /ZINC-INVOICE-001/);
      if (type === 'planning') assert.match(text, /CHALLAN-OCT-001/);
      else assert.doesNotMatch(text, /CHALLAN-OCT-001/);
      if (type === 'materials') assert.match(text, /MATERIAL-ANGLE-001/);
      else assert.doesNotMatch(text, /MATERIAL-ANGLE-001/);
      if (type === 'purchases') assert.ok(text.replace(/\s/g, '').includes('PURCHASE-INVOICE-001'));
      else assert.ok(!text.replace(/\s/g, '').includes('PURCHASE-INVOICE-001'));
    } finally { await parser.destroy(); }
  }
});

test('empty lists export a readable PDF and long lists include the final row', async () => {
  for (const type of ['zinc', 'planning', 'materials']) {
    const bytes = await generateMonthlyDetailPdf({ ...report, planning: [], materials: [], zinc_movements: [] }, type);
    const parser = new PDFParse({ data: bytes });
    try { assert.match((await parser.getText()).text, /No (records|zinc stock transactions)/i); }
    finally { await parser.destroy(); }
  }
  const bytes = await generateMonthlyDetailPdf({ ...report, planning: Array.from({ length: 100 }, (_, i) => ({ ...report.planning[0], challan_no: `CHALLAN-${i + 1}` })) }, 'planning');
  const parser = new PDFParse({ data: bytes });
  try { assert.match((await parser.getText()).text, /CHALLAN-100/); }
  finally { await parser.destroy(); }
});

test('unknown report types fail before querying the database', async () => {
  await assert.rejects(generateMonthlyDetailPdf(report, 'constructor'), /valid monthly report list/);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/monthlyReportController.js'), 'utf8'), {
    module, console, require: name => name === '../config/db' ? { query() { throw Error('Database must not be queried'); } }
      : name === '../services/pdf/monthlyDetailPdfGenerator' ? require('../services/pdf/monthlyDetailPdfGenerator') : {},
  });
  const res = { status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await module.exports.downloadMonthlyDetailPdf({ params: { type: 'unknown' }, query: {} }, res);
  assert.equal(res.code, 400);
});
