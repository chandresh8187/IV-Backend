const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE = { width: 841.89, height: 595.28, margin: 34 };
const formatKg = value => Number(value || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});
const explainMovement = row => {
  const amount = `${formatKg(row.amount_kg)} kg`;
  switch (row.movement_type) {
    case 'initialize': return 'Opening plant and kettle balances recorded';
    case 'adjust': return 'Verified stock balances manually corrected';
    case 'receive': return `Supplier receipt: ${amount} added to plant`;
    case 'transfer': return `Internal transfer: ${amount} plant to kettle`;
    case 'production_use': return `Production used ${amount} from kettle${row.production_entry_id ? ` (#${row.production_entry_id})` : ''}`;
    case 'production_restore': return `Correction returned ${amount} to kettle${row.production_entry_id ? ` (#${row.production_entry_id})` : ''}`;
    default: return String(row.movement_type || 'Stock movement').replaceAll('_', ' ');
  }
};
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
    { title: 'Date / time', key: 'created_at', x: 38, width: 101 },
    { title: 'What this transaction proves', key: 'explanation', x: 143, width: 238 },
    { title: 'Rate / kg', key: 'zinc_rate_per_kg', x: 385, width: 60 },
    { title: 'Plant balance', key: 'plant_after_kg', x: 449, width: 72 },
    { title: 'Kettle balance', key: 'kettle_after_kg', x: 525, width: 76 },
    { title: 'Recorded by', key: 'actor_name', x: 605, width: 78 },
    { title: 'Note / reference', key: 'note', x: 687, width: 115 },
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
    y -= 13;
    page.drawText('Balances show the stock remaining immediately after each transaction.', {
      x: PAGE.margin, y, size: 8, font: regular, color: rgb(0.36, 0.42, 0.5),
    });
    y -= 20;
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
    const noteParts = [];
    if (row.production_entry_id) noteParts.push(`Production entry #${row.production_entry_id}`);
    if (row.note) noteParts.push(row.note);
    const values = {
      ...row,
      explanation: explainMovement(row),
      zinc_rate_per_kg: row.zinc_rate_per_kg == null ? '-' : `Rs ${Number(row.zinc_rate_per_kg).toFixed(2)}`,
      plant_after_kg: `${formatKg(row.plant_after_kg)} kg`,
      kettle_after_kg: `${formatKg(row.kettle_after_kg)} kg`,
      actor_name: row.actor_name || 'User',
      note: noteParts.join(' | ') || '-',
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
