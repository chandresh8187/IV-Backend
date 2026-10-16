const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, PDFName } = require('pdf-lib');
const { PDFParse } = require('pdf-parse');
const { cases } = require('./fixtures/pdfReports');
const { COMPANY_NAME, COMPANY_ADDRESS_LINES } = require('../services/pdf/reportBranding');

for (const report of cases) test(`${report.key}: company name, full address and logo on every page`, async () => {
  const bytes = await report.generate();
  const pdf = await PDFDocument.load(bytes), parser = new PDFParse({data:bytes});
  try {
    const { pages } = await parser.getText();
    assert.equal(pages.length, pdf.getPageCount());
    for (const [index, page] of pages.entries()) {
      assert.ok(page.text.includes(COMPANY_NAME), `name missing on page ${index+1}`);
      for (const line of COMPANY_ADDRESS_LINES) assert.ok(page.text.includes(line), `address missing on page ${index+1}`);
      const resources = pdf.getPage(index).node.Resources();
      const objects = resources.lookup(PDFName.of('XObject'));
      const images = objects?.entries().filter(([,ref]) => pdf.context.lookup(ref).dict?.get(PDFName.of('Subtype'))?.toString() === '/Image') || [];
      assert.ok(images.length, `logo image missing on page ${index+1}`);
    }
    if (report.key === 'monthly') {
      assert.ok(pages.some(page=>page.text.includes('DETAIL-END')), 'long planning details must not be truncated');
      assert.ok(pages.some(page=>page.text.includes('INV-001')));
      assert.ok(pages.some(page=>page.text.includes('INV-002')));
      for (const [i,page] of pages.entries()) assert.ok(page.text.includes(`Page ${i+1} of ${pages.length}`), 'monthly page numbering must span zinc appendix');
    }
  } finally { await parser.destroy(); }
});
