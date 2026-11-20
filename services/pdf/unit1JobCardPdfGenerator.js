const {PDFDocument,StandardFonts,rgb}=require('pdf-lib');
const {groupPunchRequirements,displaySize}=require('../unit1PunchRequirements');
const {reportDate}=require('./unit1ReportDateTime');
const {PRODUCTS}=require('../unit1ProductionValidation');
const {sectionProfileForTemplate}=require('../unit1SectionPunchFaces');
const {loadCompanyLogo,drawCompanyIdentity,drawReportFooters,cleanReportText,REPORT_COLORS:C}=require('./reportBranding');
const {wrapReportText}=require('./reportLayout');
const {ADDRESS}=require('./unit1HoleCheckPdfGenerator');

const clean=value=>cleanReportText(String(value??'-').replace(/×/g,'x'))||'-';
const unit=value=>value==null?'-':`${value} mm`;

// Both template and planning downloads use this renderer. Values remain the
// saved specification; this layout never infers actual measurements.
async function generateJobCardPdf(job){
 const pdf=await PDFDocument.create(),logo=await loadCompanyLogo(pdf);
 const fonts={regular:await pdf.embedFont(StandardFonts.Helvetica),bold:await pdf.embedFont(StandardFonts.HelveticaBold)};
 const margin=36,width=523.28,bottom=58,lineHeight=15;
 const beam=job.structureType==='w_beam_crash_barrier',groups=groupPunchRequirements(job);
 const id=job.isTemplate?`U1-JC-${job.id}`:`U1-PL-${job.planningId||job.id}`;
 const subtitle=job.isTemplate?`${id}  |  Template version: ${job.version??'-'}`:`${id}  |  Material line: ${job.id}  |  Job date: ${reportDate(job.jobDate)}`;
 let page,y;
 const draw=(value,x,baseline,size=10,bold=false,color=C.text)=>page.drawText(clean(value),{x,y:baseline,size,font:bold?fonts.bold:fonts.regular,color});
 const wrap=(value,size,available,bold=false)=>wrapReportText(clean(value),bold?fonts.bold:fonts.regular,size,available);
 const rect=(x,top,w,h,color=C.white,border=true)=>page.drawRectangle({x,y:top-h,width:w,height:h,color,...(border?{borderColor:C.line,borderWidth:.6}:{})});
 const rule=(x1,x2,top,color=C.line,thickness=.6)=>page.drawLine({start:{x:x1,y:top},end:{x:x2,y:top},color,thickness});
 const addPage=()=>{
  page=pdf.addPage([595.28,841.89]);
  page.drawRectangle({x:0,y:835.89,width:595.28,height:6,color:C.navy});
  y=drawCompanyIdentity(page,fonts,logo,margin,ADDRESS)-3;
  rule(margin,margin+width,y,C.line);
  draw(job.isTemplate?'MATERIAL JOB CARD TEMPLATE':'PLANNING MATERIAL',margin,y-27,17,true,C.navy);
  draw(subtitle,margin,y-46,9,false,C.muted);
  y-=62;
 };
 const ensure=h=>{if(y-h<bottom)addPage();};
 const section=(number,title,note)=>{
  ensure(55);draw(number,margin,y-13,9,true,C.amber);draw(title,margin+24,y-13,11,true,C.navy);
  y-=24;
  if(note){for(const line of wrap(note,8.5,width)){draw(line,margin,y-10,8.5,false,C.muted);y-=12;}y-=8;}
 };
 // A dynamic grid wraps long values rather than shrinking them into fine print.
 const fields=(items,columns=2)=>{
  const gap=10,cell=(width-gap*(columns-1))/columns;
  for(let start=0;start<items.length;start+=columns){
   const row=items.slice(start,start+columns),values=row.map(item=>wrap(item[1],11,cell-24,true));
   const labelLines=row.map(item=>wrap(item[0],8,cell-24));
   const labelHeight=Math.max(...labelLines.map(lines=>lines.length))*10;
   const height=labelHeight+Math.max(...values.map(lines=>lines.length))*14+25;
   ensure(height+9);
   row.forEach((item,i)=>{const x=margin+i*(cell+gap);rect(x,y,cell,height,C.pale,false);
    labelLines[i].forEach((line,n)=>draw(line,x+12,y-16-n*10,8,false,C.muted));
    values[i].forEach((line,n)=>draw(line,x+12,y-18-labelHeight-n*14,11,true,C.navy));
   });y-=height+9;
  }
 };
 addPage();
 const member=wrap(job.memberName,18,width-28,true),heroHeight=34+member.length*22;
 rect(margin,y,width,heroHeight,C.navy,false);draw('STRUCTURE TYPE',margin+14,y-17,8,true,rgb(.75,.8,.88));
 member.forEach((line,i)=>draw(line,margin+14,y-40-i*22,18,true,C.white));y-=heroHeight+16;
 section('01','MATERIAL SPECIFICATION');
 const isHat = sectionProfileForTemplate(job) === 'gl_hat_purlin';
 const hasReturnLip = isHat && String(job.sectionSize ?? '').split(/[x×*]/i).length === 4;
 const sectionLabel = beam ? 'Finished beam size (mm)'
  : hasReturnLip ? 'Crown x depth x foot x return lip (mm)'
  : isHat ? 'Crown x depth x foot (mm)' : 'Section (Web x Flange x Lip)';
 fields([['Cut length (mm)',unit(job.cutLengthMm)],[sectionLabel,unit(job.sectionSize)],['Material',job.materialType]],3);
 fields([['Profile',PRODUCTS.find(p=>p.key===job.structureType)?.label||String(job.structureType||'-').replace(/_/g,' ')],['Reference coil size (mm)',job.coilWidthMm!=null&&job.coilThicknessMm!=null?`${job.coilWidthMm} x ${job.coilThicknessMm} mm`:'-']]);
 if(!job.isTemplate){
  fields([['Customer',job.customerName],['Project / Capacity',job.projectNameCapacity],['Production quantity (NOS)',job.productionQty],['Machine',job.machineName||job.plannedMachineName||'Unassigned'],['Shift',job.shift],['Status',job.status]]);
 }
 if(job.allowedCoilSizes?.length){
  const label='Allowed coil sizes - width x thickness (mm)';
  const lines=wrap(job.allowedCoilSizes.map(s=>`${s.widthMm} x ${s.thicknessMm}`).join('   /   '),10,width-24,true);
  const h=36+lines.length*14;ensure(h+12);rect(margin,y,width,h);draw(label,margin+12,y-16,8,false,C.muted);lines.forEach((line,i)=>draw(line,margin+12,y-33-i*14,10,true,C.navy));y-=h+14;
 }else if(job.selectedCoils?.length){
  const lines=wrap('Allowed coil IDs: '+job.selectedCoils.map(c=>`${c.internalId||`${c.coilId}/${c.coilNumber}`} (${c.widthMm} x ${c.thicknessMm} mm)`).join(', '),9,width);
  for(const line of lines){ensure(17);draw(line,margin,y-12,9);y-=16;}y-=8;
 }
 const widths=[80,78,105,width-263];
 const hasBeamFaces=beam&&groups.some(group=>group.profile !== 'beam');
 const headings=['NO.','PUNCH SIZE',beam&&!hasBeamFaces?'REFERENCE END':'PROFILE / FACE',beam?'FROM END 0 (MM)':'DIMENSION MM'];
 const tableHeading=continued=>{
  section('02','PUNCH & HOLE DIMENSIONS'+(continued?' / CONTINUED':''));
  if(!continued){const help=beam?'Use the same beam end as 0. All values are absolute hole-centre positions in mm.':'All values are hole-centre positions in mm from the starting end, not gaps between holes.';
   wrap(help,8.5,width).forEach(line=>{draw(line,margin,y-10,8.5,false,C.muted);y-=12;});y-=10;
  }
  const height=36;let x=margin;
  headings.forEach((heading,i)=>{rect(x,y,widths[i],height,C.navy,false);wrap(heading,8,widths[i]-16,true).forEach((line,n)=>draw(line,x+8,y-14-n*10,8,true,C.white));x+=widths[i];});y-=height;
 };
 // Keep the heading with at least one row instead of stranding it at page end.
 if(y<bottom+145)addPage();
 tableHeading(false);
 for(const [index,group]of groups.entries()){
  const positionLines=[];let line='';
  for(const value of group.positions){const next=line?`${line} - ${value}`:String(value);if(line&&fonts.regular.widthOfTextAtSize(next,10)>widths[3]-20){positionLines.push(line);line=String(value);}else line=next;}
  if(line)positionLines.push(line);
  const offsetLabel=group.centerOffsetMm == null ? '' : ` (offset ${group.centerOffsetMm > 0 ? '+' : ''}${group.centerOffsetMm} mm)`;
  const cells=[wrap(String(index+1),9,widths[0]-16,true),wrap(displaySize(group.punchSize),10,widths[1]-16,true),wrap(group.profileLabel.toUpperCase()+offsetLabel,9,widths[2]-16),positionLines.length?positionLines:['-']];
  const count=Math.max(...cells.map(lines=>lines.length));let offset=0;
  const reserve=index===groups.length-1?72:0;
  if(count*lineHeight+18<390&&y-Math.max(40,count*lineHeight+18)-reserve<bottom){addPage();tableHeading(true);}
  while(offset<count){
   let capacity=Math.floor((y-bottom-18-reserve)/lineHeight);
   if(capacity<1){addPage();tableHeading(true);capacity=Math.floor((y-bottom-18-reserve)/lineHeight);}
   const take=Math.min(count-offset,capacity),height=Math.max(40,take*lineHeight+18);let x=margin;
   cells.forEach((lines,i)=>{
    rect(x,y,widths[i],height,index%2===0?C.pale:C.white);
    const chunk=i<3&&offset&&lines.length<=offset?lines:lines.slice(offset,offset+take);
    chunk.forEach((value,n)=>draw(value,x+8,y-23-n*lineHeight,i===0?9:i===2?9:10,i<2,i===0?C.navy:C.text));x+=widths[i];
   });y-=height;offset+=take;
   if(offset<count){addPage();tableHeading(true);}
  }
 }
 if(!groups.length){ensure(35);draw('No punch positions configured.',margin+10,y-20,10,false,C.muted);y-=38;}
 y-=14;
 if(y-54<bottom){addPage();tableHeading(true);y-=20;}
 const signatureWidth=(width-30)/2;
 rule(margin,margin+signatureWidth,y-25);rule(margin+signatureWidth+30,margin+width,y-25);
 draw('Prepared by:',margin,y-40,8.5,false,C.muted);draw('Supervisor:',margin+signatureWidth+30,y-40,8.5,false,C.muted);
 drawReportFooters(pdf,fonts,`${id}  |  Unit 1  |  Dimensions: mm`,margin);
 pdf.setTitle(`${id} - ${clean(job.memberName)}`);pdf.setAuthor('IV Square Structure India Pvt Ltd');
 return Buffer.from(await pdf.save());
}
module.exports={generateJobCardPdf};
