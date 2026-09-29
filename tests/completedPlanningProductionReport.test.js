const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(status = 'completed') {
  const queries = [];
  const reports = [];
  const rows = [
    { id: 10, shift_date: '2026-09-25', challan_no: 'CH-7', material: 'Pipe', dipping_qty: 10 },
    { id: 20, shift_date: '2026-09-29', challan_no: 'CH-7', material: 'Pipe', dipping_qty: 20 },
  ];
  const db = { query: async (sql, params) => {
    queries.push({ sql, params });
    if (sql.includes('FROM production_planning_items ppi JOIN production_planning')) return [[{ id: 7, planning_id: 3, status, challan_no: 'CH-7' }]];
    if (sql.includes('SELECT\n        pe.id')) return [rows];
    if (sql.includes('AS total_ms_production_kg')) return [[{ total_ms_production_kg: 300, total_gi_production_kg: 321 }]];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../controllers/productionReportController.js'), 'utf8'), {
    module, Buffer, console,
    require: name => name === '../config/db' ? db : name === '../services/pdf/productionPdfGenerator'
      ? { generateProductionPdf: async input => { reports.push(input); return Buffer.from('%PDF-test'); } } : require(name),
  });
  const res = { code: 200, headers: {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader(key, value) { this.headers[key] = value; }, end(buffer) { this.buffer = buffer; return this; } };
  return { run: () => module.exports.generateCompletedPlanningItemReport({ params: { itemId: '7' } }, res), res, queries, reports };
}

test('completed challan PDF includes all linked dates and filters sibling planning items', async () => {
  const f = fixture();
  await f.run();
  assert.equal(f.res.code, 200);
  assert.equal(f.reports[0].tableData.length, 2);
  assert.equal(f.reports[0].date, '2026-09-25 to 2026-09-29');
  assert.match(f.queries[1].sql, /pe\.planning_item_id = \?/);
  assert.deepEqual(Array.from(f.queries[1].params), [7, 3, 'CH-7', 3]);
  assert.equal(f.res.headers['Content-Type'], 'application/pdf');
});

test('production PDF stays unavailable until the planning item is completed', async () => {
  const f = fixture('pending');
  await f.run();
  assert.equal(f.res.code, 409);
  assert.equal(f.reports.length, 0);
});
