const test=require('node:test');
const assert=require('node:assert/strict');
const{financialYearMonth,summarizeZincMovements}=require('../services/monthlyReportService');
const {generateDailyProductionPdf}=require('../services/pdf/dailyProductionPdfGenerator');
const {PDFParse}=require('pdf-parse');

const year={start_date:'2026-04-01'};
test('financial year month maps April-March to the correct calendar years',()=>{
 assert.deepEqual(financialYearMonth(year,4),{month:4,label:'April 2026',from:'2026-04-01',to:'2026-04-30'});
 assert.deepEqual(financialYearMonth(year,2),{month:2,label:'February 2027',from:'2027-02-01',to:'2027-02-28'});
 assert.throws(()=>financialYearMonth(year,13),/January to December/);
});
test('zinc history reconstructs opening, monthly flows and closing balances',()=>{
 const result=summarizeZincMovements([
  {movement_type:'receive',amount_kg:1000,plant_after_kg:6000,kettle_after_kg:2000},
  {movement_type:'transfer',amount_kg:500,plant_after_kg:5500,kettle_after_kg:2500},
  {movement_type:'production_use',amount_kg:125.5,plant_after_kg:5500,kettle_after_kg:2374.5},
 ],{plant_after_kg:5000,kettle_after_kg:2000});
 assert.deepEqual(result,{opening_plant_kg:5000,opening_kettle_kg:2000,closing_plant_kg:5500,closing_kettle_kg:2374.5,received_kg:1000,transferred_to_kettle_kg:500,production_used_kg:125.5,production_restored_kg:0,corrections:0});
});
test('a quiet month carries the previous zinc balance forward',()=>{
 assert.deepEqual(summarizeZincMovements([],{plant_after_kg:5500,kettle_after_kg:2374.5}),{opening_plant_kg:5500,opening_kettle_kg:2374.5,closing_plant_kg:5500,closing_kettle_kg:2374.5,received_kg:0,transferred_to_kettle_kg:0,production_used_kg:0,production_restored_kg:0,corrections:0});
});

test('daily production PDF includes every calendar date, shift totals and contractor totals',async()=>{
 const pdf=await generateDailyProductionPdf({
  period:{label:'April 2026',from:'2026-04-01',to:'2026-04-30'},
  production:{total_ms_kg:1500,quantity:30,production_days:1},
  daily_production:[{production_date:'2026-04-02',day_ms_kg:1000,night_ms_kg:500,total_ms_kg:1500,total_qty:30}],
  contractors:[{contractor_name:'Sample Contractor',entry_count:2,quantity:30,ms_kg:1500}],
 });
 const parser=new PDFParse({data:pdf});
 try{
  const {text}=await parser.getText();
  assert.match(text,/01 Apr 2026/);
  assert.match(text,/02 Apr 2026/);
  assert.match(text,/30 Apr 2026/);
  assert.match(text,/1,000 kg\s+500 kg\s+1,500 kg/);
  assert.match(text,/Sample Contractor/);
  assert.doesNotMatch(text,/QTY \(NOS\)|\bNOS\b/);
  assert.doesNotMatch(text,/ENTRIES/);
 }finally{await parser.destroy();}
});
