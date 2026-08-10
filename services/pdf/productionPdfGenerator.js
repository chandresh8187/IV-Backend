const { Buffer } = require("buffer");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { readPdfAsset } = require("./pdfAssets");

const PAGE = {
  width: 841.89,
  height: 595.28,
  margin: 30,
};

const A4_LANDSCAPE = [PAGE.width, PAGE.height];
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

/* -------------------------------------------------------------------------- */
/* PALETTE - matches certificatePdfGenerator.js: white letterhead, navy text, */
/* light-gray table panels, amber accent line                                */
/* -------------------------------------------------------------------------- */
const COLORS = {
  navy: rgb(0.086, 0.114, 0.235),
  steel: rgb(0.204, 0.396, 0.612),
  amber: rgb(0.788, 0.6, 0.098),
  white: rgb(1, 1, 1),
  bgPanel: rgb(0.945, 0.95, 0.958),
  rowAlt: rgb(0.965, 0.968, 0.975),
  border: rgb(0.25, 0.27, 0.32),
  borderLight: rgb(0.65, 0.68, 0.73),
  text: rgb(0.1, 0.11, 0.15),
  textMuted: rgb(0.4, 0.43, 0.49),
};

/* -------------------------------------------------------------------------- */
/* TEXT HELPERS                                                              */
/* -------------------------------------------------------------------------- */
const cleanPdfText = value => {
  if (value === null || value === undefined || value === '') return '-';
  return (
    String(value)
      .replace(/\u202f/g, ' ')
      .replace(/\u00a0/g, ' ')
      // Superscript-two (U+00B2) renders fine with the standard Helvetica
      // fonts (WinAnsi encoding) - kept explicitly rather than stripped.
      .replace(/[^\x20-\x7E\u00B2]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
};

const safeValue = value =>
  value !== null && value !== undefined && value !== '' ? value : '-';

const safeKg = value =>
  value !== null && value !== undefined && value !== ''
    ? `${Number(value).toLocaleString('en-IN')} KG`
    : '-';

const formatTime12Hour = value => {
  if (value === null || value === undefined || value === '') return '-';

  const match = String(value)
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);

  if (!match) return safeValue(value);

  let hour = Number(match[1]);
  const minute = match[2];
  const existingPeriod = match[3]?.toUpperCase();

  if (existingPeriod) {
    hour = hour % 12 || 12;
    return `${String(hour).padStart(2, '0')}:${minute} ${existingPeriod}`;
  }

  if (hour > 23) return safeValue(value);

  const period = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;

  return `${String(hour).padStart(2, '0')}:${minute} ${period}`;
};

/**
 * Wrap text into lines that actually fit a given pixel width, measured with
 * real font metrics (font.widthOfTextAtSize) instead of a character-count
 * guess - this is what lets long Party / Material values wrap correctly
 * instead of being cut off mid-word.
 */
const wrapTextToWidth = (font, text, size, maxWidth, maxLines = 3) => {
  const words = cleanPdfText(text).split(' ');
  const lines = [];
  let line = '';

  words.forEach(word => {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);

  return lines.slice(0, maxLines);
};

const drawText = (page, text, x, y, options = {}) => {
  page.drawText(cleanPdfText(text), {
    x,
    y,
    size: options.size || 8,
    font: options.font,
    color: options.color || COLORS.text,
    maxWidth: options.maxWidth,
  });
};

const drawCenteredText = (page, text, x, y, width, height, options = {}) => {
  const value = cleanPdfText(text);
  const font = options.font;
  const size = options.size || 8;
  const textWidth = font.widthOfTextAtSize(value, size);

  page.drawText(value, {
    x: x + Math.max(2, (width - textWidth) / 2),
    y: y + (height - size) / 2 + 1,
    size,
    font,
    color: options.color || COLORS.text,
  });
};

const drawCenteredLines = (
  page,
  lines,
  x,
  y,
  width,
  height,
  options = {},
) => {
  const font = options.font;
  const size = options.size || 8;
  const lineHeight = options.lineHeight || size + 1;
  const firstBaseline =
    y + (height - size + (lines.length - 1) * lineHeight) / 2 + 1;

  lines.forEach((line, index) => {
    const textWidth = font.widthOfTextAtSize(line, size);
    page.drawText(line, {
      x: x + Math.max(3, (width - textWidth) / 2),
      y: firstBaseline - index * lineHeight,
      size,
      font,
      color: options.color || COLORS.text,
    });
  });
};

const drawRoundedBox = (page, x, y, width, height, options = {}) => {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: options.bg || COLORS.white,
    borderColor: options.borderColor || COLORS.border,
    borderWidth: options.borderWidth ?? 0.6,
  });
};

