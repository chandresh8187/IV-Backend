const { PDFDocument, StandardFonts } = require('pdf-lib');
const { loadCompanyLogo, drawReportFooters } = require('./reportBranding');
const { createReportLayout } = require('./reportLayout');
const fmt = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const money = value => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = value => String(value || '').slice(0, 10).split('-').reverse().join('/');

async function generateZincPurchasePdf(rows = [], { scopeLabel = 'All recorded zinc purchases', includeFooter = true } = {}) {
  const pdf = await PDFDocument.create();
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const logo = await loadCompanyLogo(pdf);
  const layout = createReportLayout(pdf, fonts, logo, { title: 'ZINC PURCHASE', subtitle: scopeLabel, borderedTables: true });
  layout.addPage();
  layout.metrics([['Purchases', fmt(rows.length)], ['Purchased zinc', `${fmt(rows.reduce((sum, row) => sum + Number(row.amount_kg), 0))} kg`], ['Purchase value', `Rs ${money(rows.reduce((sum, row) => sum + Number(row.amount_kg) * Number(row.zinc_rate_per_kg), 0))}`]], 3);
  layout.table('PURCHASE TRANSACTIONS', [
    { title: 'Date', key: 'transaction_date', weight: 1.2, format: date },
    { title: 'Time (IST)', key: 'transaction_time', weight: .8, align: 'center' },
    { title: 'Qty (kg)', key: 'amount_kg', weight: 1, align: 'center', format: fmt },
    { title: 'Rate / kg (Rs)', key: 'zinc_rate_per_kg', weight: 1.1, align: 'center', format: money },
    { title: 'Value (Rs)', key: 'value', weight: 1.3, align: 'center', format: (_value, row) => money(Number(row.amount_kg) * Number(row.zinc_rate_per_kg)) },
    { title: 'Batch', key: 'batch_number', weight: 1.3 },
    { title: 'Invoice', key: 'invoice_number', weight: 1.4 },
    { title: 'Note', key: 'note', weight: 1.7 },
  ], rows);
  if (includeFooter) drawReportFooters(pdf, fonts, 'Zinc purchases | Quantities in kg | Times IST');
  return Buffer.from(await pdf.save());
}
module.exports = { generateZincPurchasePdf };
