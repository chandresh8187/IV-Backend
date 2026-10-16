const { REPORT_COLORS: C, cleanReportText, drawReportHeader } = require('./reportBranding');

function wrapReportText(value, font, size, width) {
  const lines = [];
  for (const paragraph of String(value ?? '-').split('\n')) {
    let line = '';
    for (const char of cleanReportText(paragraph) || '-') {
      if (font.widthOfTextAtSize(line + char, size) > width && line) {
        const space = line.lastIndexOf(' ');
        if (space > line.length / 2) { lines.push(line.slice(0, space)); line = line.slice(space + 1) + char; }
        else { lines.push(line); line = char; }
      } else line += char;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function createReportLayout(pdf, fonts, logo, { title, subtitle, margin = 32 }) {
  const width = 841.89 - margin * 2, bottom = 50;
  let page, y;
  const draw = (value, x, baseline, size = 9, font = fonts.regular, color = C.text) => {
    page.drawText(cleanReportText(value), { x, y: baseline, size, font, color });
  };
  const addPage = () => { page = pdf.addPage([841.89, 595.28]); y = drawReportHeader(page, fonts, logo, { title, subtitle, margin }); };
  const ensure = height => { if (!page || y - height < bottom) addPage(); };
  const section = (label, reserve = 70) => {
    ensure(reserve);
    page.drawRectangle({ x: margin, y: y - 24, width, height: 24, color: C.navy });
    draw(label, margin + 10, y - 16, 10, fonts.bold, C.white);
    y -= 34;
  };
  const metrics = (items, columns = 4, compact = false) => {
    const cellHeight = compact ? 56 : 64, rowHeight = cellHeight + 14;
    for (let start = 0; start < items.length; start += columns) {
      ensure(rowHeight);
      const cellWidth = (width - (columns - 1) * 10) / columns;
      items.slice(start, start + columns).forEach(([label, value], index) => {
        const x = margin + index * (cellWidth + 10);
        page.drawRectangle({ x, y: y - cellHeight, width: cellWidth, height: cellHeight, color: C.pale });
        wrapReportText(label, fonts.regular, 8, cellWidth - 20).forEach((line, i) => draw(line, x + 10, y - 15 - i * 10, 8, fonts.regular, C.muted));
        const text = cleanReportText(value), size = Math.min(18, (cellWidth - 20) / fonts.bold.widthOfTextAtSize(text || '-', 1));
        draw(text, x + 10, y - cellHeight + 17, size, fonts.bold, C.navy);
      });
      y -= rowHeight;
    }
  };
  const panels = panels => {
    const panelWidth = (width - 16) / 2;
    const height = Math.max(...panels.map(panel => panel.rows.length)) * 21 + 43;
    ensure(height + 12);
    panels.forEach((panel, index) => {
      const x = margin + index * (panelWidth + 16);
      page.drawRectangle({ x, y: y - height, width: panelWidth, height, color: C.white, borderColor: C.line, borderWidth: .7 });
      page.drawRectangle({ x, y: y - 28, width: panelWidth, height: 28, color: C.pale });
      draw(panel.title, x + 12, y - 18, 10, fonts.bold, C.navy);
      panel.rows.forEach(([label, value], i) => {
        const baseline = y - 46 - i * 21;
        draw(label, x + 12, baseline, 8, fonts.regular, C.muted);
        const text = cleanReportText(value), size = Math.min(9, 150 / fonts.bold.widthOfTextAtSize(text || '-', 1));
        draw(text, x + panelWidth - 12 - fonts.bold.widthOfTextAtSize(text, size), baseline, size, fonts.bold, C.navy);
      });
    });
    y -= height + 14;
  };
  const table = (label, columns, rows = []) => {
    const widths = columns.map(column => width * column.weight / columns.reduce((sum, col) => sum + col.weight, 0));
    const header = continued => {
      section(label + (continued ? ' (CONTINUED)' : ''), 85);
      page.drawRectangle({ x: margin, y: y - 23, width, height: 23, color: C.pale });
      let x = margin;
      columns.forEach((column, i) => { draw(column.title, x + 8, y - 15, 8, fonts.bold, C.navy); x += widths[i]; });
      y -= 23;
    };
    header(false);
    if (!rows.length) {
      draw('No records for this period.', margin + 8, y - 18, 9, fonts.regular, C.muted);
      y -= 40;
      return;
    }
    rows.forEach((row, index) => {
      const cells = columns.map((column, i) => wrapReportText(column.format ? column.format(row[column.key], row) : row[column.key], fonts.regular, 8.5, widths[i] - 16));
      const totalLines = Math.max(...cells.map(lines => lines.length));
      const fullHeight = Math.max(24, totalLines * 11 + 12);
      if (fullHeight < 290 && y - fullHeight < bottom) { addPage(); header(true); }
      let offset = 0;
      while (offset < totalLines) {
        let capacity = Math.floor((y - bottom - 12) / 11);
        if (capacity < 1) { addPage(); header(true); capacity = Math.floor((y - bottom - 12) / 11); }
        const count = Math.min(capacity, totalLines - offset), height = Math.max(24, count * 11 + 12);
        if (index % 2 === 0) page.drawRectangle({ x: margin, y: y - height, width, height, color: C.pale });
        let x = margin;
        columns.forEach((column, i) => {
          cells[i].slice(offset, offset + count).forEach((line, n) => {
            const textWidth = fonts.regular.widthOfTextAtSize(line, 8.5);
            draw(line, column.align === 'right' ? x + widths[i] - 8 - textWidth : x + 8, y - 17 - n * 11, 8.5);
          });
          x += widths[i];
        });
        page.drawLine({ start: { x: margin, y: y - height }, end: { x: margin + width, y: y - height }, thickness: .3, color: C.line });
        y -= height;
        offset += count;
        if (offset < totalLines) { addPage(); header(true); }
      }
    });
    y -= 14;
  };
  const note = text => {
    const lines = wrapReportText(text, fonts.regular, 8, width);
    ensure(lines.length * 11 + 12);
    lines.forEach((line, i) => draw(line, margin, y - 12 - i * 11, 8, fonts.regular, C.muted));
    y -= lines.length * 11 + 12;
  };
  return { addPage, metrics, panels, section, table, note };
}
module.exports = { createReportLayout, wrapReportText };
