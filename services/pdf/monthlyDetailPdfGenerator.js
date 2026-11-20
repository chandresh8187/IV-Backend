const { PDFDocument, StandardFonts } = require('pdf-lib');
const { loadCompanyLogo, drawReportFooters } = require('./reportBranding');
const { createReportLayout } = require('./reportLayout');
const { generateZincStockPdf } = require('./zincStockPdfGenerator');
const { generateZincPurchasePdf } = require('./zincPurchasePdfGenerator');

const detailTitles = Object.freeze({ purchases: 'Zinc Purchase', zinc: 'Zinc Transactions', planning: 'Plannings', materials: 'Material Productions' });
const fmt = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

async function generateMonthlyDetailPdf(report, type) {
  if (!Object.hasOwn(detailTitles, type)) throw Object.assign(new Error('Select a valid monthly report list.'), { status: 400 });
  const scope = `${report.period.label} | Financial year ${report.financial_year.name} | ${report.period.from} to ${report.period.to}`;
  if (type === 'purchases') return generateZincPurchasePdf(report.zinc_purchases || [], { scopeLabel: scope });
  if (type === 'zinc') return generateZincStockPdf(report.zinc_movements || [], { title: 'MONTHLY ZINC TRANSACTIONS', scopeLabel: scope, borderedTables: true });
  const pdf = await PDFDocument.create();
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const logo = await loadCompanyLogo(pdf);
  const layout = createReportLayout(pdf, fonts, logo, { title: `MONTHLY ${detailTitles[type].toUpperCase()}`, subtitle: scope, borderedTables: true });
  layout.addPage();
  if (type === 'planning') {
    const rows = report.planning || [];
    layout.metrics([['Planning items', fmt(rows.length)], ['Planned quantity', `${fmt(rows.reduce((sum, row) => sum + Number(row.planned_qty || 0), 0))} NOS`], ['Produced quantity', `${fmt(rows.reduce((sum, row) => sum + Number(row.produced_qty || 0), 0))} NOS`]], 3);
    layout.table('PLANNINGS', [
      { title: 'Challan', key: 'challan_no', weight: 1.6 }, { title: 'Party', key: 'party_name', weight: 2 },
      { title: 'Material', key: 'material_description', weight: 2.5 },
      { title: 'Planned (NOS)', key: 'planned_qty', weight: 1, align: 'center', format: fmt },
      { title: 'Produced (NOS)', key: 'produced_qty', weight: 1, align: 'center', format: fmt },
      { title: 'Status', key: 'status', weight: 1.2 },
    ], rows);
  } else {
    const rows = report.materials || [];
    layout.metrics([['Materials', fmt(rows.length)], ['MS production', `${fmt(rows.reduce((sum, row) => sum + Number(row.ms_kg || 0), 0))} kg`], ['GI production', `${fmt(rows.reduce((sum, row) => sum + Number(row.gi_kg || 0), 0))} kg`]], 3);
    layout.table('MATERIAL PRODUCTIONS', [
      { title: 'Material', key: 'material', weight: 3 },
      { title: 'Entries', key: 'entry_count', weight: 1.2, align: 'center', format: fmt },
      { title: 'Qty (NOS)', key: 'quantity', weight: 1.4, align: 'center', format: fmt },
      { title: 'MS (kg)', key: 'ms_kg', weight: 1.3, align: 'center', format: fmt },
      { title: 'GI (kg)', key: 'gi_kg', weight: 1.3, align: 'center', format: fmt },
    ], rows);
  }
  drawReportFooters(pdf, fonts, `${detailTitles[type]} | ${report.period.label}`);
  return Buffer.from(await pdf.save());
}
module.exports = { detailTitles, generateMonthlyDetailPdf };
