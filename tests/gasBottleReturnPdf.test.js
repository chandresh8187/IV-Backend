const test=require('node:test'),assert=require('node:assert/strict');
const {generateGasManagementPdf}=require('../services/pdf/gasManagementPdfGenerator');const {PDFParse}=require('pdf-parse');
test('gas PDF includes return time, bottle, slot, stock condition, reason and actor',async()=>{
 const bytes=await generateGasManagementPdf({returns:[{returned_at:'2026-10-01 11:30:00',bottle_code:'BOTTLE-2',position_no:2,was_used:0,reason:'Not needed here',actor_name:'Plant manager'},{returned_at:'2026-10-01 12:00:00',bottle_code:'BOTTLE-1',position_no:1,was_used:1,reason:'Move after use',actor_name:'Supervisor'}]});
 const p=new PDFParse({data:bytes});try{const {text}=await p.getText();assert.match(text,/BOTTLE-2 returned from GAS-2/);assert.match(text,/unused stock/);assert.match(text,/partly used stock/);assert.match(text,/Not needed here/);assert.match(text,/Plant manager/);assert.match(text,/11:30 AM/);}finally{await p.destroy();}
});
