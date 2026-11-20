const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { createReportLayout } = require('../services/pdf/reportLayout');

test('bordered report tables align numeric headings and values and border every cell', async () => {
  const pdf = await PDFDocument.create();
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const layout = createReportLayout(pdf, fonts, null, { title: 'TEST REPORT', subtitle: 'October 2026', borderedTables: true });
  layout.addPage();
  const page = pdf.getPages()[0];
  const rectangles = [], texts = [];
  const rectangle = page.drawRectangle.bind(page), text = page.drawText.bind(page);
  page.drawRectangle = options => { rectangles.push(options); return rectangle(options); };
  page.drawText = (value, options) => { texts.push({ value, ...options }); return text(value, options); };
  layout.table('MATERIAL PRODUCTIONS', [
    { title: 'Material', key: 'material', weight: 2 },
    { title: 'MS (kg)', key: 'ms', weight: 1, align: 'center' },
    { title: 'GI (kg)', key: 'gi', weight: 1, align: 'center' },
  ], [{ material: 'Angle', ms: 15000, gi: 15750 }, { material: 'Channel', ms: 20000, gi: 21000 }]);
  const cells = rectangles.filter(rect => rect.borderColor);
  assert.equal(cells.length, 9); // Three columns: one header plus two data rows.
  for (let col = 0; col < 3; col++) {
    assert.equal(cells[col].x, cells[col + 3].x);
    assert.equal(cells[col].width, cells[col + 3].width);
    assert.equal(cells[col].x, cells[col + 6].x);
    assert.ok(cells[col].borderWidth > 0);
  }
  const center = value => {
    const item = texts.find(entry => entry.value === value);
    assert.ok(item, `Missing text: ${value}`);
    return item.x + item.font.widthOfTextAtSize(item.value, item.size) / 2;
  };
  assert.ok(Math.abs(center('MS (kg)') - center('15000')) < .001);
  assert.ok(Math.abs(center('GI (kg)') - center('15750')) < .001);
});
