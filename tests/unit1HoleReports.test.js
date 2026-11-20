const test = require('node:test'), assert = require('node:assert/strict');
const { validateInspection, snapshotInspection, reportDateRange, machineHoleReport } = require('../services/unit1HoleReports');
const { generateHoleCheckPdf, ADDRESS } = require('../services/pdf/unit1HoleCheckPdfGenerator');
const { PDFParse } = require('pdf-parse');
const { PDFDocument, PDFName } = require('pdf-lib');
const { newestInspectionsFirst } = require('../services/unit1InspectionOrder');
test('inspections sort by newest time then descending ID without changing hole order or input', () => {
  const checks = [
    { id: 1, checkedAt: '2026-10-18 10:00:00' },
    { id: 2, checkedAt: '2026-10-18T05:30:00Z' },
    { id: 3, checkedAt: new Date('2026-10-18T05:30:00Z'), measurements: [{ sequenceNo: 1 }, { sequenceNo: 2 }] },
  ];
  const sorted = newestInspectionsFirst(checks);
  assert.deepEqual(sorted.map(check => check.id), [3, 2, 1]);
  assert.deepEqual(checks.map(check => check.id), [1, 2, 3]);
  assert.deepEqual(sorted[0].measurements.map(hole => hole.sequenceNo), [1, 2]);
});
const input = { approved: true, requestKey: 'hc_test_12345', remarks: 'Checked', measurements: [{ holeId: 1, measuredMm: '0' }, { holeId: 2, measuredMm: '500.25' }] };
test('measurements reject missing, duplicate, negative, nonfinite and excessive precision values', () => {
  assert.equal(validateInspection(input).measurements[0].measuredMm, 0);
  for (const value of ['', null, undefined, -1, '1.001', 'NaN', 'Infinity', '1e3', '1000001']) assert.throws(() => validateInspection({ ...input, measurements: [{ holeId: 1, measuredMm: value }] }), { status: 400 });
  assert.throws(() => validateInspection({ ...input, measurements: [input.measurements[0], input.measurements[0]] }), { status: 400 });
  assert.equal(validateInspection(input).requestHash, validateInspection({ ...input, measurements: [...input.measurements].reverse() }).requestHash);
  assert.notEqual(validateInspection(input).requestHash, validateInspection({ ...input, remarks: 'Different' }).requestHash);
});
test('date filtering follows local DATETIME inspection timestamps', () => {
  assert.deepEqual(reportDateRange('2026-10-18'), { date: '2026-10-18', start: '2026-10-18 00:00:00', end: '2026-10-19 00:00:00' });
  for (const date of ['2026-02-30', '2026-10-18x', "2026-10-18'", '']) assert.throws(() => reportDateRange(date), { status: 400 });
});
const holes = [{ id: 1, punchSize: '12x20', profile: 'web', targetMm: 100 }, { id: 2, punchSize: '12x20', profile: 'l_flange', targetMm: 500 }, { id: 3, punchSize: '9x20', profile: 'r_flange', targetMm: 1000 }];
const snapshot = snapshotInspection({ machineName: 'Column line', machineCode: 'M01', jobCardId: 7, sectionSize: '150 x 65 x 20', cutLengthMm: 2300, memberName: 'Column L-2300', productType: 'solar_mounting_structure', grade: 'E350', materialType: 'MS', widthMm: 254, thicknessMm: 3, coilNumber: 1, customerName: 'Sample customer' }, holes, new Map([[1, 100.1], [2, 500], [3, 999.8]]), { name: 'day', shiftDate: '2026-10-18' }, 'Sample inspector');
test('snapshot retains job context and assigns one letter to each distinct punch size', () => {
  assert.deepEqual(snapshot.measurements.map(row => row.punchLetter), ['A', 'A', 'B']);
  assert.equal(snapshot.measurements[0].measuredMm, 100.1);
  assert.equal(snapshot.customerName, 'Sample customer');
});
test('report reads stored inspection snapshots instead of later job changes', async () => {
  let calls = 0;
  const db = { execute: async () => calls++ === 0 ? [[{ id: 1, name: 'Renamed machine', code: 'NEW' }]] : [[{ total: 1 }]], query: async () => [[{ id: 2, checkedAt: new Date(), checkType: 'recheck', customerName: 'Changed customer', reportSnapshot: JSON.stringify(snapshot) }]] };
  const report = await machineHoleReport(db, { machineId: 1, date: '2026-10-18' });
  assert.equal(report.checks[0].customerName, 'Sample customer');
  assert.equal(report.checks[0].machineName, 'Column line');
});

