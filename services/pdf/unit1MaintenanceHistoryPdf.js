const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { DateTime } = require("luxon");
const { reportDate, reportDateTime } = require("./unit1ReportDateTime");
function wrapReportText(value, font, size, width) {
  const lines = [];
  for (const paragraph of String(value ?? "").split("\n")) {
    let line = "";
    for (const word of cleanReportText(paragraph)
      .split(/\s+/)
      .filter(Boolean)) {
      if (
        font.widthOfTextAtSize(line ? `${line} ${word}` : word, size) <= width
      ) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) {
        lines.push(line);
        line = "";
      }
      if (font.widthOfTextAtSize(word, size) <= width) {
        line = word;
        continue;
      }
      for (const char of word) {
        if (line && font.widthOfTextAtSize(line + char, size) > width) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : ["-"];
}
const {
  loadCompanyLogo,
  drawReportHeader,
  drawReportFooters,
  cleanReportText,
} = require("./reportBranding");
const violet = rgb(0.243, 0.18, 0.502),
  pale = rgb(0.937, 0.925, 0.98),
  ink = rgb(0.157, 0.149, 0.208),
  border = rgb(0.75, 0.73, 0.82);
const missing = (v) => (v == null || v === "" ? "Not recorded" : String(v));
const amount = (v) =>
  v == null || v === ""
    ? "Not recorded"
    : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const duration = (s) =>
  `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
const stamp = (v) =>
  v
    ? reportDateTime(v).replace(/^(\d{2}\/\d{2}\/\d{4}) /, "$1\n")
    : "Times not recorded";
const columns = [
  ["ID", 30, (r) => `#${r.id}`],
  [
    "Machine",
    80,
    (r) =>
      `${r.machine_code || ""} - ${missing(r.machine_name)}${
        r.task ? `\nTask: ${r.task}` : ""
      }`,
  ],
  [
    "Maintenance reason",
    100,
    (r) =>
      `${r.maintenance_reason || (r.start_note ? "" : "Not recorded")}${
        r.start_note
          ? `${r.maintenance_reason ? "\n" : ""}Earlier note: ${r.start_note}`
          : ""
      }`,
  ],
  ["Date", 62, (r) => reportDate(r.service_date)],
  ["Breakdown start (IST)", 91, (r) => stamp(r.started_at)],
  ["Breakdown end (IST)", 91, (r) => stamp(r.ended_at)],
  [
    "Total\nbreakdown\ntime",
    74,
    (r) =>
      r.duration_seconds != null
        ? duration(Number(r.duration_seconds))
        : r.downtime_minutes != null
        ? `${r.downtime_minutes} min (recorded)`
        : "Not recorded",
  ],
  ["Replace part name", 80, (r) => missing(r.parts_used)],
  [
    "Cost INR / basis",
    75,
    (r) =>
      `${amount(r.cost)}${
        r.cost != null
          ? r.cost_basis === "approximate"
            ? " (approx.)"
            : " (recorded)"
          : ""
      }`,
  ],
  ["Action taken to complete", 120, (r) => missing(r.work_done)],
  ["Remark", 95, (r) => missing(r.notes)],
  [
    "Completed / recorded by",
    75,
    (r) =>
      `${r.recorded_by || r.technician || "Not recorded"}${
        r.recorded_at ? `\nRecorded: ${reportDateTime(r.recorded_at)}` : ""
      }`,
  ],
  [
    "Status",
    61,
    (r) =>
      `${r.voided_at ? `VOIDED: ${missing(r.void_reason)}` : "Completed"}${
        r.maintenance_type ? `\n${r.maintenance_type}` : ""
      }\nAudit v${missing(r.version)}`,
  ],
];
async function maintenanceHistoryPdf(data) {
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const logo = await loadCompanyLogo(pdf),
    margin = 28,
    pageWidth = 1190.55,
    pageHeight = 841.89,
    width = pageWidth - margin * 2,
    bottom = 54;
  const widths = columns.map(
      (c) =>
        (c[1] * width) / columns.reduce((sum, column) => sum + column[1], 0)
    ),
    lineHeight = 13,
    size = 9.5;
  const generated = reportDateTime(DateTime.now());
  let page, y;
  const draw = (
    value,
    x,
    baseline,
    fontSize = size,
    bold = false,
    color = ink
  ) =>
    page.drawText(cleanReportText(value), {
      x,
      y: baseline,
      size: fontSize,
      font: bold ? fonts.bold : fonts.regular,
      color,
    });
  function note(value) {
    const lines = wrapReportText(value, fonts.regular, 9, width);
    lines.forEach((line) => {
      draw(line, margin, y, 9);
      y -= 13;
    });
    y -= 8;
  }
  function newPage(continuation) {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = drawReportHeader(page, fonts, logo, {
      title: "COMPLETED MAINTENANCE REPORT",
      subtitle: `Unit 1 | Generated ${generated} IST | A3 landscape`,
      margin,
    });
    if (pdf.getPageCount() === 1) {
      const f = data.filters || {},
        s = data.summary || {};
      note(
        `Period: ${f.from ? reportDate(f.from) : "earliest"} to ${
          f.to ? reportDate(f.to) : "latest"
        } | Machine: ${f.machine_id || "all"} | Records: ${f.state || "valid"}`
      );
      note(
        `${s.valid_count ?? 0} valid records | Recorded cost: ${amount(
          s.cost_total
        )} INR | Recorded breakdown: ${amount(
          s.downtime_total
        )} minutes. Approximate costs marked (approx.); voided records excluded from totals.`
      );
    }
    if (continuation)
      note(
        `CONTINUED - Record #${continuation.id} | ${
          continuation.machine_code || ""
        } ${continuation.machine_name || ""}`
      );
    const headerLines = columns.map((c, i) =>
      wrapReportText(c[0], fonts.bold, 9, widths[i] - 12)
    );
    const height = Math.max(...headerLines.map((v) => v.length)) * 12 + 18;
    let x = margin;
    columns.forEach((c, i) => {
      page.drawRectangle({
        x,
        y: y - height,
        width: widths[i],
        height,
        color: pale,
        borderColor: border,
        borderWidth: 0.6,
      });
      headerLines[i].forEach((line, n) =>
        draw(line, x + 6, y - 15 - n * 12, 9, true, violet)
      );
      x += widths[i];
    });
    y -= height;
  }
  newPage();
  if (!data.rows?.length) {
    page.drawRectangle({
      x: margin,
      y: y - 36,
      width,
      height: 36,
      borderColor: border,
      borderWidth: 0.6,
    });
    draw(
      "No completed maintenance records match these filters.",
      margin + 10,
      y - 23
    );
  }
  for (const [index, row] of (data.rows || []).entries()) {
    const cells = columns.map((c, i) =>
      wrapReportText(c[2](row), fonts.regular, size, widths[i] - 12)
    );
    const count = Math.max(...cells.map((v) => v.length));
    const fullHeight = Math.max(44, count * lineHeight + 16);
    if (fullHeight <= pageHeight - 230 && y - fullHeight < bottom) newPage();
    let offset = 0;
    while (offset < count) {
      if (y - bottom < 44) newPage(row);
      const capacity = Math.floor((y - bottom - 16) / lineHeight),
        take = Math.min(capacity, count - offset),
        height = Math.max(44, take * lineHeight + 16);
      let x = margin;
      cells.forEach((lines, i) => {
        page.drawRectangle({
          x,
          y: y - height,
          width: widths[i],
          height,
          color: index % 2 ? rgb(0.98, 0.98, 0.995) : rgb(1, 1, 1),
          borderColor: border,
          borderWidth: 0.6,
        });
        // Repeat short identifying cells when a long record spans pages.
        const visible =
          offset >= lines.length && lines.length <= Math.min(4, take)
            ? lines
            : lines.slice(offset, offset + take);
        visible.forEach((line, n) =>
          draw(line, x + 6, y - 15 - n * lineHeight)
        );
        x += widths[i];
      });
      y -= height;
      offset += take;
      if (offset < count) newPage(row);
    }
  }
  drawReportFooters(
    pdf,
    fonts,
    "Unit 1 | Completed maintenance | DD/MM/YYYY | 12-hour time, IST",
    margin
  );
  return Buffer.from(await pdf.save());
}
module.exports = { maintenanceHistoryPdf };
