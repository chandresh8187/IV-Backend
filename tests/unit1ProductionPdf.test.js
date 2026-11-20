const test = require('node:test'), assert = require('node:assert/strict');
const { PDFParse } = require('pdf-parse');
const { PDFDocument, PDFName } = require('pdf-lib');
const { productionReport } = require('../services/unit1ProductionReport');
const { generateProductionPdf, generateJobCardPdf } = require('../services/pdf/unit1ProductionPdfGenerator');

const entries = Array.from({ length: 60 }, (_, i) => ({
  id: 60 - i, createdAt: '2026-10-19T08:30:00+05:30', bundleNo: 60 - i, pieces: 100, theoreticalUsedKg: 120.25, holeScrapKg: 1.5,
  shift: 'day', jobCardId: 17, memberName: 'Column L-2300', sectionSize: '150 x 65 x 20', customerName: 'Sample customer',
  projectName: 'Solar mounting structure', materialType: 'MS', machineName: 'Column line 1', coilInternalId: 'COIL-001', coilNumber: 1, enteredByName: 'Sample operator',
}));
const job = { id: 17, jobDate: '2026-10-19', status: 'open', customerName: 'Sample customer', projectNameCapacity: 'Solar mounting structure', memberName: 'Column L-2300', structureType: 'solar_mounting_structure', sectionSize: '150 x 65 x 20', cutLengthMm: 2300, productionQty: 6000, producedPieces: 1200, materialType: 'MS', coilWidthMm: 254, coilThicknessMm: 3, plannedMachineName: 'Column line 1', shift: 'day', holes: Array.from({ length: 45 }, (_, i) => ({ sequenceNo: i + 1, punchSize: i % 2 ? '9x20' : '12x20', profile: i % 2 ? 'l_flange' : 'web', targetMm: 50 + i * 50 })) };

test('production export uses the full filtered dataset beyond the table page and rejects oversized reports', async () => {
  let sql, params;
  const report = await productionReport({ execute: async (s, p) => { sql = s; params = p; return [entries]; } }, { date: '2026-10-19', shift: 'day', machineId: '1' });
  assert.deepEqual(params, ['2026-10-19', 'day', 1]);
  assert.match(sql, /ORDER BY b.created_at DESC,b.id DESC LIMIT 2001/);
  assert.doesNotMatch(sql, /OFFSET/);
  assert.equal(report.entries.length, 60);
  assert.equal(report.summary.coilUsedKg, 7215);
  assert.equal(report.summary.productionKg, 7125);
  await assert.rejects(productionReport({ execute: async () => [Array(2001).fill(entries[0])] }, { date: '2026-10-19' }), { status: 400 });
  await assert.rejects(productionReport({}, { date: '2026-10-19', shift: 'invalid' }), { status: 400 });
  await assert.rejects(productionReport({}, { date: '2026-02-30' }), { status: 400 });
});

test('production and job card PDFs retain all rows, repeated headers and company identity on every page', async () => {
  const report = await productionReport({ execute: async () => [entries] }, { date: '2026-10-19', shift: 'day' });
  const samples = [
    { name: 'unit1-production-report-sample', bytes: await generateProductionPdf(report), expected: ['U1-PL-17 / #60', 'U1-PL-17 / #1', '7215.000 kg', 'Other scrap: Not recorded'], heading: 'Customer / Project' },
    { name: 'unit1-job-card-sample', bytes: await generateJobCardPdf(job), expected: ['Column L-2300', 'PUNCH - A', 'PUNCH - B', '12*20', '9*20', 'L FLANGE', 'WEB', 'DIMENSION MM', '2250', 'Prepared by:'], heading: 'PUNCH SIZE' },
  ];
  for (const sample of samples) {
    const pdf = await PDFDocument.load(sample.bytes), parser = new PDFParse({ data: sample.bytes });
    try {
      const { pages, text } = await parser.getText();
      if (sample.name === 'unit1-job-card-sample') {
        assert.doesNotMatch(text, /Produced \(NOS\)/);
        assert.match(text, /Production quantity \(NOS\)/);
        assert.match(text, /6000/);
      }
      assert.ok(pages.length >= (sample.name === 'unit1-job-card-sample' ? 1 : 2));
      for (const expected of sample.expected) assert.ok(text.includes(expected), expected);
      for (const [index, page] of pages.entries()) {
        assert.ok(page.text.includes('IV SQUARE STRUCTURE INDIA PVT LTD'));
        assert.ok(page.text.includes('Dist : Rajkot-360024'));
        assert.ok(page.text.includes(`Page ${index + 1} of ${pages.length}`));
        assert.ok(pdf.getPage(index).node.Resources().lookup(PDFName.of('XObject')).entries().length);
        if (index > 0) assert.ok(page.text.includes(sample.heading));
      }
    } finally { await parser.destroy(); }
  }
});
