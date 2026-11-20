const { punchFaceLabel } = require('../unit1SectionPunchFaces');
const { newestInspectionsFirst } = require('../unit1InspectionOrder');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { reportDate, reportDateTime } = require('./unit1ReportDateTime');
const { loadCompanyLogo, drawReportHeader, drawReportFooters, REPORT_COLORS: C, cleanReportText } = require('./reportBranding');
const { wrapReportText } = require('./reportLayout');
const ADDRESS = ['Nr. Ghanshyam Paper Mill, At : Padavala , Tal : Kotda Sangani,', 'Dist : Rajkot-360024'];
const text = value => cleanReportText(String(value ?? '-').replace(/[×]/g, 'x')) || '-';
const time = reportDateTime;

async function generateHoleCheckPdf(report) {
  const pdf = await PDFDocument.create(), logo = await loadCompanyLogo(pdf);
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const margin = 30, width = 781.89, bottom = 54;
  let page, y;
  const draw = (value, x, baseline, size = 8, bold = false, color = C.text) => page.drawText(text(value), { x, y: baseline, size, font: bold ? fonts.bold : fonts.regular, color });
  const addPage = () => { page = pdf.addPage([841.89, 595.28]); y = drawReportHeader(page, fonts, logo, { title: 'UNIT 1 - QA/QC FIRST-PIECE & HOLE INSPECTION REPORT', subtitle: `${report.machine.name} (${report.machine.code}) | Inspection date: ${reportDate(report.date)} | All dimensions in mm`, margin, addressLines: ADDRESS }); };
  const columns = [{ title: 'Hole', width: 40 }, { title: 'Punch', width: 50 }, { title: 'Punch size', width: 100 }, { title: 'Profile', width: 115 }, { title: 'Target (mm)', width: 115 }, { title: 'Measured (mm)', width: 130 }, { title: 'Deviation (mm)', width: 231.89 }];
  const row = (values, header = false, layout = columns) => {

    const lines = values.map((value, i) => wrapReportText(text(value), header ? fonts.bold : fonts.regular, 8, layout[i].width - 12));

    const height = Math.max(24, Math.max(...lines.map(list => list.length)) * 11 + 10);
    let x = margin;
    lines.forEach((list, i) => {
      page.drawRectangle({ x, y: y - height, width: layout[i].width, height, color: header ? C.pale : C.white, borderWidth: .5, borderColor: C.line });

      list.forEach((line, j) => draw(line, x + 6, y - 15 - j * 11, 8, header, header ? C.navy : C.text));
      x += layout[i].width;

    });
    y -= height;
  };
  const inspectionHeader = (check, continued = false) => {
    page.drawRectangle({ x: margin, y: y - 23, width, height: 23, color: C.navy });
    draw(`Inspection #${check.id} - ${check.entryKind === 'rejection' ? 'REJECTED PIECES' : check.checkType === 'first_piece' ? 'FIRST PIECE' : 'RECHECK'}${continued ? ' (continued)' : ''} | ${time(check.checkedAt)} IST`, margin + 8, y - 15, 9, true, C.white);
    y -= 23;
    const items = [
      [check.profileType === 'w_beam_crash_barrier' ? 'Finished beam size (mm)' : 'Section size (mm)', check.sectionSize], ['Length (mm)', check.cutLengthMm], ['Part name', check.memberName], ['Profile type', String(check.profileType || '-').replace(/_/g, ' ')], ['Machine', check.machineName || report.machine.name],
      ['Grade / Material', `${check.grade || '-'} / ${check.materialType || '-'}`], ['Coil size / ID', `${check.coilSize} / ${check.coilInternalId || '-'}`], ['Party / Customer', check.customerName], ['Planning / Material', `U1-PL-${check.planningId || check.jobCardId} / JC-${check.templateId || '-'}`], ['Shift / Inspector', `${check.shift || '-'} / ${check.checkedByName || '-'}`],
    ];
    for (let start = 0; start < items.length; start += 5) {
      const cells = items.slice(start, start + 5), cellWidth = width / 5;
      const wrapped = cells.map(([, value]) => wrapReportText(text(value), fonts.regular, 8, cellWidth - 12));
      const height = Math.max(36, Math.max(...wrapped.map(lines => lines.length)) * 10 + 23);
      cells.forEach(([label], i) => {
        const x = margin + i * cellWidth;
        page.drawRectangle({ x, y: y - height, width: cellWidth, height, borderWidth: .5, borderColor: C.line });
        draw(label, x + 6, y - 12, 7, true, C.muted);
        wrapped[i].forEach((line, j) => draw(line, x + 6, y - 25 - j * 10));
      });
      y -= height;
    }
    if (check.entryKind !== 'rejection') row(columns.map(column => column.title), true);

    if (check.checkType === 'first_piece' || check.measuredCutLengthMm != null || check.measuredSectionSize) {
      const measured = check.measuredCutLengthMm;
      row(['Length','-','-','Cut length',check.cutLengthMm,measured == null ? 'Not recorded' : Number(measured).toFixed(2),measured == null ? '-' : (Number(measured)-Number(check.cutLengthMm)).toFixed(2)]);
      row(['Section','-','-','Section size',check.sectionSize,check.measuredSectionSize || 'Not recorded','-']);
    }
  };
  addPage();
  for (const check of newestInspectionsFirst(report.checks)) {
    if (y - 300 < bottom) addPage();
    inspectionHeader(check);
    for (const reading of check.measurements || []) {
      const delta = reading.targetMm == null ? null : Number(reading.measuredMm) - Number(reading.targetMm);
      const values = [reading.sequenceNo, `Punch ${reading.punchLetter}`, reading.punchSize, punchFaceLabel(reading.profile, check.sectionProfile || check.profileType), reading.targetMm == null ? 'Unmatched' : Number(reading.targetMm).toFixed(2), Number(reading.measuredMm).toFixed(2), delta == null ? '-' : `${delta > 0 ? '+' : ''}${delta.toFixed(2)}`];
      const height = Math.max(24, Math.max(...values.map((value, i) => wrapReportText(text(value), fonts.regular, 8, columns[i].width - 12).length)) * 11 + 10);
      if (y - height < bottom) { addPage(); inspectionHeader(check, true); }
      row(values);
    }
    if (check.rejectedLines?.length) {
      const rejectedColumns = [
        {title:'Actual cut length (mm)',width:170}, {title:'Rejected NOS',width:100},
        {title:'Coil used (kg)',width:150}, {title:'Est. rejected material (kg)',width:190},
        {title:'Cut blade scrap (kg)',width:171.89},
      ];
      const header = () => row(rejectedColumns.map(column=>column.title),true,rejectedColumns);
      if (y - 60 < bottom) { addPage(); inspectionHeader(check,true); }
      header();
      for (const line of check.rejectedLines) {
        if (y - 26 < bottom) { addPage(); inspectionHeader(check,true); header(); }
        row([line.cutLengthMm,line.pieces,line.rejectedUsedKg ?? 'Unknown',line.rejectedWeightKg ?? 'Unknown',line.rejectedCutBladeScrapKg ?? 'Unknown'],false,rejectedColumns);
      }
    }
    const notes = wrapReportText(`Rejected pieces (NOS): ${check.rejectedPieces == null ? 'Not recorded' : check.rejectedPieces} | Rejected material est. kg: ${check.rejectedWeightKg ?? 'Not available'} | Rejected coil use kg: ${check.rejectedUsedKg ?? 'Not available'}${check.rejectedCutBladeScrapKg == null ? '' : ` | Cut blade scrap kg: ${check.rejectedCutBladeScrapKg}`}${check.rejectedPieces>0&&!check.rejectedLines?.length ? ' | Actual rejected lengths not recorded; weight uses job-card length.' : ''} | Remarks: ${check.remarks || '-'}${check.correctionNote ? ' | ' + check.correctionNote : ''}${check.legacy ? ' | Legacy inspection: details reconstructed from the existing job card.' : ''}`, fonts.regular, 8, width - 16);

    for (const line of notes) {
      if (y - 30 < bottom) { addPage(); inspectionHeader(check, true); }
      draw(line, margin + 8, y - 14); y -= 13;
    }
    if (y - 38 < bottom) { addPage(); inspectionHeader(check, true); }
    draw(`Checked by: ${check.checkedByName || '-'} | Signature: ____________________`, margin + 8, y - 19, 8, true);
    y -= 43;
  }
  if (!report.checks.length) draw('No hole inspections recorded for this machine on the selected date.', margin, y - 20, 10);
  drawReportFooters(pdf, fonts, 'Unit 1 QA/QC | Signed-in inspector recorded electronically | Deviation = measured - target; no tolerance verdict assigned', margin);
  return Buffer.from(await pdf.save());
}
module.exports = { generateHoleCheckPdf, ADDRESS };
