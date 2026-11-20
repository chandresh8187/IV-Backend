const test=require('node:test'),assert=require('node:assert/strict');
const {PDFParse}=require('pdf-parse');
const {generateJobCardPdf}=require('../services/pdf/unit1ProductionPdfGenerator');

test('job card PDF prints both signed WEB offsets at a shared position', async () => {
  const bytes = await generateJobCardPdf({
    id: 14, isTemplate: true, memberName: 'Purlin', structureType: 'solar_mounting_structure',
    sectionSize: '150x65x20', cutLengthMm: 2500, coilThicknessMm: 3, coilWidthMm: 298,
    materialType: 'MS', punchSize: '65x20',
    holes: [-20, 20].map(centerOffsetMm => ({ profile: 'web', punchSize: '65x20', targetMm: 500, centerOffsetMm })),
  });
  const pdf = new PDFParse({ data: bytes });
  try {
    const { text } = await pdf.getText();
    assert.match(text, /offset\s+-20\s+mm/);
    assert.match(text, /offset\s+\+20\s+mm/);
  } finally {
    await pdf.destroy();
  }
});

test('W beam PDF shows end-zero references without solar face labels',async()=>{
 const bytes=await generateJobCardPdf({id:99,version:1,isTemplate:true,memberName:'W beam',structureType:'w_beam_crash_barrier',sectionSize:'312 x 83',cutLengthMm:4320,materialType:'GP',coilWidthMm:482,coilThicknessMm:3,punchSize:'18x30',holes:[{punchSize:'18x30',profile:'beam',targetMm:100},{punchSize:'18x30',profile:'beam',targetMm:4220}]});
 const p=new PDFParse({data:bytes});try{const {text}=await p.getText();assert.match(text,/FROM END 0/);assert.match(text,/REFERENCE END/);assert.match(text,/Finished beam size/);assert.doesNotMatch(text,/Web x Flange x Lip|PROFILE WEB\/FLANGE/);}finally{await p.destroy();}
});
test('material Job Card PDF prints technical dimensions without order-specific party, project, quantity, machine or shift',async()=>{
 const bytes=await generateJobCardPdf({id:12,version:3,isTemplate:true,customerName:'PRIVATE PARTY SENTINEL',projectNameCapacity:'PRIVATE PROJECT SENTINEL',productionQty:123456,shift:'night',machineName:'ORDER MACHINE SENTINEL',memberName:'Column',structureType:'solar_mounting_structure',sectionSize:'150 x 65 x 20',cutLengthMm:2300,materialType:'MS',coilWidthMm:254,coilThicknessMm:3,punchSize:'12x20',holes:[{punchSize:'12x20',profile:'web',targetMm:100},{punchSize:'12x20',profile:'web',targetMm:200}]});
 const p=new PDFParse({data:bytes});try{const {text}=await p.getText();assert.match(text,/MATERIAL JOB CARD TEMPLATE/);assert.match(text,/U1-JC-12/);assert.match(text,/Template version: 3/);assert.match(text,/2300/);assert.match(text,/DIMENSION MM/);assert.doesNotMatch(text,/PRIVATE PARTY|PRIVATE PROJECT|123456|ORDER MACHINE|Production quantity|Customer|Project \/ Capacity/);}finally{await p.destroy();}
});
