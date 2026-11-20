const { PDFDocument, StandardFonts } = require('pdf-lib');
const { reportDate, reportDateTime } = require('./unit1ReportDateTime');
const { loadCompanyLogo, drawReportHeader, drawReportFooters, cleanReportText, REPORT_COLORS: C } = require('./reportBranding');
const { wrapReportText } = require('./reportLayout');
const { ADDRESS } = require('./unit1HoleCheckPdfGenerator');
const text = value => cleanReportText(String(value ?? '-').replace(/×/g, 'x')) || '-';
const kg = value => value == null ? 'Unavailable' : `${Number(value).toFixed(3)} kg`;
const dateText = reportDateTime;

async function reportWriter(title, subtitle, landscape = true) {
  const pdf = await PDFDocument.create(), logo = await loadCompanyLogo(pdf);
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const size = landscape ? [841.89, 595.28] : [595.28, 841.89], margin = 30, width = size[0] - 60;
  let page, y, repeat = () => {};
  const draw = (value, x, baseline, bold = false, fontSize = 8) => page.drawText(text(value), { x, y: baseline, size: fontSize, font: bold ? fonts.bold : fonts.regular, color: C.text });
  const addPage = () => { page = pdf.addPage(size); y = drawReportHeader(page, fonts, logo, { title, subtitle, margin, addressLines: ADDRESS }); };
  const row = (values, widths, header = false, fontSize = 8) => {
    const lineHeight=fontSize===8 ? 11 : fontSize+4;
    const lines=values.map((value,i)=>wrapReportText(text(value),header?fonts.bold:fonts.regular,fontSize,widths[i]-12));
    const count=Math.max(1,...lines.map(list=>list.length));
    if(y-Math.max(27,count*lineHeight+12)<55){addPage();if(!header)repeat();}
    let offset=0;
    while(offset<count){
      if(y-Math.max(27,lineHeight+12)<55){addPage();if(!header)repeat();}
      const take=Math.min(count-offset,Math.max(1,Math.floor((y-55-12)/lineHeight)));
      const height=Math.max(27,take*lineHeight+12);let x=margin;
      lines.forEach((list,i)=>{
        const chunk=offset&&list.length<=offset&&list.length<=2?list:list.slice(offset,offset+take);
        page.drawRectangle({x,y:y-height,width:widths[i],height,color:header?C.pale:C.white,borderColor:C.line,borderWidth:.5});
        chunk.forEach((line,j)=>draw(line,x+6,y-16-j*lineHeight,header,fontSize));x+=widths[i];
      });
      y-=height;offset+=take;
      if(offset<count){addPage();if(!header)repeat();}
    }
  };
  const paragraph = value => {
    for (const line of wrapReportText(text(value), fonts.regular, 8, width)) {
      if (y - 18 < 55) { addPage(); repeat(); }
      draw(line, margin, y - 13); y -= 16;
    }
    y -= 8;
  };
  addPage();
  const positionLines = (positions, availableWidth, fontSize) => {
    const lines=[];
    let current='';
    for(const position of positions) {
      const next=current ? `${current}${position}` : String(position);
      if(current && fonts.regular.widthOfTextAtSize(next+'-',fontSize)>availableWidth) {
        lines.push(current);current=String(position)+'-';
      } else current=next+'-';
    }
    if(current) lines.push(current.slice(0,-1));
    return lines.join('\n');
  };
  return { width, row, paragraph, positionLines, repeat: fn => { repeat = fn; }, finish: async () => {
    drawReportFooters(pdf, fonts, 'Unit 1 | Dates: DD/MM/YYYY | Times: 12-hour AM/PM, IST', margin);
    return Buffer.from(await pdf.save());
  } };
}

async function generateProductionPdf(report) {
  const writer = await reportWriter('UNIT 1 - PRODUCTION ENTRIES', `Operating date: ${reportDate(report.date)} | Shift: ${report.shift} | ${report.machineId ? 'Machine: ' + (report.entries[0]?.machineName || report.machineId) : 'All machines'}`);
  writer.paragraph(`Total production: ${kg(report.summary.productionKg)} | Coil used: ${kg(report.summary.coilUsedKg)} | Hole scrap: ${kg(report.summary.holeScrapKg)} | Cut blade scrap: ${kg(report.summary.cutBladeScrapKg)}`);
  writer.paragraph('Estimated production = coil used - hole scrap - recorded cut blade scrap. Other scrap: Not recorded by entry. See the Dispatch report for measured total scrap after coil finish.');
  const widths = [85, 45, 76, 100, 100, 80, 40, 62, 55, 55, 83.89];
  const headings = ['Date / Time (IST)', 'Shift', 'Machine', 'Customer / Project', 'Material / Member / Section', 'Planning / Bundle', 'NOS', 'Coil used kg', 'Hole scrap kg', 'Cut blade scrap kg', 'Coil / Entered by'];
  writer.repeat(() => writer.row(headings, widths, true)); writer.row(headings, widths, true);
  for (const entry of report.entries) writer.row([dateText(entry.createdAt), entry.shift, entry.machineName, `${entry.customerName || '-'} / ${entry.projectName || '-'}`, `${entry.materialType} / ${entry.memberName} / ${entry.sectionSize}`, `U1-PL-${entry.planningId || entry.jobCardId} / #${entry.bundleNo}`, entry.pieces, Number(entry.theoreticalUsedKg || 0).toFixed(3),entry.holeScrapKg==null?'Unknown':Number(entry.holeScrapKg).toFixed(3),entry.cutBladeScrapKg==null?'-':Number(entry.cutBladeScrapKg).toFixed(3), `${entry.coilInternalId} / ${entry.enteredByName || '-'}`], widths);
  if (!report.entries.length) writer.paragraph('No production entries match the selected filters.');
  return writer.finish();
}

const {generateJobCardPdf}=require('./unit1JobCardPdfGenerator');

module.exports = { generateProductionPdf, generateJobCardPdf };



