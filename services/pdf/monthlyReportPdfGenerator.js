const { PDFDocument, StandardFonts } = require('pdf-lib');
const { loadCompanyLogo, drawReportFooters } = require('./reportBranding');
const { createReportLayout } = require('./reportLayout');
const { generateZincStockPdf } = require('./zincStockPdfGenerator');
const fmt = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const kg = value => `${fmt(value)} kg`;
const money = value => `Rs ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const titleCase = value => value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());

async function generateMonthlyReportPdf(report) {
  const pdf = await PDFDocument.create();
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const logo = await loadCompanyLogo(pdf);
  const production = report.production || {}, zinc = report.zinc || {}, byproducts = report.byproducts || {}, totals = report.expenses?.totals || {};
  const layout = createReportLayout(pdf, fonts, logo, {
    title: 'MONTHLY OPERATIONS REPORT',
    subtitle: `${report.period.label} | Financial year ${report.financial_year.name} | ${report.period.from} to ${report.period.to}`,
  });
  layout.addPage();
  layout.metrics([
    ['MS production', kg(production.total_ms_kg)], ['GI production', kg(production.total_gi_kg)],
    ['Zinc after recovery', kg(production.net_zinc_kg)], ['Running plant cost', `${money(totals.running_plant_cost)} / kg`],
  ]);
  layout.metrics([
    ['Production days', fmt(production.production_days)], ['Production entries', fmt(production.entry_count)],
    ['Quantity', `${fmt(production.quantity)} NOS`], ['Zinc consumption', `${fmt(production.zinc_consumption_percent)}%`],
  ]);
  layout.panels([
    { title: 'ZINC STOCK RECONCILIATION', rows: [
      ['Opening plant / kettle', `${fmt(zinc.opening_plant_kg)} / ${fmt(zinc.opening_kettle_kg)} kg`],
      ['Received in plant', kg(zinc.received_kg)], ['Transferred to kettle', kg(zinc.transferred_to_kettle_kg)],
      ['Production usage', kg(zinc.production_used_kg)], ['Production returned', kg(zinc.production_restored_kg)],
      ['Closing plant / kettle', `${fmt(zinc.closing_plant_kg)} / ${fmt(zinc.closing_kettle_kg)} kg`],
    ] },
    { title: 'RECOVERY & EXPENSES', rows: [
      ['Ash collected', kg(byproducts.ash_weight_kg)], ['Dross collected', kg(byproducts.dross_weight_kg)],
      ['Recovered zinc', kg(byproducts.recovered_zinc_kg)], ['Recovery sale value incl. GST', money(byproducts.total_with_gst)],
      ['Total daily expense', money(totals.total_expense)], ['Stock corrections / openings', fmt(zinc.corrections)],
    ] },
  ]);
  layout.note('Zinc stock reconciles movements recorded within the month. Production uses operating dates. Batch quantities in the transaction section follow FIFO receipts through plant-to-kettle transfers.');

  layout.addPage();
  const quantity = { title: 'Qty (NOS)', key: 'quantity', weight: 1, align: 'right', format: fmt };
  const entries = { title: 'Entries', key: 'entry_count', weight: .8, align: 'right', format: fmt };
  const ms = { title: 'MS (kg)', key: 'ms_kg', weight: 1.2, align: 'right', format: fmt };
  const gi = { title: 'GI (kg)', key: 'gi_kg', weight: 1.2, align: 'right', format: fmt };
  layout.table('SHIFT PRODUCTION', [{ title: 'Shift', key: 'shift_name', weight: 2, format: value => titleCase(String(value || '-')) }, entries, quantity, ms, gi], report.shifts);
  layout.table('MATERIAL PRODUCTION', [{ title: 'Material', key: 'material', weight: 3.5 }, quantity, ms, gi], report.materials);
  layout.table('CONTRACTOR PRODUCTION', [{ title: 'Contractor', key: 'contractor_name', weight: 3.5 }, entries, quantity, ms, gi], report.contractors);
  layout.table('PLANNING', [
    { title: 'Challan', key: 'challan_no', weight: 1.6 }, { title: 'Party', key: 'party_name', weight: 2 },
    { title: 'Material', key: 'material_description', weight: 2.5 },
    { title: 'Planned', key: 'planned_qty', weight: .9, align: 'right', format: fmt },
    { title: 'Produced', key: 'produced_qty', weight: .9, align: 'right', format: fmt },
    { title: 'Status', key: 'status', weight: 1.1, format: value => titleCase(String(value || '-')) },
  ], report.planning);
  const costs = Object.entries(report.expenses?.expenses || {});
  layout.table('EXPENSE BREAKDOWN', [
    { title: 'Expense', key: 'left_label', weight: 2.4 }, { title: 'Amount (Rs)', key: 'left_value', weight: 1.1, align: 'right', format: value => value == null ? '-' : money(value) },
    { title: 'Expense', key: 'right_label', weight: 2.4 }, { title: 'Amount (Rs)', key: 'right_value', weight: 1.1, align: 'right', format: value => value == null ? '-' : money(value) },
  ], costs.filter((_, index) => index % 2 === 0).map(([key, value], i) => ({
    left_label: titleCase(key), left_value: value,
    right_label: costs[i * 2 + 1] ? titleCase(costs[i * 2 + 1][0]) : '-', right_value: costs[i * 2 + 1]?.[1],
  })));

  const appendix = await PDFDocument.load(await generateZincStockPdf(report.zinc_movements || [], {
    title: 'MONTHLY REPORT | ZINC TRANSACTIONS',
    scopeLabel: `${report.period.label} | Recorded movements ${report.period.from} to ${report.period.to}`,
    includeFooter: false,
  }));
  for (const page of await pdf.copyPages(appendix, appendix.getPageIndices())) pdf.addPage(page);
  drawReportFooters(pdf, fonts, `Monthly operations | ${report.period.label}`);
  return Buffer.from(await pdf.save());
}
module.exports = { generateMonthlyReportPdf };
