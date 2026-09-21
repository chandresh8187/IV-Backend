const test=require('node:test');
const assert=require('node:assert/strict');
const{financialYearMonth,summarizeZincMovements}=require('../services/monthlyReportService');

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