/* -------------------------------------------------------------------------- */
/* COMPANY LOGO - same lookup as certificatePdfGenerator.js:                 */
/*   Android -> android/app/src/main/assets/logo.png                         */
/*   iOS     -> logo.png added to the Xcode bundle resources                 */
/* Falls back to an "IV" monogram block if the file isn't found, so a        */
/* missing logo never breaks report generation.                             */
/* -------------------------------------------------------------------------- */
const loadLogoImage = async pdfDoc => {
  const imageBytes = readPdfAsset("IV_logo.png");
  if (!imageBytes) return null;

  try {
    return await pdfDoc.embedPng(imageBytes);
  } catch (error) {
    return null;
  }
};

/* -------------------------------------------------------------------------- */
/* REPORT ID                                                                 */
/* -------------------------------------------------------------------------- */
const buildReportNo = (date, shiftName) => {
  const compactDate =
    String(date)
      .replace(/[^0-9]/g, '')
      .slice(0, 8) || '00000000';
  const shiftCode = String(shiftName || 'GEN')
    .slice(0, 1)
    .toUpperCase();
  return `PR-${compactDate}-${shiftCode}`;
};

/* -------------------------------------------------------------------------- */
/* HEADER - same letterhead proportions and typography as the certificate.  */
/* -------------------------------------------------------------------------- */
const COMPANY_ADDRESS_LINES = [
  'PLANT-4, PLOT NO. 2526, NEAR MASCUT POLYMER, NEAR RADHE FORGE,',
  'VERAVAL-SHAPAR RAJKOT - 360024 (Guj) INDIA.',
];

const drawHeader = ({
  page,
  fonts,
  date,
  shiftName,
  reportType,
  logoImage,
}) => {
  const topY = PAGE.height - PAGE.margin;

  drawText(page, 'IV SQUARE STRUCTURE INDIA PVT LTD', PAGE.margin, topY - 30, {
    size: 15,
    font: fonts.bold,
    color: COLORS.navy,
  });
  COMPANY_ADDRESS_LINES.forEach((line, index) => {
    drawText(page, line, PAGE.margin, topY - 42 - index * 9, {
      size: 7,
      font: fonts.regular,
      color: COLORS.textMuted,
    });
  });

  const logoBoxW = 140;
  const logoBoxH = 60;
  const logoX = PAGE.width - PAGE.margin - logoBoxW;
  const logoY = topY - logoBoxH - 2;

  if (logoImage) {
    const scale = Math.min(
      logoBoxW / logoImage.width,
      logoBoxH / logoImage.height,
    );
    const width = logoImage.width * scale;
    const height = logoImage.height * scale;
    page.drawImage(logoImage, {
      x: logoX + (logoBoxW - width) / 2,
      y: logoY + (logoBoxH - height) / 2,
      width,
      height,
    });
  } else {
    drawRoundedBox(page, logoX + logoBoxW - 48, logoY + 12, 44, 44, {
      bg: COLORS.steel,
      borderColor: COLORS.amber,
      borderWidth: 1.2,
    });
    drawCenteredText(page, 'IV', logoX + logoBoxW - 48, logoY + 12, 44, 44, {
      font: fonts.bold,
      size: 20,
      color: COLORS.white,
    });
  }

  const titleY = topY - 86;
  drawCenteredText(
    page,
    reportType === 'challan'
      ? `${String(shiftName).toUpperCase()} PRODUCTION REPORT`
      : `${String(shiftName).toUpperCase()} SHIFT PRODUCTION REPORT`,
    PAGE.margin,
    titleY,
    CONTENT_WIDTH,
    14,
    { font: fonts.bold, size: 11, color: COLORS.text },
  );

  return titleY - 8;
};