test('date history includes every machine with one global newest-first page', async () => {
  const queries = [];
  const rows = [
    { id: 20, machineId: 1, machineName: 'Current line 1', checkedAt: '2026-10-18 13:00:00', reportSnapshot: JSON.stringify({ ...snapshot, machineName: 'Column line' }) },
    { id: 21, machineId: 2, machineName: 'Current line 2', checkedAt: '2026-10-18 14:00:00', reportSnapshot: JSON.stringify({ ...snapshot, machineName: 'Purlin line' }) },
  ];
  const db = {
    execute: async (sql, args) => { queries.push({ sql, args }); return [[{ total: 41 }]]; },
    query: async (sql, args) => { queries.push({ sql, args }); return [rows]; },
  };
  const report = await machineHoleReport(db, { date: '2026-10-18', page: 2 });
  assert.equal(report.total, 41);
  assert.equal(report.pageSize, 20);
  assert.deepEqual(report.checks.map(check => check.machineId), [2, 1]);
  assert.deepEqual(report.checks.map(check => check.machineName), ['Purlin line', 'Column line']);
  for (const { sql, args } of queries) {
    assert.doesNotMatch(sql, /WHERE r\.machine_id=\?/);
    assert.deepEqual(args.slice(0, 2), ['2026-10-18 00:00:00', '2026-10-19 00:00:00']);
  }
  assert.match(queries[1].sql, /ORDER BY hc\.checked_at DESC,hc\.id DESC LIMIT \? OFFSET \?/);
  assert.deepEqual(queries[1].args.slice(-2), [20, 20]);
});
test('PDF keeps branding, Unit 1 address, all measurements and repeated table headings', async () => {
  const checks = [{ ...snapshot, id: 1, checkType: 'first_piece', checkedAt: '2026-10-18T04:30:00Z', remarks: 'Verified sample readings' }, { ...snapshot, id: 2, checkType: 'recheck', checkedAt: '2026-10-18T05:30:00Z', remarks: 'Long inspection - all rows retained', measurements: Array.from({ length: 65 }, (_, i) => ({ ...snapshot.measurements[i % 3], sequenceNo: i + 1, targetMm: 100 + i, measuredMm: 100 + i + .1 })) }];
  const bytes = await generateHoleCheckPdf({ machine: { id: 1, name: 'Column line', code: 'M01' }, date: '2026-10-18', checks });
  const pdf = await PDFDocument.load(bytes), parser = new PDFParse({ data: bytes });
  try {
    const { pages, text } = await parser.getText();
    assert.ok(pages[0].text.includes('Inspection #2'));
    assert.ok(text.indexOf('Inspection #2') < text.indexOf('Inspection #1'));
    assert.ok(pages.length >= 3); assert.match(text, /164.10/); assert.match(text, /Punch B/);
    for (const [index, page] of pages.entries()) {
      assert.ok(page.text.includes('IV SQUARE STRUCTURE INDIA PVT LTD'));
      for (const line of ADDRESS) assert.ok(page.text.includes(line));
      assert.ok(page.text.includes(`Page ${index + 1} of ${pages.length}`));
      assert.ok(page.text.includes('Measured (mm)'));
      assert.ok(pdf.getPage(index).node.Resources().lookup(PDFName.of('XObject')).entries().length > 0);
    }
  } finally { await parser.destroy(); }
});

test('corrected inspection PDF labels unmatched targets without replacing historical measurements with zero', async () => {
  const check = { ...snapshot, id: 30, checkedAt: '2026-10-19T10:00:00+05:30', checkType: 'recheck',
    correctionNote: 'Job card corrected. Entered measurements are unchanged. 1 revised hole has no recorded reading.',
    measurements: [{ ...snapshot.measurements[0], targetMm: null, measuredMm: 100.1 }] };
  const bytes = await generateHoleCheckPdf({ machine: { name: 'Column line', code: 'M01' }, date: '2026-10-19', checks: [check] });
  const parser = new PDFParse({ data: bytes });
  try {
    const { text } = await parser.getText();
    assert.match(text, /Unmatched/);
    assert.match(text, /100.10/);
    assert.match(text, /Entered measurements are unchanged/);
  } finally { await parser.destroy(); }
});

test('first-piece PDF includes measured cut length and section; older checks explicitly have no recorded geometry',async()=>{
  const checks=[{...snapshot,id:41,checkType:'first_piece',checkedAt:'2026-10-22T05:30:00Z',measuredCutLengthMm:2300.25,measuredSectionSize:'149.90 x 65.10 x 20'},
    {...snapshot,id:40,checkType:'first_piece',checkedAt:'2026-10-22T04:30:00Z'}];
  const bytes=await generateHoleCheckPdf({machine:{name:'Column line',code:'M01'},date:'2026-10-22',checks});
  const parser=new PDFParse({data:bytes});
  try {const {text}=await parser.getText();assert.match(text,/2300.25/);assert.match(text,/149.90 x 65.10 x 20/);assert.match(text,/0.25/);assert.match(text,/Not recorded/);}
  finally {await parser.destroy();}
});
