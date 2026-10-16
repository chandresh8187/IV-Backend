const { rgb } = require('pdf-lib');
const { readPdfAsset } = require('./pdfAssets');

const COMPANY_NAME = 'IV SQUARE STRUCTURE INDIA PVT LTD';
const COMPANY_ADDRESS_LINES = [
  'PLANT-4, PLOT NO. 2526, NEAR MASCUT POLYMER, NEAR RADHE FORGE,',
  'VERAVAL-SHAPAR RAJKOT - 360024 (Guj) INDIA.',
];
const REPORT_COLORS = {
  navy: rgb(.086, .114, .235), amber: rgb(.788, .6, .098),
  text: rgb(.1, .14, .2), muted: rgb(.4, .43, .49),
  pale: rgb(.95, .96, .98), line: rgb(.84, .87, .91), white: rgb(1, 1, 1),
};
const cleanReportText = value => String(value ?? '-').normalize('NFKD').replace(/[^\x20-\x7E]/g, ' ').trim();

async function loadCompanyLogo(pdf) {
  const bytes = readPdfAsset('IV_logo.png');
  if (!bytes) return null;
  try { return await pdf.embedPng(bytes); } catch { return null; }
}

function drawCompanyIdentity(page, fonts, logo, margin = 30) {
  const { width, height } = page.getSize();
  const top = height - margin;
  const available = width - margin * 2 - 150;
  const nameSize = Math.min(15, available / fonts.bold.widthOfTextAtSize(COMPANY_NAME, 1));
  page.drawText(COMPANY_NAME, { x: margin, y: top - 30, size: nameSize, font: fonts.bold, color: REPORT_COLORS.navy });
  COMPANY_ADDRESS_LINES.forEach((line, index) => {
    const size = Math.min(7, available / fonts.regular.widthOfTextAtSize(line, 1));
    page.drawText(line, { x: margin, y: top - 42 - index * 9, size, font: fonts.regular, color: REPORT_COLORS.muted });
  });
  const box = { x: width - margin - 140, y: top - 62, width: 140, height: 60 };
  if (logo) {
    const scale = Math.min(box.width / logo.width, box.height / logo.height);
    const w = logo.width * scale, h = logo.height * scale;
    page.drawImage(logo, { x: box.x + (box.width - w) / 2, y: box.y + (box.height - h) / 2, width: w, height: h });
  } else {
    page.drawRectangle({ x: width - margin - 44, y: top - 50, width: 44, height: 44, color: REPORT_COLORS.navy });
    page.drawText('IV', { x: width - margin - 34, y: top - 35, size: 20, font: fonts.bold, color: REPORT_COLORS.white });
  }
  return top - 72;
}

function drawReportHeader(page, fonts, logo, { title, subtitle, margin = 32 } = {}) {
  drawCompanyIdentity(page, fonts, logo, margin);
  const { width, height } = page.getSize();
  const top = height - margin;
  const text = cleanReportText(title);
  const size = Math.min(12, (width - margin * 2) / fonts.bold.widthOfTextAtSize(text || '-', 1));
  page.drawText(text, { x: (width - fonts.bold.widthOfTextAtSize(text, size)) / 2, y: top - 84, size, font: fonts.bold, color: REPORT_COLORS.navy });
  page.drawLine({ start: { x: margin, y: top - 96 }, end: { x: width - margin, y: top - 96 }, thickness: 1.3, color: REPORT_COLORS.amber });
  if (subtitle) {
    const value = cleanReportText(subtitle);
    const subtitleSize = Math.min(8, (width - margin * 2) / fonts.regular.widthOfTextAtSize(value, 1));
    page.drawText(value, { x: margin, y: top - 111, size: subtitleSize, font: fonts.regular, color: REPORT_COLORS.muted });
  }
  return top - (subtitle ? 130 : 113);
}

function drawReportFooters(pdf, fonts, label, margin = 32) {
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    const width = page.getWidth();
    page.drawLine({ start: { x: margin, y: 39 }, end: { x: width - margin, y: 39 }, thickness: .5, color: REPORT_COLORS.line });
    page.drawText(cleanReportText(label), { x: margin, y: 23, size: 7, font: fonts.regular, color: REPORT_COLORS.muted });
    const count = `Page ${index + 1} of ${pages.length}`;
    page.drawText(count, { x: width - margin - fonts.regular.widthOfTextAtSize(count, 7), y: 23, size: 7, font: fonts.regular, color: REPORT_COLORS.muted });
  });
}

module.exports = { COMPANY_NAME, COMPANY_ADDRESS_LINES, REPORT_COLORS, cleanReportText,
  loadCompanyLogo, drawCompanyIdentity, drawReportHeader, drawReportFooters };