const drawReportInfoBlock = ({
  page,
  fonts,
  date,
  shiftName,
  startY,
  tableWidth,
}) => {
  const pairWidth = tableWidth / 2;
  const labelWidth = 82;
  const rowHeight = 17;
  const rows = [
    [
      ['Report No.', buildReportNo(date, shiftName)],
      ['Date', date],
    ],
    [
      ['Shift / Report', String(shiftName).toUpperCase()],
      ['Generated On', new Date().toLocaleString('en-IN')],
    ],
  ];
  let y = startY;

  rows.forEach(row => {
    const rowBottom = y - rowHeight;

    row.forEach(([label, value], index) => {
      const pairX = PAGE.margin + index * pairWidth;

      drawRoundedBox(page, pairX, rowBottom, labelWidth, rowHeight, {
        borderWidth: 0.7,
      });
      drawRoundedBox(
        page,
        pairX + labelWidth,
        rowBottom,
        pairWidth - labelWidth,
        rowHeight,
        { borderWidth: 0.7 },
      );

      drawText(page, label, pairX + 6, y - 11.5, {
        size: 7.2,
        font: fonts.bold,
      });
      drawText(
        page,
        `:  ${safeValue(value)}`,
        pairX + labelWidth + 6,
        y - 11.5,
        { size: 7.2, font: fonts.regular },
      );
    });

    y = rowBottom;
  });

  return y;
};

/* -------------------------------------------------------------------------- */
/* CONTINUATION BANNER (subsequent pages)                                    */
/* -------------------------------------------------------------------------- */
const drawContinuationBar = ({
  page,
  fonts,
  date,
  shiftName,
  reportType,
  pageNumber,
  tableWidth,
}) => {
  const topY = PAGE.height - PAGE.margin;

  drawRoundedBox(page, PAGE.margin, topY - 22, tableWidth, 22, {
    bg: COLORS.bgPanel,
    borderColor: COLORS.border,
  });
  drawText(
    page,
    `Production Table (Continued) - ${String(shiftName).toUpperCase()}${
      reportType === 'challan' ? '' : ' SHIFT'
    } - ${date}`,
    PAGE.margin + 10,
    topY - 15,
    { size: 8.5, font: fonts.bold, color: COLORS.navy },
  );
  drawText(
    page,
    `Page ${pageNumber}`,
    PAGE.margin + tableWidth - 55,
    topY - 15,
    { size: 8.5, font: fonts.bold, color: COLORS.textMuted },
  );

  // drawTableHeader uses its y value as the rectangle's bottom edge. Leave
  // room for the header itself so it cannot overlap this continuation bar.
  return topY - 22 - 12 - TABLE_HEADER_HEIGHT;
};

