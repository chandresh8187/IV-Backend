const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const PAGE = { width: 841.89, height: 595.28, margin: 42 };
const COLORS = {
  navy: rgb(0.04, 0.12, 0.23),
  blue: rgb(0.15, 0.39, 0.92),
  text: rgb(0.1, 0.18, 0.3),
  muted: rgb(0.36, 0.42, 0.5),
  line: rgb(0.86, 0.89, 0.93),
  soft: rgb(0.95, 0.97, 0.99),
  white: rgb(1, 1, 1),
};

const formatNumber = (value) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

const fitText = (text, font, size, maxWidth) => {
  const value = String(text || "-");
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let output = value;
  while (output.length > 1 && font.widthOfTextAtSize(`${output}...`, size) > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}...`;
};

const generateProductionPlanningPdf = async ({ planning, items }) => {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page;
  let y;

  const addPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - PAGE.margin;
    page.drawText("IV SQUARE STRUCTURE INDIA PVT LTD", {
      x: PAGE.margin,
      y,
      size: 16,
      font: bold,
      color: COLORS.navy,
    });
    page.drawText("PRODUCTION PLANNING", {
      x: PAGE.width - PAGE.margin - 168,
      y: y + 1,
      size: 12,
      font: bold,
      color: COLORS.blue,
    });
    y -= 20;
    page.drawLine({
      start: { x: PAGE.margin, y },
      end: { x: PAGE.width - PAGE.margin, y },
      thickness: 2,
      color: COLORS.blue,
    });
    y -= 28;
  };

  const drawTableHeader = () => {
    const columns = [
      { label: "#", x: 46, width: 22 },
      { label: "Challan", x: 70, width: 140 },
      { label: "Party", x: 215, width: 135 },
      { label: "Material", x: 355, width: 160 },
      { label: "Planned", x: 520, width: 55 },
      { label: "Completed", x: 580, width: 60 },
      { label: "Balance", x: 645, width: 55 },
      { label: "Zn target", x: 705, width: 65 },
    ];
    page.drawRectangle({
      x: PAGE.margin,
      y: y - 20,
      width: PAGE.width - PAGE.margin * 2,
      height: 24,
      color: COLORS.navy,
    });
    columns.forEach((column) => {
      page.drawText(column.label, {
        x: column.x,
        y: y - 13,
        size: 8.5,
        font: bold,
        color: COLORS.white,
      });
    });
    y -= 24;
  };

  addPage();
  page.drawRectangle({
    x: PAGE.margin,
    y: y - 70,
    width: PAGE.width - PAGE.margin * 2,
    height: 78,
    color: COLORS.soft,
    borderColor: COLORS.line,
    borderWidth: 1,
  });
  page.drawText("Production flow", {
    x: 56,
    y: y - 14,
    size: 8,
    font: regular,
    color: COLORS.muted,
  });
  page.drawText(`#${planning.id || "-"}`, {
    x: 56,
    y: y - 34,
    size: 15,
    font: bold,
    color: COLORS.navy,
  });
  page.drawText("Status", {
    x: 650,
    y: y - 14,
    size: 8,
    font: regular,
    color: COLORS.muted,
  });
  page.drawText(String(planning.status || "pending").toUpperCase(), {
    x: 650,
    y: y - 34,
    size: 11,
    font: bold,
    color: COLORS.blue,
  });
  page.drawText(
    `Items: ${items.length}    Planned: ${formatNumber(planning.planned_qty)} NOS    Completed: ${formatNumber(planning.completed_qty)} NOS`,
    {
      x: 56,
      y: y - 57,
      size: 9,
      font: regular,
      color: COLORS.text,
    },
  );
  y -= 102;
  page.drawText("PLANNED ITEM FLOW", {
    x: PAGE.margin,
    y,
    size: 10,
    font: bold,
    color: COLORS.navy,
  });
  y -= 14;
  drawTableHeader();

  items.forEach((item, index) => {
    if (y < 80) {
      addPage();
      page.drawText("PLANNED ITEM FLOW (CONTINUED)", {
        x: PAGE.margin,
        y,
        size: 10,
        font: bold,
        color: COLORS.navy,
      });
      y -= 14;
      drawTableHeader();
    }

    const rowY = y - 20;
    if (index % 2 === 1) {
      page.drawRectangle({
        x: PAGE.margin,
        y: rowY,
        width: PAGE.width - PAGE.margin * 2,
        height: 26,
        color: COLORS.soft,
      });
    }
    const values = [
      String(index + 1),
      fitText(item.challan_no, regular, 8.5, 136),
      fitText(item.party_name, regular, 8.5, 130),
      fitText(item.material_description || item.item_name, regular, 8.5, 155),
      formatNumber(item.planned_qty),
      formatNumber(item.completed_qty),
      formatNumber(Number(item.planned_qty) - Number(item.completed_qty)),
      `${formatNumber(item.target_zinc_percentage)}%`,
    ];
    const positions = [46, 70, 215, 355, 520, 580, 645, 705];
    values.forEach((value, valueIndex) => {
      page.drawText(value, {
        x: positions[valueIndex],
        y: rowY + 9,
        size: 9,
        font: valueIndex === 3 ? bold : regular,
        color: COLORS.text,
      });
    });
    page.drawLine({
      start: { x: PAGE.margin, y: rowY },
      end: { x: PAGE.width - PAGE.margin, y: rowY },
      thickness: 0.5,
      color: COLORS.line,
    });
    y -= 26;
  });

  y -= 20;
  page.drawText("Production follows the item order shown above.", {
    x: PAGE.margin,
    y,
    size: 9,
    font: regular,
    color: COLORS.muted,
  });
  page.drawText(`Generated ${new Date().toLocaleString("en-IN")}`, {
    x: PAGE.margin,
    y: 32,
    size: 7.5,
    font: regular,
    color: COLORS.muted,
  });

  return Buffer.from(await pdf.save());
};

module.exports = { generateProductionPlanningPdf };
