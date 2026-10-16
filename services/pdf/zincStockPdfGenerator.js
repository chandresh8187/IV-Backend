const { loadCompanyLogo, drawReportHeader, drawReportFooters } = require('./reportBranding');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE = { width: 841.89, height: 595.28, margin: 32 };
const ink = rgb(0.08, 0.16, 0.24), muted = rgb(0.36, 0.42, 0.48);
const kg = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
const ascii = value => String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '');
const date = value => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '-';
};
const shift = value => value === 'day' ? 'Day' : value === 'night' ? 'Night' : value === 'unavailable' ? 'Unknown' : '-';
function reportCells(row) {
  const summary = row.movement_type === 'production_summary';
  const labels = {
    initialize: 'Opening stock', adjust: 'Stock correction',
    receive: 'Zinc received in plant', transfer: 'Plant to kettle transfer',
    production_use: 'Production usage', production_restore: 'Production return',
  };
  let explanation = labels[row.movement_type] || 'Stock movement';
  if (summary) explanation = Number(row.amount_kg) < 0 ? 'Production return (net)' : 'Production usage';
  const details = [];
  if (summary) {
    details.push('Usage less returns / corrections.');
    if (row.shift_name === 'unavailable') details.push('Legacy record: shift unavailable; date is recorded date.');
  } else {
    if (row.batch_number) details.push(`Batch: ${row.batch_number}`);
    if (row.invoice_number) details.push(`Invoice: ${row.invoice_number}`);
    if (row.zinc_rate_per_kg != null) details.push(`Purchase rate: Rs ${Number(row.zinc_rate_per_kg).toFixed(2)} / kg`);
    if (row.actor_name) details.push(`By: ${row.actor_name}`);
    if (row.note) details.push(`Note: ${row.note}`);
  }
  if (row.movement_type !== 'receive') {
    for (const batch of row.batch_allocations || []) {
      const action = Number(batch.amount_kg) < 0 ? 'Returned' : summary ? 'Used' : 'Transferred';
      const reference = batch.receipt_id != null
        ? `Batch: ${batch.batch_number || 'Not recorded'} | Invoice: ${batch.invoice_number || 'Not recorded'}`
        : batch.source_label || 'Unreferenced stock';
      details.push(`${action} ${kg(Math.abs(Number(batch.amount_kg)))} kg | ${reference}`);
    }
  }
  const balance = value => summary || value == null ? '-' : `${kg(value)} kg`;
  return [
    date(row.transaction_date || row.created_at), shift(row.shift_name), explanation,
    ['initialize', 'adjust'].includes(row.movement_type) ? 'Balances set' : `${kg(Math.abs(Number(row.amount_kg)))} kg`,
    balance(row.plant_after_kg), balance(row.kettle_after_kg), details.join('\n') || '-',
  ];
}

// Wrap long references and notes instead of silently cutting them off.
function wrap(value, font, size, width) {
  const lines = [];
  for (const paragraph of String(value ?? '-').split('\n')) {
    let line = '';
    for (const char of ascii(paragraph) || '-') {
      if (font.widthOfTextAtSize(line + char, size) > width && line) {
        const space = line.lastIndexOf(' ');
        if (space > line.length / 2) {
          lines.push(line.slice(0, space));
          line = line.slice(space + 1) + char;
        } else { lines.push(line); line = char; }
      } else line += char;
    }
    if (line) lines.push(line);
  }
  return lines;
}