/* -------------------------------------------------------------------------- */
/* SUMMARY TABLE - certificate-style bordered labels and values.             */
/* -------------------------------------------------------------------------- */
const drawSummaryTable = ({ page, fonts, summary, topY, tableWidth }) => {
  const zincConsumption = Number(summary?.zinc_consumption || 0);
  const items = [
    {
      label: 'Total MS Production',
      value: safeKg(summary?.total_ms_production_kg),
    },
    {
      label: 'Total GI Production',
      value: safeKg(summary?.total_gi_production_kg),
    },
    {
      label: 'Total Zinc Used',
      value: safeKg(summary?.zink_used),
    },
    {
      label: 'Zinc Consumption',
      value: `${zincConsumption}%`,
    },
  ];
  const labelHeight = 16;
  const valueHeight = 24;
  const itemWidth = tableWidth / items.length;
  const labelY = topY - labelHeight;
  const valueY = labelY - valueHeight;

  items.forEach((item, index) => {
    const x = PAGE.margin + index * itemWidth;

    drawRoundedBox(page, x, labelY, itemWidth, labelHeight, {
      bg: COLORS.bgPanel,
      borderWidth: 0.7,
    });
    drawCenteredText(page, item.label, x, labelY, itemWidth, labelHeight, {
      font: fonts.bold,
      size: 7,
      color: COLORS.text,
    });

    drawRoundedBox(page, x, valueY, itemWidth, valueHeight, {
      borderWidth: 0.7,
    });
    drawCenteredText(page, item.value, x, valueY, itemWidth, valueHeight, {
      font: fonts.bold,
      size: 10,
      color: COLORS.text,
    });
  });

  return valueY;
};

/* TABLE                                                                     */
/* -------------------------------------------------------------------------- */
const standardColumns = [
  { label: 'Sr', key: 'sr_no', width: 24, lines: 1 },
  { label: 'Time', key: 'production_time', width: 40, lines: 1 },
  { label: 'Challan No.', key: 'challan_no', width: 62, lines: 2 },
  { label: 'Party Name', key: 'party_name', width: 95, lines: 3 },
  { label: 'Material Description', key: 'material', width: 145, lines: 4 },
  { label: 'Kettle Temp', key: 'kettle_temperature', width: 38, lines: 1 },
  { label: 'Dipping Qty', key: 'dipping_qty', width: 36, lines: 1 },
  { label: 'MS Wt.', key: 'ms_weight', width: 40, lines: 1 },
  { label: 'GI Wt.', key: 'gi_weight', width: 40, lines: 1 },
  { label: 'Zn %', key: 'zinc_percentage', width: 34, lines: 1 },
  { label: 'C1', key: 'c1', width: 30, lines: 1 },
  { label: 'C2', key: 'c2', width: 30, lines: 1 },
  { label: 'C3', key: 'c3', width: 30, lines: 1 },
  { label: 'C4', key: 'c4', width: 30, lines: 1 },
  { label: 'C5', key: 'c5', width: 30, lines: 1 },
  { label: 'Avg.', key: 'avg_coating', width: 44, lines: 1 },
];

const challanColumns = [
  { label: 'Sr', key: 'sr_no', width: 22, lines: 1 },
  { label: 'Production Date', key: 'shift_date', width: 54, lines: 2 },
  { label: 'Shift', key: 'shift_name', width: 36, lines: 1 },
  { label: 'Time', key: 'production_time', width: 46, lines: 1 },
  { label: 'Challan No.', key: 'challan_no', width: 55, lines: 2 },
  { label: 'Party Name', key: 'party_name', width: 85, lines: 3 },
  { label: 'Material Description', key: 'material', width: 125, lines: 4 },
  { label: 'Kettle Temp', key: 'kettle_temperature', width: 34, lines: 1 },
  { label: 'Dipping Qty', key: 'dipping_qty', width: 34, lines: 1 },
  { label: 'MS Wt.', key: 'ms_weight', width: 36, lines: 1 },
  { label: 'GI Wt.', key: 'gi_weight', width: 36, lines: 1 },
  { label: 'Zn %', key: 'zinc_percentage', width: 32, lines: 1 },
  { label: 'C1', key: 'c1', width: 26, lines: 1 },
  { label: 'C2', key: 'c2', width: 26, lines: 1 },
  { label: 'C3', key: 'c3', width: 26, lines: 1 },
  { label: 'C4', key: 'c4', width: 26, lines: 1 },
  { label: 'C5', key: 'c5', width: 26, lines: 1 },
  { label: 'Avg.', key: 'avg_coating', width: 37, lines: 1 },
];

