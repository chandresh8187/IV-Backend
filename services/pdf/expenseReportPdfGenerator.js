const { PDFDocument, StandardFonts } = require('pdf-lib');
const { loadCompanyLogo, drawReportFooters } = require('./reportBranding');
const { createReportLayout } = require('./reportLayout');
const number = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const money = value => `Rs ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
async function generateExpenseReportPdf(report) {
  const pdf = await PDFDocument.create();
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const logo = await loadCompanyLogo(pdf), totals = report.totals || {};
  const layout = createReportLayout(pdf, fonts, logo, { title: 'MONTHLY PRODUCTION EXPENSE REPORT', subtitle: `Period: ${report.period.from} to ${report.period.to}` });
  layout.addPage();
  layout.metrics([
    ['Running plant cost', `${money(totals.running_plant_cost)} / kg`], ['Total daily expense', money(totals.total_expense)],
    ['Monthly MS production', `${number(totals.total_ms_production_kg / 1000)} ton`], ['Average zinc consumption', `${number(totals.average_zinc_consumption_percent)}%`],
  ], 4, true);
  layout.metrics([
    ['Plant zinc stock', `${number(totals.plant_zinc_stock_kg)} kg`], ['Purchased zinc', `${number(totals.purchased_zinc_kg)} kg`],
    ['Average production / day', `${number(totals.average_ms_production_per_day_kg / 1000)} ton`], ['Production days', number(totals.production_days)],
  ], 4, true);
  const rows = [
    ['Salary per day', 'salary_per_day'], ['Hardware', 'hardware_per_day'], ['Maintenance', 'maintenance_per_day'],
    ['Zinc spray', 'zinc_spray_per_day'], ['Electricity', 'electricity_per_day'], ['Gas (850 x bottle rate)', 'gas_per_day'],
    ['Chemicals', 'chemicals_per_day'], ['MS wire', 'ms_wire_per_day'], ['Rent', 'rent_expense'], ['Acid', 'acid_expense'], ['Crane', 'crane_expense'], ['Other', 'other_expense'],
  ].map(([label, key]) => ({ label, value: report.expenses?.[key] }));
  layout.table('DAILY EXPENSE BREAKDOWN', [
    { title: 'Expense', key: 'left_label', weight: 2.4 }, { title: 'Amount (Rs)', key: 'left_value', weight: 1.1, align: 'right', format: money },
    { title: 'Expense', key: 'right_label', weight: 2.4 }, { title: 'Amount (Rs)', key: 'right_value', weight: 1.1, align: 'right', format: money },
  ], rows.filter((_, i) => i % 2 === 0).map((row, i) => ({ left_label: row.label, left_value: row.value, right_label: rows[i * 2 + 1].label, right_value: rows[i * 2 + 1].value })));
  layout.note(`Net zinc consumed: ${number(totals.net_zinc_consumed_kg)} kg, after ${number(totals.recovered_zinc_kg)} kg recovery.`);
  drawReportFooters(pdf, fonts, `Production expenses | ${report.period.from} to ${report.period.to}`);
  return Buffer.from(await pdf.save());
}
module.exports = { generateExpenseReportPdf };
