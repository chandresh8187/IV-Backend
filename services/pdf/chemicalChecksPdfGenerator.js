const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const clean = value => String(value == null || value === '' ? '-' : value)
  .normalize('NFKD').replace(/[^\x20-\x7E]/g, '');

const fit = (value, font, size, width) => {
  let output = clean(value);
  if (font.widthOfTextAtSize(output, size) <= width) return output;
  while (output.length > 1 && font.widthOfTextAtSize(`${output}...`, size) > width) output = output.slice(0, -1);
  return `${output}...`;
};

async function generateChemicalChecksPdf(rows, periodLabel) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageSize = [841.89, 595.28];
  const columns = [
    ['Date', 'inspection_date', 35, 78],
    ['Flux pH', 'flux_ph', 117, 66],
    ['Flux density', 'flux_density', 181, 71],
    ['Flux temp C', 'flux_temperature_c', 256, 65],
    ['Acid pH', 'acid_ph', 325, 56],
    ['Acid density', 'acid_density', 385, 70],
    ['Checked by', 'checked_by_name', 459, 102],
    ['Checked at', 'created_at', 565, 100],
    ['Note', 'note', 669, 135],
  ];
  let page;
  let y;
  const addPage = () => {
    page = pdf.addPage(pageSize);
    y = 559;
    page.drawText('IV SQUARE STRUCTURE INDIA PVT LTD', { x: 35, y, size: 15, font: bold, color: rgb(0.04, 0.12, 0.23) });
    page.drawText('DAILY FLUX & ACID CHECKS', { x: 620, y: y + 1, size: 10, font: bold, color: rgb(0.25, 0.18, 0.5) });
    page.drawText(clean(periodLabel), { x: 35, y: y - 17, size: 8, font: regular, color: rgb(0.35, 0.38, 0.45) });
    y -= 43;
    page.drawRectangle({ x: 35, y: y - 17, width: 772, height: 22, color: rgb(0.04, 0.12, 0.23) });
    columns.forEach(([title,,x]) => page.drawText(title, { x, y: y - 10, size: 7, font: bold, color: rgb(1, 1, 1) }));
    y -= 22;
  };
  addPage();
  rows.forEach((row, index) => {
    if (y < 48) addPage();
    if (index % 2) page.drawRectangle({ x: 35, y: y - 17, width: 772, height: 20, color: rgb(0.95, 0.95, 0.98) });
    columns.forEach(([, key, x, width]) => page.drawText(fit(row[key], regular, 7, width), {
      x, y: y - 10, size: 7, font: regular, color: rgb(0.1, 0.12, 0.2),
    }));
    y -= 20;
  });
  if (!rows.length) page.drawText('No chemical checks were recorded for this period.', { x: 35, y: y - 14, size: 10, font: regular });
  return Buffer.from(await pdf.save());
}

module.exports = { generateChemicalChecksPdf };
