const test=require('node:test'),assert=require('node:assert/strict');
const {PDFParse}=require('pdf-parse');const {PDFDocument}=require('pdf-lib');
const {cases,job}=require('./fixtures/unit1PdfReports');
const {generateJobCardPdf}=require('../services/pdf/unit1ProductionPdfGenerator');
for(const sample of cases)test(`Unit 1 ${sample.name} PDF uses Indian dates and 12-hour IST`,async()=>{
 const bytes=await sample.generate();const p=new PDFParse({data:bytes});try{const out=await p.getText();const text=out.text.replace(/\s+/g,' ');for(const expected of sample.expected)assert.ok(text.includes(expected),`${sample.name}: missing ${expected}`);assert.doesNotMatch(text,/\b2026-\d{2}-\d{2}\b|Invalid DateTime|13:45:09|14:15:09/);}finally{await p.destroy();}
});
test('oversized punch rows continue across pages instead of running below the page',async()=>{
 const holes=Array.from({length:1000},(_,i)=>({sequenceNo:i+1,punchSize:'12x20',profile:'web',targetMm:50+i*50}));const bytes=await generateJobCardPdf({...job,holes});const pdf=await PDFDocument.load(bytes),p=new PDFParse({data:bytes});try{const out=await p.getText();assert.ok(pdf.getPageCount()>2);assert.match(out.text,/50000/);assert.match(out.text,/Prepared by:/);for(const page of out.pages.slice(1))assert.match(page.text,/PUNCH SIZE/);}finally{await p.destroy();}
});