async function generateZincStockPdf(rows, options = {}) {
  const pdf = await PDFDocument.create();
  const logo = await loadCompanyLogo(pdf);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const widths = [73, 47, 137, 75, 84, 84, 177.89];
  const headers = ['Date', 'Shift', 'Transaction', 'Quantity', 'Plant balance', 'Kettle balance', 'Batch / invoice allocation'];
  const size = 8, lineHeight = 11;
  let page, y;
  const text = (value, x, top, font = regular, fontSize = size, color = ink) =>
    page.drawText(ascii(value), { x, y: top, font, size: fontSize, color });
  const addPage = (first = false) => {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    const top = drawReportHeader(page, { regular, bold }, logo, {
      title: options.title || 'ZINC STOCK | TRANSACTION REPORT',
      subtitle: options.scopeLabel || 'All recorded transactions | Newest activity first',
    });
    y = top;
    if (first) {
    const totals = [
      ['Received in plant', rows.filter(r => r.movement_type === 'receive').reduce((n, r) => n + Number(r.amount_kg), 0)],
      ['Transferred to kettle', rows.filter(r => r.movement_type === 'transfer').reduce((n, r) => n + Number(r.amount_kg), 0)],
      ['Net production usage', rows.filter(r => r.movement_type === 'production_summary').reduce((n, r) => n + Number(r.amount_kg), 0)],
    ];
    totals.forEach(([label, amount], i) => {
      const x = 32 + i * 262;
      page.drawRectangle({ x, y: top - 43, width: 252, height: 43, color: rgb(0.94, 0.97, 0.98) });
      text(label, x + 10, top - 15, regular, 8, muted);
      text(`${kg(amount)} kg`, x + 10, top - 33, bold, 12);
    });
    text('Production: one net row per operating date and shift. Returns reduce usage; a net return is labelled separately.', 32, top - 59, regular, 8, muted);
    text('Balances: stock immediately after an individual movement. Shift summaries have no single transaction balance (-).', 32, top - 72, regular, 8, muted);
    text('FIFO batches: oldest receipts first, through plant-to-kettle transfers. Opening stock and unidentified stock are unreferenced.', 32, top - 85, regular, 8, muted);
      y = top - 104;
    }
    page.drawRectangle({ x: 32, y: y - 23, width: 777.89, height: 25, color: ink });
    let x = 32;
    headers.forEach((header, i) => { text(header, x + 6, y - 14, bold, 8, rgb(1, 1, 1)); x += widths[i]; });
    y -= 25;
  };
  addPage(true);
  rows.forEach((row, index) => {
    const cells = reportCells(row).map((cell, i) => wrap(cell, i === 2 ? bold : regular, size, widths[i] - 12));
    const totalLines = Math.max(...cells.map(lines => lines.length));
    const fullHeight = Math.max(34, totalLines * lineHeight + 16);
    if (fullHeight <= 335 && y - fullHeight < 45) addPage();
    let offset = 0;
    while (offset < totalLines) {
      let availableLines = Math.floor((y - 45 - 16) / lineHeight);
      if (availableLines < 2) { addPage(); availableLines = Math.floor((y - 45 - 16) / lineHeight); }
      const count = Math.min(availableLines, totalLines - offset);
      const height = Math.max(34, count * lineHeight + 16);
      page.drawRectangle({ x: 32, y: y - height, width: 777.89, height, color: index % 2 ? rgb(0.96, 0.97, 0.98) : rgb(1, 1, 1) });
      let x = 32;
      cells.forEach((lines, i) => {
        // Repeat identifying cells when one shift has more batches than fit on
        // a page. All allocation detail is retained on continuation pages.
        const visible = offset && i === 2 ? ['Allocation continued']
          : offset && i < 6 ? lines : lines.slice(offset, offset + count);
        visible.forEach((line, n) => text(line, x + 6, y - 15 - n * lineHeight, i === 2 ? bold : regular));
        x += widths[i];
      });
      page.drawLine({ start: { x: 32, y: y - height }, end: { x: 809.89, y: y - height }, thickness: 0.4, color: rgb(0.86, 0.9, 0.92) });
      y -= height;
      offset += count;
      if (offset < totalLines) addPage();
    }
  });
  if (!rows.length) text('No zinc stock transactions have been recorded.', 38, y - 25);
  if (options.includeFooter !== false) drawReportFooters(pdf, { regular, bold }, 'Zinc inventory ledger | Quantities in kg | Dates DD/MM/YYYY');
  return Buffer.from(await pdf.save());
}

module.exports = { generateZincStockPdf, reportCells, wrap };
