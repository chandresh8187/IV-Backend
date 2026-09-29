const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { DateTime } = require('luxon');

const C = { navy: rgb(.05,.13,.24), blue: rgb(.16,.38,.78), text: rgb(.15,.2,.3), muted: rgb(.39,.44,.51), line: rgb(.85,.88,.92), pale: rgb(.95,.97,.99), white: rgb(1,1,1) };
const PAGE = { width: 841.89, height: 595.28, left: 40, right: 40 };
const fmt = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const clean = value => String(value ?? '-').normalize('NFKD').replace(/[^\x20-\x7E]/g, '').trim() || '-';

const generateDailyProductionPdf = async report => {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page, y;
  const draw = (value, x, baseline, size = 8, font = regular, color = C.text) => page.drawText(clean(value), { x, y: baseline, size, font, color });
  const pageStart = () => {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    page.drawText('IV SQUARE STRUCTURE INDIA PVT LTD', { x: PAGE.left, y: 553, size: 14, font: bold, color: C.navy });
    page.drawText('DAILY PRODUCTION REPORT', { x: 631, y: 555, size: 10, font: bold, color: C.blue });
    page.drawLine({ start: { x: PAGE.left, y: 540 }, end: { x: PAGE.width - PAGE.right, y: 540 }, thickness: 1.5, color: C.blue });
    y = 508;
  };
  const ensure = height => { if (y - height < 58) pageStart(); };
  const heading = title => {
    ensure(30);
    page.drawRectangle({ x: PAGE.left, y: y - 19, width: PAGE.width - PAGE.left - PAGE.right, height: 24, color: C.navy });
    draw(title, PAGE.left + 10, y - 11, 10, bold, C.white);
    y -= 30;
  };
  const tableHeader = columns => {
    ensure(22);
    page.drawRectangle({ x: PAGE.left, y: y - 10, width: PAGE.width - PAGE.left - PAGE.right, height: 20, color: C.pale });
    columns.forEach(column => draw(column.title, column.x, y - 3, 8, bold, C.navy));
    y -= 22;
  };
  const tableRow = (columns, values, index, strong = false) => {
    ensure(17);
    if (index % 2) page.drawRectangle({ x: PAGE.left, y: y - 7, width: PAGE.width - PAGE.left - PAGE.right, height: 17, color: C.pale });
    columns.forEach((column, i) => {
      let value = clean(values[i]);
      while (regular.widthOfTextAtSize(value, 8) > column.width && value.length > 3) value = `${value.slice(0, -4)}...`;
      draw(value, column.x, y, 8, strong ? bold : regular, strong ? C.navy : C.text);
    });
    y -= 17;
  };

  pageStart();
  const width = PAGE.width - PAGE.left - PAGE.right;
  page.drawRectangle({ x: PAGE.left, y: y - 68, width, height: 68, color: C.pale, borderColor: C.line, borderWidth: 1 });
  draw(`REPORT MONTH: ${report.period.label.toUpperCase()}`, PAGE.left + 13, y - 18, 11, bold, C.blue);
  draw(`Total production: ${fmt(report.production.total_ms_kg)} kg MS`, PAGE.left + 13, y - 43, 15, bold, C.navy);
  draw(`${fmt(report.production.production_days)} production days`, PAGE.left + 545, y - 42, 10, bold, C.text);
  y -= 83;
  heading('DATE-WISE PRODUCTION  |  MS WEIGHT (KG)');
  const dailyColumns = [
    { title: 'DATE', x: 50, width: 155 }, { title: 'DAY SHIFT', x: 235, width: 135 },
    { title: 'NIGHT SHIFT', x: 420, width: 135 }, { title: 'DATE TOTAL', x: 610, width: 135 },
  ];
  tableHeader(dailyColumns);
  const byDate = new Map((report.daily_production || []).map(row => [String(row.production_date).slice(0, 10), row]));
  let day = DateTime.fromISO(report.period.from);
  const last = DateTime.fromISO(report.period.to);
  let rowNumber = 0;
  while (day <= last) {
    if (y - 17 < 58) { pageStart(); heading('DATE-WISE PRODUCTION (CONTINUED)'); tableHeader(dailyColumns); }
    const row = byDate.get(day.toISODate()) || {};
    tableRow(dailyColumns, [day.toFormat('dd LLL yyyy'), `${fmt(row.day_ms_kg)} kg`, `${fmt(row.night_ms_kg)} kg`, `${fmt(row.total_ms_kg)} kg`], rowNumber++);
    day = day.plus({ days: 1 });
  }
  if (y - 48 < 58) { pageStart(); heading('DATE-WISE PRODUCTION TOTAL'); tableHeader(dailyColumns); }
  const dayTotal = (report.daily_production || []).reduce((sum, row) => sum + Number(row.day_ms_kg || 0), 0);
  const nightTotal = (report.daily_production || []).reduce((sum, row) => sum + Number(row.night_ms_kg || 0), 0);
  tableRow(dailyColumns, ['MONTH TOTAL', `${fmt(dayTotal)} kg`, `${fmt(nightTotal)} kg`, `${fmt(report.production.total_ms_kg)} kg`], rowNumber, true);
  y -= 15;
  heading('CONTRACTOR PRODUCTION FOR THE MONTH');
  const contractorColumns = [
    { title: 'CONTRACTOR', x: 50, width: 480 },
    { title: 'MS PRODUCTION', x: 610, width: 145 },
  ];
  tableHeader(contractorColumns);
  if (!report.contractors.length) tableRow(contractorColumns, ['No contractor production', '-'], 0);
  report.contractors.forEach((contractor, index) => {
    if (y - 17 < 58) { pageStart(); heading('CONTRACTOR PRODUCTION (CONTINUED)'); tableHeader(contractorColumns); }
    tableRow(contractorColumns, [contractor.contractor_name, `${fmt(contractor.ms_kg)} kg`], index);
  });
  pdf.getPages().forEach((current, index, pages) => {
    current.drawLine({ start: { x: PAGE.left, y: 44 }, end: { x: PAGE.width - PAGE.right, y: 44 }, thickness: .6, color: C.line });
    current.drawText(`Month: ${clean(report.period.label)}  |  Generated ${new Date().toLocaleString('en-IN')}`, { x: PAGE.left, y: 28, size: 7, font: regular, color: C.muted });
    current.drawText(`Page ${index + 1} of ${pages.length}`, { x: 750, y: 28, size: 7, font: regular, color: C.muted });
  });
  return Buffer.from(await pdf.save());
};

module.exports = { generateDailyProductionPdf };
