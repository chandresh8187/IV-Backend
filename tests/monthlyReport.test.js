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


test('complete monthly PDF includes batch allocations in the zinc transaction appendix', async () => {
 const {generateMonthlyReportPdf} = require('../services/pdf/monthlyReportPdfGenerator');
 const pdf = await generateMonthlyReportPdf({
  financial_year:{name:'2026-27'}, period:{label:'October 2026',from:'2026-10-01',to:'2026-10-31'},
  production:{}, zinc:{}, byproducts:{}, expenses:{totals:{},expenses:{}}, shifts:[],materials:[],contractors:[],planning:[],
  zinc_movements:[{id:7,movement_type:'production_summary',transaction_date:'2026-10-16',shift_name:'day',amount_kg:5000,
   batch_allocations:[{receipt_id:1,batch_number:'123456',invoice_number:'INV-1',amount_kg:3000},{receipt_id:2,batch_number:'654321',invoice_number:'INV-2',amount_kg:2000}]}],
 });
 const parser=new PDFParse({data:pdf});
 try{
  const {text}=await parser.getText();
  assert.match(text,/MONTHLY REPORT \| ZINC TRANSACTIONS/);
  assert.match(text,/Used 3,000 kg/);
  assert.match(text,/123456/);
  assert.match(text,/INV-1/);
  assert.match(text,/Used 2,000 kg/);
  assert.match(text,/654321/);
  assert.match(text,/INV-2/);
 }finally{await parser.destroy();}
});


test('monthly controller preserves invoice strings and traces purchases from earlier months', async () => {
 const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
 const reportService = require('../services/zincMovementReportService');
 const ledger = [
  {id:1,movement_type:'initialize',amount_kg:0,plant_after_kg:0,kettle_after_kg:0},
  {id:2,movement_type:'receive',amount_kg:5000,batch_number:'123456',invoice_number:'00001',plant_after_kg:5000,kettle_after_kg:0},
  {id:3,movement_type:'transfer',amount_kg:5000,plant_after_kg:0,kettle_after_kg:5000},
  {id:4,movement_type:'production_use',amount_kg:2000,production_entry_id:1,plant_after_kg:0,kettle_after_kg:3000},
  {id:5,movement_type:'receive',amount_kg:3000,batch_number:'654321',invoice_number:'00002',plant_after_kg:3000,kettle_after_kg:3000},
  {id:6,movement_type:'transfer',amount_kg:3000,plant_after_kg:0,kettle_after_kg:6000},
  {id:7,movement_type:'production_use',amount_kg:5000,production_entry_id:2,plant_after_kg:0,kettle_after_kg:1000},
 ].map(row => ({...row,created_at:row.id===7?'2026-10-01 10:00:00':'2026-09-30 10:00:00',shift_date:'2026-10-01',shift_name:'day'}));
 const query = async sql => {
  if(sql === reportService.zincMovementLedgerSql)return [ledger];
  if(sql.includes('SELECT COUNT(*) entry_count'))return [[{total_ms_kg:0,total_gi_kg:0,production_days:0}]];
  if(sql.includes('SELECT plant_after_kg,kettle_after_kg'))return [[{plant_after_kg:0,kettle_after_kg:6000}]];
  if(sql.includes('SUM(ash_weight_kg)'))return [[{recovered_zinc_kg:0}]];
  return [[]];
 };
 const module = {exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../controllers/monthlyReportController.js'),'utf8'),{
  module,console,require:name=>{
   if(name==='../config/db')return {query};
   if(name==='../services/financialYearService')return {getConfiguredCurrentFinancialYear:async()=>({id:1,start_date:'2026-04-01',financial_year:'2026-27'})};
   if(name==='../services/expenseReportService')return {normalizeExpenseSettings:value=>value,calculateExpenseReport:()=>({totals:{net_zinc_consumed_kg:0,average_zinc_consumption_percent:0}})};
   return require(name);
  },
 });
 const report = await module.exports.buildMonthlyReport({month:10,financialYearId:1});
 assert.equal(report.zinc_movements.length,1);
 assert.equal(report.zinc.production_used_kg,5000);
 assert.equal(report.zinc.received_kg,0);
 assert.equal(report.zinc.opening_kettle_kg,6000);
 assert.equal(report.zinc.closing_kettle_kg,1000);
 assert.equal(report.zinc_movements[0].batch_allocations[0].invoice_number,'00001');
 assert.equal(report.zinc_movements[0].batch_allocations[0].amount_kg,3000);
 assert.equal(report.zinc_movements[0].batch_allocations[1].invoice_number,'00002');
 assert.equal(report.zinc_movements[0].batch_allocations[1].amount_kg,2000);
});