const CELL_FONT_SIZE = 5.9;
const CELL_LINE_HEIGHT = 7;
const MIN_ROW_HEIGHT = 23;
const TABLE_HEADER_HEIGHT = 24;

// Light-panel table header - matches the certificate's checklist/readings
// tables (bordered, bgPanel fill, navy bold text) instead of a solid navy
// band, so both documents read as the same product.
const drawTableHeader = (page, fonts, y, columns) => {
  let x = PAGE.margin;

  columns.forEach(col => {
    page.drawRectangle({
      x,
      y,
      width: col.width,
      height: TABLE_HEADER_HEIGHT,
      color: COLORS.bgPanel,
      borderColor: COLORS.border,
      borderWidth: 0.6,
    });

    const headerLines = wrapTextToWidth(
      fonts.bold,
      col.label,
      5.8,
      col.width - 8,
      2,
    );
    drawCenteredLines(page, headerLines, x, y, col.width, TABLE_HEADER_HEIGHT, {
      font: fonts.bold,
      size: 5.8,
      lineHeight: 6.8,
      color: COLORS.navy,
    });

    x += col.width;
  });
};

const getCellValue = (row, key) => {
  const value = row?.[key];
  if (key === 'production_time') return formatTime12Hour(value);
  if (key === 'shift_name') return String(safeValue(value)).toUpperCase();
  if (key === 'ms_weight' || key === 'gi_weight') return safeValue(value);
  if (key === 'zinc_percentage') {
    return value !== null && value !== undefined && value !== ''
      ? `${value}%`
      : '-';
  }
  return safeValue(value);
};

/**
 * Wrap every cell of a row against its column's real width, and work out
 * how tall the row needs to be to show the tallest cell in full - this is
 * what lets long Material Description values display completely instead
 * of being cut off with "...".
 */
const measureRow = (fonts, row, columns) => {
  const cellLines = columns.map(col =>
    wrapTextToWidth(
      fonts.regular,
      getCellValue(row, col.key),
      CELL_FONT_SIZE,
      col.width - 8,
      col.lines || 3,
    ),
  );

  const maxLinesUsed = Math.max(1, ...cellLines.map(l => l.length));
  const rowHeight = Math.max(
    MIN_ROW_HEIGHT,
    12 + maxLinesUsed * CELL_LINE_HEIGHT,
  );

  return { cellLines, rowHeight };
};

const drawCell = (page, lines, x, y, width, height, options = {}) => {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: options.bg || COLORS.white,
    borderColor: options.borderColor || COLORS.borderLight,
    borderWidth: 0.45,
  });

  drawCenteredLines(page, lines, x, y, width, height, {
    font: options.font,
    size: options.size || CELL_FONT_SIZE,
    lineHeight: CELL_LINE_HEIGHT,
    color: options.color || COLORS.text,
  });
};

/* -------------------------------------------------------------------------- */
/* FOOTER + SIGNATURE STRIP                                                  */
/* -------------------------------------------------------------------------- */
const drawFooter = (page, fonts, pageNumber, isLastPage) => {
  if (isLastPage) {
    const signY = 46;
    const signW = (CONTENT_WIDTH - 20) / 3;
    const labels = [
      'Prepared By',
      'Checked By (Shift Supervisor)',
      'Approved By (Plant Manager)',
    ];

    labels.forEach((label, index) => {
      const x = PAGE.margin + index * (signW + 10);
      page.drawLine({
        start: { x, y: signY },
        end: { x: x + signW, y: signY },
        thickness: 0.7,
        color: COLORS.borderLight,
      });
      drawText(page, label, x, signY - 9, {
        size: 6.8,
        font: fonts.bold,
        color: COLORS.textMuted,
      });
    });
  }

  page.drawLine({
    start: { x: PAGE.margin, y: 24 },
    end: { x: PAGE.width - PAGE.margin, y: 24 },
    thickness: 0.6,
    color: COLORS.borderLight,
  });

  drawText(
    page,
    'Generated by IV Production App - System-generated document',
    PAGE.margin,
    12,
    { size: 6.5, font: fonts.regular, color: COLORS.textMuted },
  );

  drawText(page, `Page ${pageNumber}`, PAGE.width - PAGE.margin - 46, 12, {
    size: 6.5,
    font: fonts.bold,
    color: COLORS.textMuted,
  });
};

