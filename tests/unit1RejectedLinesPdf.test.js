const test=require('node:test'),assert=require('node:assert/strict');
const {PDFParse}=require('pdf-parse');
const {generateHoleCheckPdf}=require('../services/pdf/unit1HoleCheckPdfGenerator');
const {rejectionWeight}=require('../services/unit1RejectedMaterial');

test('rejected-length PDF retains every actual length and repeats column headers across pages',async()=>{
 const lines=Array.from({length:30},(_,index)=>({cutLengthMm:2100+index*10,pieces:index%3+1}));
 const pieces=lines.reduce((sum,line)=>sum+line.pieces,0);
 const weight=rejectionWeight({widthMm:298,thicknessMm:2,cutLengthMm:2300,densityGcm3:7.85,cutBladeSizeMm:5,cutBladeThicknessMm:2},[{punchSize:'12x20'}],pieces,lines);
 const check={id:1,entryKind:'rejection',checkedAt:'2026-11-19T13:00:00+05:30',sectionSize:'150x65x20',cutLengthMm:2300,memberName:'Purlin',coilSize:'298x2 mm',rejectedPieces:pieces,...weight,measurements:[]};
 const bytes=await generateHoleCheckPdf({machine:{name:'Machine 1',code:'M1'},date:'2026-11-19',checks:[check]});
 const parser=new PDFParse({data:bytes});
 try{
  const output=await parser.getText();
  assert.ok(output.pages.length>1);
  assert.match(output.text,/REJECTED PIECES/);assert.match(output.text,/01:00:00 PM/);
  for(const line of lines)assert.ok(output.text.includes(String(line.cutLengthMm)),`missing ${line.cutLengthMm}`);
  for(const page of output.pages.filter(page=>page.text.includes('Actual cut length (mm)')))assert.match(page.text,/Rejected NOS/);
  assert.match(output.text,/Rejected pieces \(NOS\): 60/);
 }finally{await parser.destroy();}
});
