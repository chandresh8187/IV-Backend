const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE = { width: 841.89, height: 595.28, margin: 34 };
const labels = {
  initialize: 'Opening stock',
  adjust: 'Stock correction',
  receive: 'Received in plant',
  transfer: 'Added to kettle',
  production_use: 'Production consumed',
  production_restore: 'Production restored',
};
const formatKg = value => Number(value || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});
const fit = (value, font, size, width) => {
  const text = String(value == null || value === '' ? '-' : value)
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '');
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let result = text;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > width) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
};

async function generateZincStockPdf(rows) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const columns = [
    { title: 'Date / time', key: 'created_at', x: 38, width: 105 },
    { title: 'Transaction', key: 'movement_type', x: 147, width: 112 },
    { title: 'Amount kg', key: 'amount_kg', x: 253, width: 61 },
    { title: 'Rate / kg', key: 'zinc_rate_per_kg', x: 318, width: 58 },
    { title: 'Plant after', key: 'plant_after_kg', x: 380, width: 67 },
    { title: 'Kettle after', key: 'kettle_after_kg', x: 451, width: 71 },
    { title: 'User', key: 'actor_name', x: 526, width: 78 },
    { title: 'Reference / note', key: 'note', x: 608, width: 194 },
  ];
  let page;
  let y;
  const addPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - PAGE.margin;
    page.drawText('IV SQUARE STRUCTURE INDIA PVT LTD', {
      x: PAGE.margin, y, size: 15, font: bold, color: rgb(0.04, 0.12, 0.23),
    });
    page.drawText('ZINC STOCK TRANSACTION REPORT', {
      x: 573, y: y + 1, size: 10, font: bold, color: rgb(0.25, 0.18, 0.5),
    });
    y -= 24;
    page.drawText(`Generated: ${new Date().toLocaleString('en-IN')}`, {
      x: PAGE.margin, y, size: 8, font: regular, color: rgb(0.36, 0.42, 0.5),
    });
    y -= 22;
    page.drawRectangle({ x: PAGE.margin, y: y - 18, width: PAGE.width - PAGE.margin * 2, height: 22, color: rgb(0.04, 0.12, 0.23) });
    columns.forEach(column => page.drawText(column.title, {
      x: column.x, y: y - 11, size: 7.5, font: bold, color: rgb(1, 1, 1),
    }));
    y -= 22;
  };
  addPage();
  rows.forEach((row, index) => {
    if (y < 48) addPage();
    if (index % 2 === 1) page.drawRectangle({ x: PAGE.margin, y: y - 17, width: PAGE.width - PAGE.margin * 2, height: 20, color: rgb(0.95, 0.95, 0.98) });
    const note = row.production_entry_id
      ? `${row.note || ''} (Entry #${row.production_entry_id})`
      : row.note;
    const values = {
      ...row,
      movement_type: labels[row.movement_type] || row.movement_type,
      amount_kg: ['initialize', 'adjust'].includes(row.movement_type) ? '-' : formatKg(row.amount_kg),
      zinc_rate_per_kg: row.zinc_rate_per_kg == null ? '-' : `Rs ${Number(row.zinc_rate_per_kg).toFixed(2)}`,
      plant_after_kg: formatKg(row.plant_after_kg),
      kettle_after_kg: formatKg(row.kettle_after_kg),
      actor_name: row.actor_name || 'User',
      note,
    };
    columns.forEach(column => page.drawText(fit(values[column.key], regular, 7.2, column.width), {
      x: column.x, y: y - 10, size: 7.2, font: regular, color: rgb(0.1, 0.12, 0.2),
    }));
    y -= 20;
  });
  if (!rows.length) {
    page.drawText('No zinc stock transactions have been recorded.', { x: PAGE.margin, y: y - 14, size: 10, font: regular });
  }
  return Buffer.from(await pdf.save());
}

module.exports = { generateZincStockPdf };
