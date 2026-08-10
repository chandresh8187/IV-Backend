const { Buffer } = require("buffer");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { readPdfAsset } = require("./pdfAssets");

const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 30,
};

const A4_PORTRAIT = [PAGE.width, PAGE.height];
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

// Avg. Coating in gm/mtrÂ² = avg micron x 7.14 (company calculation rule).
const ZINC_DENSITY_G_PER_M2_PER_MICRON = 7.14;

const COLORS = {
  navy: rgb(0.086, 0.114, 0.235),
  steel: rgb(0.204, 0.396, 0.612),
  amber: rgb(0.788, 0.6, 0.098),
  white: rgb(1, 1, 1),
  bgPanel: rgb(0.945, 0.95, 0.958),
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
      // Keep superscript-two (Â²): Helvetica's WinAnsi encoding renders it
      // fine, and stripping it turned "gm/mtrÂ²" into "gm/mtr ".
      .replace(/[^\x20-\x7E\u00B2]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
};

const safeValue = value =>
  value !== null && value !== undefined && value !== '' ? value : '-';

const roundedOrDash = value => {
  const n = toNumber(value);
  return n !== null ? String(Math.round(n)) : '-';
};

const toNumber = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const wrapTextToWidth = (font, text, size, maxWidth, maxLines = 4) => {
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

const drawRect = (page, x, y, width, height, options = {}) => {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: options.bg || COLORS.white,
    borderColor: options.borderColor || COLORS.border,
    borderWidth: options.borderWidth ?? 0.7,
  });
};

/* -------------------------------------------------------------------------- */
/* COMPANY LOGO                                                              */
/*                                                                            */
/* Tries to load a bundled "logo.png":                                        */
/*   Android -> put the file at android/app/src/main/assets/logo.png          */
/*   iOS     -> add logo.png to the Xcode project bundle resources            */
/* If the file is missing, the PDF falls back to a styled "IV" monogram, so   */
/* certificate generation never fails because of a missing logo.              */
/* -------------------------------------------------------------------------- */

const embedPngAsset = async (pdfDoc, filename) => {
  const imageBytes = readPdfAsset(filename);
  if (!imageBytes) return null;

  try {
    return await pdfDoc.embedPng(imageBytes);
  } catch (error) {
    return null;
  }
};

const loadStampImage = pdfDoc => embedPngAsset(pdfDoc, "stamp.png");
const loadLogoImage = pdfDoc => embedPngAsset(pdfDoc, "IV_logo.png");

/* -------------------------------------------------------------------------- */
/* HEADER - white letterhead like the Excel sample: company block on the     */
/* left, logo on the right, centered certificate title below                 */
/* -------------------------------------------------------------------------- */
const COMPANY_ADDRESS_LINES = [
  'PLANT-4, PLOT NO. 2526, NEAR MASCUT POLYMER, NEAR RADHE FORGE,',
  'VERAVAL-SHAPAR RAJKOT - 360024 (Guj) INDIA.',
];

