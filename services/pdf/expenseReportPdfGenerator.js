const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const money = value => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const number = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

async function generateExpenseReportPdf(report) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([841.89, 595.28]);
  const dark = rgb(0.15, 0.13, 0.25);
  const violet = rgb(0.24, 0.18, 0.5);
  const pale = rgb(0.94, 0.93, 0.98);
  page.drawText('IV SQUARE STRUCTURE INDIA PVT LTD', { x: 36, y: 556, size: 15, font: bold, color: dark });
  page.drawText('MONTHLY PRODUCTION EXPENSE REPORT', { x: 548, y: 557, size: 10, font: bold, color: violet });
  page.drawText(`Period: ${report.period.from} to ${report.period.to}`, { x: 36, y: 535, size: 9, font: regular, color: rgb(0.36, 0.34, 0.43) });
  page.drawRectangle({ x: 36, y: 446, width: 770, height: 72, color: violet, borderRadius: 10 });
  page.drawText('RUNNING PLANT COST', { x: 62, y: 487, size: 11, font: bold, color: rgb(0.86, 0.83, 0.97) });
  page.drawText(`Rs ${money(report.totals.running_plant_cost)} / kg`, { x: 62, y: 461, size: 23, font: bold, color: rgb(1, 1, 1) });
  page.drawText(`Total daily expense: Rs ${money(report.totals.total_expense)}`, { x: 485, y: 479, size: 12, font: bold, color: rgb(1, 1, 1) });

  const metrics = [
    ['Plant zinc stock', `${number(report.totals.plant_zinc_stock_kg)} kg`],
    ['Purchased zinc', `${number(report.totals.purchased_zinc_kg)} kg`],
    ['Monthly MS production', `${number(report.totals.total_ms_production_kg / 1000)} ton`],
    ['Average production / day', `${number(report.totals.average_ms_production_per_day_kg / 1000)} ton`],
    ['Production days', String(report.totals.production_days)],
    ['Average zinc consumption', `${number(report.totals.average_zinc_consumption_percent)}%`],
  ];
  metrics.forEach(([label, value], index) => {
    const col = index % 3; const row = Math.floor(index / 3); const x = 36 + col * 258; const y = 412 - row * 58;
    page.drawRectangle({ x, y: y - 38, width: 246, height: 48, color: pale });
    page.drawText(label, { x: x + 12, y: y - 5, size: 8, font: regular, color: rgb(0.38, 0.36, 0.45) });
    page.drawText(value, { x: x + 12, y: y - 25, size: 13, font: bold, color: dark });
  });
  page.drawText('DAILY EXPENSE BREAKDOWN', { x: 36, y: 290, size: 11, font: bold, color: dark });
  const rows = [
    ['Salary per day', report.expenses.salary_per_day], ['Hardware', report.expenses.hardware_per_day],
    ['Maintenance', report.expenses.maintenance_per_day], ['Zinc spray', report.expenses.zinc_spray_per_day],
    ['Electricity', report.expenses.electricity_per_day], ['Gas (850 x bottle rate)', report.expenses.gas_per_day],
    ['Chemicals', report.expenses.chemicals_per_day], ['MS wire', report.expenses.ms_wire_per_day],
    ['Rent', report.expenses.rent_expense], ['Acid', report.expenses.acid_expense],
    ['Crane', report.expenses.crane_expense], ['Other', report.expenses.other_expense],
  ];
  rows.forEach(([label, value], index) => {
    const col = index % 2; const row = Math.floor(index / 2); const x = 36 + col * 385; const y = 266 - row * 31;
    if (row % 2 === 0) page.drawRectangle({ x, y: y - 17, width: 373, height: 25, color: pale });
    page.drawText(label, { x: x + 9, y: y - 7, size: 8.5, font: regular, color: dark });
    page.drawText(`Rs ${money(value)}`, { x: x + 270, y: y - 7, size: 8.5, font: bold, color: dark });
  });
  page.drawText(`Net zinc consumed: ${number(report.totals.net_zinc_consumed_kg)} kg (after ${number(report.totals.recovered_zinc_kg)} kg recovery)`, { x: 36, y: 54, size: 8, font: regular, color: rgb(0.36, 0.34, 0.43) });
  page.drawText(`Generated: ${new Date().toLocaleString('en-IN')}`, { x: 625, y: 54, size: 8, font: regular, color: rgb(0.36, 0.34, 0.43) });
  return Buffer.from(await pdf.save());
}

module.exports = { generateExpenseReportPdf };
