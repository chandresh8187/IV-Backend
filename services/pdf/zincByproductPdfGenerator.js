const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const PAGE = { width: 841.89, height: 595.28, margin: 34 };
const clean = value => String(value == null || value === '' ? '-' : value).normalize('NFKD').replace(/[^\x20-\x7E]/g, '');
const fit = (value, font, size, width) => {
  let text = clean(value);
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  while (text.length > 1 && font.widthOfTextAtSize(`${text}...`, size) > width) text = text.slice(0, -1);
  return `${text}...`;
};
const money = value => Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kg = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

async function generateZincByproductPdf(rows) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const columns = [
    ['Date', 'transaction_date', 38, 67], ['Ash kg', 'ash_weight_kg', 109, 48],
    ['Ash rate', 'ash_rate', 161, 55], ['Ash + GST', 'ash_total', 220, 69],
    ['Dross kg', 'dross_weight_kg', 293, 55], ['Dross rate', 'dross_rate', 352, 61],
    ['Dross + GST', 'dross_total', 417, 76], ['Total Rs.', 'total_with_gst', 497, 71],
    ['Zn rate', 'zinc_rate_snapshot', 572, 58], ['Recovered kg', 'recovered_zinc_kg', 634, 75],
    ['User / note', 'detail', 713, 90],
  ];
  let page; let y;
  const addPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height]); y = PAGE.height - PAGE.margin;
    page.drawText('IV SQUARE STRUCTURE INDIA PVT LTD', { x: PAGE.margin, y, size: 15, font: bold, color: rgb(0.04, 0.12, 0.23) });
    page.drawText('ASH & DROSS RECOVERY REPORT', { x: 602, y: y + 1, size: 10, font: bold, color: rgb(0.25, 0.18, 0.5) });
    y -= 28;
    page.drawRectangle({ x: PAGE.margin, y: y - 18, width: PAGE.width - PAGE.margin * 2, height: 22, color: rgb(0.04, 0.12, 0.23) });
    columns.forEach(([title,,x]) => page.drawText(title, { x, y: y - 11, size: 7, font: bold, color: rgb(1, 1, 1) }));
    y -= 22;
  };
  addPage();
  rows.forEach((row, index) => {
    if (y < 48) addPage();
    if (index % 2) page.drawRectangle({ x: PAGE.margin, y: y - 17, width: PAGE.width - PAGE.margin * 2, height: 20, color: rgb(0.95, 0.95, 0.98) });
    const values = { ...row,
      ash_weight_kg: kg(row.ash_weight_kg), ash_rate: money(row.ash_rate),
      ash_total: money(Number(row.ash_base_amount) + Number(row.ash_gst_amount)),
      dross_weight_kg: kg(row.dross_weight_kg), dross_rate: money(row.dross_rate),
      dross_total: money(Number(row.dross_base_amount) + Number(row.dross_gst_amount)),
      total_with_gst: money(row.total_with_gst), zinc_rate_snapshot: money(row.zinc_rate_snapshot),
      recovered_zinc_kg: kg(row.recovered_zinc_kg), detail: `${row.actor_name || 'User'} ${row.note || ''}`,
    };
    columns.forEach(([,key,x,width]) => page.drawText(fit(values[key], regular, 6.8, width), { x, y: y - 10, size: 6.8, font: regular, color: rgb(0.1, 0.12, 0.2) }));
    y -= 20;
  });
  if (!rows.length) page.drawText('No ash or dross transactions recorded.', { x: PAGE.margin, y: y - 14, size: 10, font: regular });
  return Buffer.from(await pdf.save());
}
module.exports = { generateZincByproductPdf };