const drawHeader = (page, fonts, logoImage) => {
  const topY = PAGE.height - PAGE.margin;

  // Left: company name + address
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

  // Right: logo image, or "IV" monogram fallback
  const logoBoxW = 140;
  const logoBoxH = 60;
  const logoX = PAGE.width - PAGE.margin - logoBoxW;
  const logoY = topY - logoBoxH - 2;

  if (logoImage) {
    // Scale to fit the logo box while keeping the image's aspect ratio.
    const scale = Math.min(
      logoBoxW / logoImage.width,
      logoBoxH / logoImage.height,
    );
    const w = logoImage.width * scale;
    const h = logoImage.height * scale;
    page.drawImage(logoImage, {
      x: logoX + (logoBoxW - w) / 2,
      y: logoY + (logoBoxH - h) / 2,
      width: w,
      height: h,
    });
  } else {
    drawRect(page, logoX + logoBoxW - 48, logoY + 12, 44, 44, {
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

  // Centered certificate title
  const titleY = topY - 86;
  drawCenteredText(
    page,
    'GALVANIZING COATING TEST CERTIFICATE',
    PAGE.margin,
    titleY,
    CONTENT_WIDTH,
    14,
    { font: fonts.bold, size: 11, color: COLORS.text },
  );

  // y where body content starts
  return titleY - 8;
};

/* -------------------------------------------------------------------------- */
/* CERTIFICATE INFO BLOCK - bordered label/value rows like the sample,       */
/* with the client's address as its own full-width row under Client Name     */
/* -------------------------------------------------------------------------- */
const drawInfoBlock = (page, fonts, certificate, startY) => {
  const labelWidth = 130;
  const valueWidth = CONTENT_WIDTH - labelWidth - 18;
  const valueSize = 7.2;
  const lineHeight = 9;
  let y = startY;

  const rows = [
    ['TC No.', certificate.tc_no],
    ['Date of Inspection', certificate.inspection_date],
    ['Supplier', 'IV SQUARE STRUCTURE INDIA PVT LTD'],
    ['Client Name', certificate.client_name || certificate.party_name],
    // null label = full-width row: the client's address printed under the
    // client name, exactly like the Excel sample.
    certificate.client_address ? [null, certificate.client_address] : null,
    ['Third Party Name', certificate.third_party_name || '-'],
    ['Structure', certificate.structure],
    ['Invoice No.', certificate.invoice_no || certificate.challan_no],
    ['Quantity', certificate.quantity],
    ['Reference Standard', certificate.reference_standard],
  ].filter(Boolean);

  rows.forEach(([label, value]) => {
    const isFullWidth = label === null;
    const textWidth = isFullWidth ? CONTENT_WIDTH - 12 : valueWidth;

    const lines = wrapTextToWidth(
      fonts.regular,
      safeValue(value),
      valueSize,
      textWidth,
      4,
    );
    const rowHeight = Math.max(15, lines.length * lineHeight + 7);
    const rowBottom = y - rowHeight;

    if (isFullWidth) {
      drawRect(page, PAGE.margin, rowBottom, CONTENT_WIDTH, rowHeight);
    } else {
      drawRect(page, PAGE.margin, rowBottom, labelWidth, rowHeight);
      drawRect(
        page,
        PAGE.margin + labelWidth,
        rowBottom,
        CONTENT_WIDTH - labelWidth,
        rowHeight,
      );

      drawText(page, label, PAGE.margin + 6, y - 10.5, {
        size: 7.2,
        font: fonts.bold,
        color: COLORS.text,
      });
    }

    const textX = isFullWidth ? PAGE.margin + 6 : PAGE.margin + labelWidth + 6;

    lines.forEach((line, lineIndex) => {
      drawText(
        page,
        // Leading ":" before the value, matching the sample's style.
        !isFullWidth && lineIndex === 0 ? `:  ${line}` : line,
        textX,
        y - 10.5 - lineIndex * lineHeight,
        {
          size: valueSize,
          font: isFullWidth ? fonts.bold : fonts.regular,
        },
      );
    });

    y = rowBottom;
  });

  return y;
};

/* -------------------------------------------------------------------------- */
/* QC CHECKLIST TABLE                                                        */
/* -------------------------------------------------------------------------- */
const CHECKLIST_TESTS = [
  { key: 'visual_check', spec: 'IS 2629', test: 'Visual Check' },
  {
    key: 'adhesion_test',
    spec: 'IS 2629',
    test: 'Adhesion Test (wt. of Hammer 210 gms)',
  },
  { key: 'knife_test', spec: 'IS 2629', test: 'Knife Test (Sharp edge)' },
  {
    key: 'mass_test',
    spec: 'IS 4759 / IS 6745',
    test: 'Mass of Zinc Coating Test',
  },
  {
    key: 'preece_test',
    spec: 'IS 2633',
    test: 'Preece Test (Copper Sulphate) for Coating Uniformity',
  },
];

const CHECKLIST_COLS = [
  { key: 'sr', label: 'Sr. No', width: 30 },
  { key: 'spec', label: 'Specification', width: 75 },
  { key: 'test', label: 'Test', width: 170 },
  { key: 'result', label: 'Test Result', width: 145 },
  { key: 'observation', label: 'Observation', width: 115 },
];

const drawChecklistTable = (page, fonts, certificate, startY) => {
  let y = startY;
  const headerHeight = 16;
  const cellSize = 6.5;
  const cellLineHeight = 7.5;
  let x = PAGE.margin;

  CHECKLIST_COLS.forEach(col => {
    drawRect(page, x, y - headerHeight, col.width, headerHeight, {
      bg: COLORS.bgPanel,
    });
    drawCenteredText(
      page,
      col.label,
      x,
      y - headerHeight,
      col.width,
      headerHeight,
      { font: fonts.bold, size: 7, color: COLORS.text },
    );
    x += col.width;
  });

  y -= headerHeight;

  CHECKLIST_TESTS.forEach((row, index) => {
    x = PAGE.margin;

    const values = [
      String(index + 1),
      row.spec,
      row.test,
      certificate[`${row.key}_result`],
      certificate[`${row.key}_observation`],
    ];

    // Wrap each cell against its real column width so the row can grow
    // to fit the tallest cell instead of clipping.
    const cellLines = CHECKLIST_COLS.map((col, colIndex) =>
      wrapTextToWidth(
        fonts.regular,
        values[colIndex],
        cellSize,
        col.width - 8,
        3,
      ),
    );
    const maxLinesUsed = Math.max(1, ...cellLines.map(l => l.length));
    const rowHeight = Math.max(18, 10 + maxLinesUsed * cellLineHeight);
    const rowBottom = y - rowHeight;

    CHECKLIST_COLS.forEach((col, colIndex) => {
      drawRect(page, x, rowBottom, col.width, rowHeight);

      if (cellLines[colIndex].length === 1) {
        drawCenteredText(
          page,
          cellLines[colIndex][0],
          x,
          rowBottom,
          col.width,
          rowHeight,
          { font: fonts.regular, size: cellSize },
        );
      } else {
        cellLines[colIndex].forEach((line, lineIndex) => {
          page.drawText(line, {
            x: x + 4,
            y: y - 10 - lineIndex * cellLineHeight,
            size: cellSize,
            font: fonts.regular,
            color: COLORS.text,
          });
        });
      }

      x += col.width;
    });

    y = rowBottom;
  });

  return y;
};

/* -------------------------------------------------------------------------- */
/* READINGS TABLE - matches the sample:                                      */
/*  Sr | Name of Kem | Section as per BOM | Readings in Micron by Elcometer  */
/*  (grouped over 1-5) | Avrg.Coating In Micron | Avg. Coating in gm/mtrÂ²    */
/* -------------------------------------------------------------------------- */
const READING_COLS = [
  { key: 'sr', width: 24 },
  { key: 'kem', width: 118 },
  { key: 'section', width: 113 },
  { key: 'r1', width: 26 },
  { key: 'r2', width: 26 },
  { key: 'r3', width: 26 },
  { key: 'r4', width: 26 },
  { key: 'r5', width: 26 },
  { key: 'avgMicron', width: 72 },
  { key: 'avgGm', width: 78 },
];

const READING_CELL_SIZE = 6.8;
const READING_LINE_HEIGHT = 8;
const READING_WRAP_KEYS = ['kem', 'section'];

const readingColX = key => {
  let x = PAGE.margin;
  for (const col of READING_COLS) {
    if (col.key === key) return x;
    x += col.width;
  }
  return x;
};

const readingColW = key => READING_COLS.find(c => c.key === key).width;

const drawReadingsTableHeader = (page, fonts, startY) => {
  const totalHeight = 30;
  const subRowHeight = 13;
  const y = startY - totalHeight;

  // Full-height cells: Sr, Name of Kem, Section, both average columns
  ['sr', 'kem', 'section', 'avgMicron', 'avgGm'].forEach(key => {
    drawRect(page, readingColX(key), y, readingColW(key), totalHeight, {
      bg: COLORS.bgPanel,
    });
  });

  drawCenteredText(
    page,
    'Sr',
    readingColX('sr'),
    y,
    readingColW('sr'),
    totalHeight,
    {
      font: fonts.bold,
      size: 6.5,
    },
  );
  drawCenteredText(
    page,
    'Name of Kem',
    readingColX('kem'),
    y,
    readingColW('kem'),
    totalHeight,
    { font: fonts.bold, size: 6.8 },
  );
  drawCenteredText(
    page,
    'Section as per BOM',
    readingColX('section'),
    y,
    readingColW('section'),
    totalHeight,
    { font: fonts.bold, size: 6.8 },
  );

  // Two-line labels for the average columns
  drawCenteredText(
    page,
    'Avrg. Coating',
    readingColX('avgMicron'),
    y + subRowHeight,
    readingColW('avgMicron'),
    subRowHeight,
    { font: fonts.bold, size: 6.4 },
  );
  drawCenteredText(
    page,
    'In Micron',
    readingColX('avgMicron'),
    y + 2,
    readingColW('avgMicron'),
    subRowHeight,
    { font: fonts.bold, size: 6.4 },
  );
  drawCenteredText(
    page,
    'Avg. Coating',
    readingColX('avgGm'),
    y + subRowHeight,
    readingColW('avgGm'),
    subRowHeight,
    { font: fonts.bold, size: 6.4 },
  );
  drawCenteredText(
    page,
    'in gm/mtrÂ²',
    readingColX('avgGm'),
    y + 2,
    readingColW('avgGm'),
    subRowHeight,
    { font: fonts.bold, size: 6.4 },
  );

  // Grouped header spanning the 5 reading columns
  const readingsX = readingColX('r1');
  const readingsW = 26 * 5;

  drawRect(
    page,
    readingsX,
    y + subRowHeight,
    readingsW,
    totalHeight - subRowHeight,
    { bg: COLORS.bgPanel },
  );
  drawCenteredText(
    page,
    'Readings in Micron by Elcometer',
    readingsX,
    y + subRowHeight,
    readingsW,
    totalHeight - subRowHeight,
    { font: fonts.bold, size: 6.4 },
  );

  ['r1', 'r2', 'r3', 'r4', 'r5'].forEach((key, index) => {
    drawRect(page, readingColX(key), y, 26, subRowHeight, {
      bg: COLORS.bgPanel,
    });
    drawCenteredText(
      page,
      String(index + 1),
      readingColX(key),
      y,
      26,
      subRowHeight,
      { font: fonts.bold, size: 6.5 },
    );
  });

  return y;
};

const buildReadingsRowValues = (certificate, row, rowIndex) => {
  // Avrg.Coating In Micron: use the server-computed average if present,
  // otherwise average whatever of the 5 readings are filled in (manual
  // mode rows have no server-computed average).
  let avgMicron = toNumber(row.avg_coating);
  if (avgMicron === null) {
    const filled = [row.c1, row.c2, row.c3, row.c4, row.c5]
      .map(toNumber)
      .filter(v => v !== null);
    if (filled.length) {
      avgMicron = Math.round(filled.reduce((a, b) => a + b, 0) / filled.length);
    }
  } else {
    avgMicron = Math.round(avgMicron);
  }

  // Avg. Coating in gm/mtrÂ² = avg micron x 7.14
  const avgGm =
    avgMicron !== null
      ? Math.round(avgMicron * ZINC_DENSITY_G_PER_M2_PER_MICRON)
      : null;

  return {
    sr: String(rowIndex + 1),
    // Per the certificate spec: "Name of Kem" is always the structure
    // selected on the form, for every reading row.
    kem: certificate.structure,
    section: row.section || 'As per challan',
    r1: roundedOrDash(row.c1),
    r2: roundedOrDash(row.c2),
    r3: roundedOrDash(row.c3),
    r4: roundedOrDash(row.c4),
    r5: roundedOrDash(row.c5),
    avgMicron: avgMicron !== null ? String(avgMicron) : '-',
    avgGm: avgGm !== null ? String(avgGm) : '-',
  };
};

const measureReadingsRow = (fonts, values, minHeight) => {
  const wrapped = {};
  let maxLines = 1;

  READING_WRAP_KEYS.forEach(key => {
    const lines = wrapTextToWidth(
      fonts.regular,
      safeValue(values[key]),
      READING_CELL_SIZE,
      readingColW(key) - 8,
      3,
    );
    wrapped[key] = lines;
    maxLines = Math.max(maxLines, lines.length);
  });

  return {
    wrapped,
    rowHeight: Math.max(minHeight, 8 + maxLines * READING_LINE_HEIGHT),
  };
};

const drawReadingsRow = (page, fonts, values, wrapped, y, rowHeight) => {
  let x = PAGE.margin;

  READING_COLS.forEach(col => {
    drawRect(page, x, y, col.width, rowHeight);

    if (READING_WRAP_KEYS.includes(col.key)) {
      const lines = wrapped[col.key];
      if (lines.length === 1) {
        drawCenteredText(page, lines[0], x, y, col.width, rowHeight, {
          font: fonts.regular,
          size: READING_CELL_SIZE,
        });
      } else {
        lines.forEach((line, lineIndex) => {
          page.drawText(line, {
            x: x + 4,
            y: y + rowHeight - 9 - lineIndex * READING_LINE_HEIGHT,
            size: READING_CELL_SIZE,
            font: fonts.regular,
            color: COLORS.text,
          });
        });
      }
    } else {
      drawCenteredText(
        page,
        safeValue(values[col.key]),
        x,
        y,
        col.width,
        rowHeight,
        {
          font:
            col.key === 'avgMicron' || col.key === 'avgGm'
              ? fonts.bold
              : fonts.regular,
          size: READING_CELL_SIZE,
        },
      );
    }

    x += col.width;
  });
};

/* -------------------------------------------------------------------------- */
/* COATING REQUIREMENT BLOCK - like the sample, with a merged left cell      */
/* -------------------------------------------------------------------------- */
const drawRequirementNote = (page, fonts, startY) => {
  const leftW = 150;
  const midW = 235;
  const rightW = CONTENT_WIDTH - leftW - midW;
  const headerH = 14;
  const rowH = 13;
  let y = startY;

  // Header row
  drawRect(page, PAGE.margin, y - headerH, leftW, headerH, {
    bg: COLORS.bgPanel,
  });
  drawRect(page, PAGE.margin + leftW, y - headerH, midW, headerH, {
    bg: COLORS.bgPanel,
  });
  drawRect(page, PAGE.margin + leftW + midW, y - headerH, rightW, headerH, {
    bg: COLORS.bgPanel,
  });

  drawCenteredText(
    page,
    'Coating Requirement',
    PAGE.margin,
    y - headerH,
    leftW,
    headerH,
    { font: fonts.bold, size: 6.8 },
  );
  drawCenteredText(
    page,
    'Thickness of Steel Section',
    PAGE.margin + leftW,
    y - headerH,
    midW,
    headerH,
    { font: fonts.bold, size: 6.8 },
  );
  drawCenteredText(
    page,
    'Minimum Avg. Coating',
    PAGE.margin + leftW + midW,
    y - headerH,
    rightW,
    headerH,
    { font: fonts.bold, size: 6.8 },
  );

  y -= headerH;

  const requirementRows = [
    ['Section thickness 5 mm & above', 'Min. Average 86 micron or 614 gm/mtrÂ²'],
    [
      'Section thickness 2 mm to below 5 mm',
      'Min. Average 65 micron or 464 gm/mtrÂ²',
    ],
    [
      'Section thickness 2 mm but not less than 1.2 mm',
      'Min. Average 48 micron or 343 gm/mtrÂ²',
    ],
  ];

  const bodyH = rowH * requirementRows.length;

  // Merged left cell spanning all 3 rows, like the sample
  drawRect(page, PAGE.margin, y - bodyH, leftW, bodyH);
  const leftText = wrapTextToWidth(
    fonts.regular,
    'Specification for Hot Dip Galvanizing of structural steel products.',
    6.4,
    leftW - 10,
    3,
  );
  const leftBlockH = leftText.length * 8;
  leftText.forEach((line, index) => {
    page.drawText(line, {
      x: PAGE.margin + 5,
      y: y - (bodyH - leftBlockH) / 2 - 8 - index * 8,
      size: 6.4,
      font: fonts.regular,
      color: COLORS.text,
    });
  });

  requirementRows.forEach(cols => {
    drawRect(page, PAGE.margin + leftW, y - rowH, midW, rowH);
    drawRect(page, PAGE.margin + leftW + midW, y - rowH, rightW, rowH);

    drawText(page, cols[0], PAGE.margin + leftW + 5, y - rowH + 4, {
      size: 6.4,
      font: fonts.regular,
    });
    drawText(page, cols[1], PAGE.margin + leftW + midW + 5, y - rowH + 4, {
      size: 6.4,
      font: fonts.bold,
    });

    y -= rowH;
  });

  return y;
};

const drawRemarks = (page, fonts, remarks, startY) => {
  const rowH = 15;
  const y = startY - rowH;

  drawRect(page, PAGE.margin, y, CONTENT_WIDTH, rowH);
  drawText(
    page,
    `Remarks: ${cleanPdfText(
      remarks ||
        'The average coating found within limit, so found satisfactory.',
    )}`,
    PAGE.margin + 5,
    y + 4.5,
    { size: 7, font: fonts.bold, color: COLORS.text },
  );

  return y;
};

/* -------------------------------------------------------------------------- */
/* FOOTER / SIGNATURE                                                        */
/* -------------------------------------------------------------------------- */
const drawFooter = (page, fonts, pageNumber, stampImage) => {
  const signY = 60;
  const signW = 150;
  const signX = PAGE.width - PAGE.margin - signW;

  if (stampImage) {
    const stampSize = 170;
    const scale = Math.min(
      stampSize / stampImage.width,
      stampSize / stampImage.height,
    );
    const w = stampImage.width * scale;
    const h = stampImage.height * scale;

    // Centered over the signature line, slightly overlapping it - like a
    // real rubber stamp placed across the signature.
    page.drawImage(stampImage, {
      x: signX + (signW - w) / 2,
      y: 10,
      width: w,
      height: h,
      opacity: 0.9,
    });
  }

  page.drawLine({
    start: { x: signX, y: signY },
    end: { x: PAGE.width - PAGE.margin, y: signY },
    thickness: 0.7,
    color: COLORS.borderLight,
  });
  drawText(page, 'Authorized Signatory (Quality)', signX, signY - 10, {
    size: 6.8,
    font: fonts.bold,
    color: COLORS.textMuted,
  });

  page.drawLine({
    start: { x: PAGE.margin, y: 24 },
    end: { x: PAGE.width - PAGE.margin, y: 24 },
    thickness: 0.6,
    color: COLORS.borderLight,
  });

  drawText(
    page,
    'Generated by IV Production App  â€¢  System-generated certificate',
    PAGE.margin,
    12,
    { size: 6.2, font: fonts.regular, color: COLORS.textMuted },
  );

  drawText(page, `Page ${pageNumber}`, PAGE.width - PAGE.margin - 46, 12, {
    size: 6.2,
    font: fonts.bold,
    color: COLORS.textMuted,
  });
};
/* -------------------------------------------------------------------------- */
/* MAIN GENERATOR                                                           */
/* -------------------------------------------------------------------------- */
const generateCoatingCertificatePdf = async ({
  certificate,
  readings = [],
}) => {
  const pdfDoc = await PDFDocument.create();

  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };

  const logoImage = await loadLogoImage(pdfDoc);
  const stampImage = await loadStampImage(pdfDoc);

  let pageNumber = 1;
  let page = pdfDoc.addPage(A4_PORTRAIT);

  let y = drawHeader(page, fonts, logoImage);

  y = drawInfoBlock(page, fonts, certificate, y);

  y -= 8;
  y = drawChecklistTable(page, fonts, certificate, y);

  y -= 8;
  y = drawReadingsTableHeader(page, fonts, y);

  const minRowHeight = 18;

  readings.forEach((row, index) => {
    const values = buildReadingsRowValues(certificate, row, index);
    const { wrapped, rowHeight } = measureReadingsRow(
      fonts,
      values,
      minRowHeight,
    );

    if (y - rowHeight < 130) {
      drawFooter(page, fonts, pageNumber, stampImage);
      pageNumber += 1;
      page = pdfDoc.addPage(A4_PORTRAIT);
      y = drawReadingsTableHeader(page, fonts, PAGE.height - 50);
    }

    y -= rowHeight;
    drawReadingsRow(page, fonts, values, wrapped, y, rowHeight);
  });

  if (readings.length === 0) {
    drawRect(page, PAGE.margin, y - 20, CONTENT_WIDTH, 20);
    drawText(
      page,
      'No coating readings available for this certificate.',
      PAGE.margin + 8,
      y - 13,
      { size: 7.5, font: fonts.bold, color: COLORS.textMuted },
    );
    y -= 20;
  }

  if (y < 180) {
    drawFooter(page, fonts, pageNumber, stampImage);
    pageNumber += 1;
    page = pdfDoc.addPage(A4_PORTRAIT);
    y = PAGE.height - 50;
  }

  y = drawRequirementNote(page, fonts, y);
  y = drawRemarks(page, fonts, certificate.remarks, y);

  drawFooter(page, fonts, pageNumber, stampImage);

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
};

module.exports = { generateCoatingCertificatePdf };
