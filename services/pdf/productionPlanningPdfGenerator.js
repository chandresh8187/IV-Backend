const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PAGE = { width: 841.89, height: 595.28, margin: 42 };
const C = { navy: rgb(.04,.12,.23), blue: rgb(.15,.39,.82), green: rgb(.08,.48,.32), amber: rgb(.62,.36,.08), text: rgb(.1,.18,.3), muted: rgb(.36,.42,.5), line: rgb(.86,.89,.93), soft: rgb(.96,.97,.99), white: rgb(1,1,1) };
const num = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const fit = (value, font, size, width) => {
  let result = String(value || '-').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim() || '-';
  if (font.widthOfTextAtSize(result, size) <= width) return result;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > width) result = result.slice(0, -1);
  return `${result}...`;
};

const generateProductionPlanningPdf = async ({ planning, items }) => {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = PAGE.width - PAGE.margin * 2;
  let page, y;
  const text = (value, x, baseline, size = 9, font = regular, color = C.text) => page.drawText(value, { x, y: baseline, size, font, color });
  const label = (value, x, baseline, color = C.muted) => text(value, x, baseline, 8, bold, color);
  const addPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - PAGE.margin - 44;
  };
  const stat = (x, top, statWidth, title, value, color) => {
    page.drawRectangle({ x, y: top - 43, width: statWidth, height: 43, color: C.soft, borderColor: C.line, borderWidth: .7 });
    label(title, x + 10, top - 14);
    text(value, x + 10, top - 32, 13, bold, color);
  };

  addPage();
  const plannedTotal = items.reduce((sum, item) => sum + Number(item.planned_qty || 0), 0);
  const producedTotal = items.reduce((sum, item) => sum + Number(item.completed_qty || 0), 0);
  page.drawRectangle({ x: PAGE.margin, y: y - 92, width, height: 92, color: C.white, borderColor: C.line, borderWidth: 1 });
  label(`FLOW #${planning.id || '-'}  |  ${items.length} CHALLAN${items.length === 1 ? '' : 'S'}`, PAGE.margin + 14, y - 16, C.blue);
  text(`Status: ${String(planning.status || 'pending').toUpperCase()}`, PAGE.width - PAGE.margin - 135, y - 16, 8, bold, C.navy);
  const statWidth = (width - 48) / 3;
  stat(PAGE.margin + 14, y - 27, statWidth, 'PLANNED QTY', `${num(plannedTotal)} NOS`, C.navy);
  stat(PAGE.margin + 14 + statWidth + 10, y - 27, statWidth, 'PRODUCED QTY', `${num(producedTotal)} NOS`, C.green);
  stat(PAGE.margin + 14 + (statWidth + 10) * 2, y - 27, statWidth, 'PENDING QTY', `${num(Math.max(0, plannedTotal - producedTotal))} NOS`, C.amber);
  y -= 112;
  label('CHALLAN PROGRESS', PAGE.margin, y, C.navy);
  y -= 15;

  items.forEach((item, index) => {
    const height = 129;
    if (y - height < 52) {
      addPage();
      label('CHALLAN PROGRESS (CONTINUED)', PAGE.margin, y, C.navy);
      y -= 16;
    }
    const top = y;
    const planned = Number(item.planned_qty || 0);
    const produced = Number(item.completed_qty || 0);
    const pending = Math.max(0, planned - produced);
    const percent = planned > 0 ? Math.min(100, Math.max(0, produced / planned * 100)) : 0;
    page.drawRectangle({ x: PAGE.margin, y: top - height, width, height, color: C.white, borderColor: C.line, borderWidth: 1 });
    page.drawRectangle({ x: PAGE.margin, y: top - 31, width, height: 31, color: C.soft });
    text(`${index + 1}.  ${fit(item.challan_no, bold, 11, 350)}`, PAGE.margin + 12, top - 20, 11, bold, C.navy);
    text(`Zinc target: ${num(item.target_zinc_percentage)}%`, PAGE.margin + 445, top - 20, 8, bold, C.muted);
    text(pending === 0 && planned > 0 ? 'COMPLETED' : 'IN PROGRESS', PAGE.width - PAGE.margin - 104, top - 20, 9, bold, pending === 0 ? C.green : C.amber);
    label('PARTY', PAGE.margin + 12, top - 48);
    text(fit(item.party_name, regular, 9, 315), PAGE.margin + 12, top - 61);
    label('MATERIAL', PAGE.margin + 340, top - 48);
    text(fit(item.material_description || item.item_name, regular, 9, 320), PAGE.margin + 340, top - 61);
    [
      ['PLANNED', `${num(planned)} NOS`, C.navy],
      ['PRODUCED', `${num(produced)} NOS`, C.green],
      ['PENDING', `${num(pending)} NOS`, C.amber],
    ].forEach(([title, value, color], i) => {
      const x = PAGE.margin + 12 + i * (statWidth + 12);
      label(title, x, top - 76);
      text(value, x, top - 93, 12, bold, color);
    });
    const barX = PAGE.margin + 12, barWidth = width - 135;
    page.drawRectangle({ x: barX, y: top - 118, width: barWidth, height: 5, color: C.line });
    if (percent > 0) page.drawRectangle({ x: barX, y: top - 118, width: barWidth * percent / 100, height: 5, color: C.blue });
    text(`${num(percent)}% done`, PAGE.width - PAGE.margin - 105, top - 119, 8, bold, C.blue);
    y -= height + 13;
  });

  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    current.drawText('IV SQUARE STRUCTURE INDIA PVT LTD', { x: PAGE.margin, y: PAGE.height - PAGE.margin, size: 15, font: bold, color: C.navy });
    current.drawText('PRODUCTION PLANNING REPORT', { x: PAGE.width - PAGE.margin - 220, y: PAGE.height - PAGE.margin + 1, size: 11, font: bold, color: C.blue });
    current.drawLine({ start: { x: PAGE.margin, y: PAGE.height - PAGE.margin - 20 }, end: { x: PAGE.width - PAGE.margin, y: PAGE.height - PAGE.margin - 20 }, thickness: 2, color: C.blue });
    current.drawLine({ start: { x: PAGE.margin, y: 44 }, end: { x: PAGE.width - PAGE.margin, y: 44 }, thickness: .7, color: C.line });
    current.drawText(`Generated ${new Date().toLocaleString('en-IN')}`, { x: PAGE.margin, y: 30, size: 7.5, font: regular, color: C.muted });
    current.drawText(`Page ${index + 1} of ${pages.length}`, { x: PAGE.width - PAGE.margin - 58, y: 30, size: 7.5, font: regular, color: C.muted });
  });
  return Buffer.from(await pdf.save());
};

module.exports = { generateProductionPlanningPdf };