/* -------------------------------------------------------------------------- */
/* MAIN GENERATOR                                                            */
/* -------------------------------------------------------------------------- */
const generateProductionPdf = async ({
  date,
  shiftName,
  reportType,
  summary,
  tableData = [],
}) => {
  const pdfDoc = await PDFDocument.create();

  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };

  const logoImage = await loadLogoImage(pdfDoc);
  const columns = reportType === 'challan' ? challanColumns : standardColumns;
  const tableWidth = columns.reduce(
    (total, column) => total + column.width,
    0,
  );

  let pageNumber = 1;
  let page = pdfDoc.addPage(A4_LANDSCAPE);

  // Everything below chains off drawHeader's returned y instead of magic
  // numbers, so the header can grow/shrink without desyncing the rest of
  // the page.
  let y = drawHeader({
    page,
    fonts,
    date,
    shiftName,
    reportType,
    logoImage,
  });
  y = drawReportInfoBlock({
    page,
    fonts,
    date,
    shiftName,
    startY: y,
    tableWidth,
  });
  y -= 8;
  y = drawSummaryTable({ page, fonts, summary, topY: y, tableWidth });

  y -= TABLE_HEADER_HEIGHT + 10;
  drawTableHeader(page, fonts, y, columns);
  y -= TABLE_HEADER_HEIGHT;

  if (!tableData.length) {
    drawRoundedBox(page, PAGE.margin, y - 40, tableWidth, 40, {
      bg: COLORS.white,
    });
    drawText(
      page,
      'No production entries found for this shift.',
      PAGE.margin + 10,
      y - 18,
      { size: 9, font: fonts.bold, color: COLORS.textMuted },
    );
  }

  tableData.forEach((row, rowIndex) => {
    // Measure the row's real height (wrapped Party / Material text can
    // need extra lines) BEFORE the page-break check, so a tall row never
    // spills into the footer area.
    const { cellLines, rowHeight } = measureRow(fonts, row, columns);

    if (y - rowHeight < 47) {
      drawFooter(page, fonts, pageNumber, false);

      pageNumber += 1;
      page = pdfDoc.addPage(A4_LANDSCAPE);

      y = drawContinuationBar({
        page,
        fonts,
        date,
        shiftName,
        reportType,
        pageNumber,
        tableWidth,
      });
      drawTableHeader(page, fonts, y, columns);
      y -= TABLE_HEADER_HEIGHT;
    }

    // pdf-lib rectangles are anchored at their BOTTOM-left corner, so a
    // taller-than-minimum row must have its origin shifted further down
    // for its top edge to stay flush with the previous row's bottom edge.
    y -= rowHeight - MIN_ROW_HEIGHT;

    let x = PAGE.margin;
    const rowBg = rowIndex % 2 === 0 ? COLORS.white : COLORS.rowAlt;

    columns.forEach((col, colIndex) => {
      drawCell(page, cellLines[colIndex], x, y, col.width, rowHeight, {
        bg: rowBg,
        font: fonts.regular,
        size: CELL_FONT_SIZE,
      });
      x += col.width;
    });

    y -= MIN_ROW_HEIGHT;
  });

  drawFooter(page, fonts, pageNumber, true);

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
};

module.exports = { generateProductionPdf };
