const { generateProductionPdf } = require('../../services/pdf/productionPdfGenerator');
const { generateCoatingCertificatePdf } = require('../../services/pdf/certificatePdfGenerator');
const { generateProductionPlanningPdf } = require('../../services/pdf/productionPlanningPdfGenerator');
const { generateDailyProductionPdf } = require('../../services/pdf/dailyProductionPdfGenerator');
const { generateMonthlyReportPdf } = require('../../services/pdf/monthlyReportPdfGenerator');
const { generateExpenseReportPdf } = require('../../services/pdf/expenseReportPdfGenerator');
const { generateGasManagementPdf } = require('../../services/pdf/gasManagementPdfGenerator');
const { generateChemicalChecksPdf } = require('../../services/pdf/chemicalChecksPdfGenerator');
const { generateZincStockPdf } = require('../../services/pdf/zincStockPdfGenerator');
const { generateZincByproductPdf } = require('../../services/pdf/zincByproductPdfGenerator');
const { buildZincMovementReport } = require('../../services/zincMovementReportService');
const { summarizeZincMovements } = require('../../services/monthlyReportService');
const repeat = (count, factory) => Array.from({ length: count }, (_, i) => factory(i));
const period = { label: 'October 2026', from: '2026-10-01', to: '2026-10-31' };
const ledger = [
  {id:1,movement_type:'initialize',amount_kg:0,plant_after_kg:0,kettle_after_kg:0},
  {id:2,movement_type:'receive',amount_kg:5000,batch_number:'123456',invoice_number:'INV-001',zinc_rate_per_kg:250,plant_after_kg:5000,kettle_after_kg:0},
  {id:3,movement_type:'transfer',amount_kg:5000,plant_after_kg:0,kettle_after_kg:5000},
  {id:4,movement_type:'production_use',amount_kg:2000,production_entry_id:1,plant_after_kg:0,kettle_after_kg:3000},
  {id:5,movement_type:'receive',amount_kg:3000,batch_number:'654321',invoice_number:'INV-002',zinc_rate_per_kg:250,plant_after_kg:3000,kettle_after_kg:3000},
  {id:6,movement_type:'transfer',amount_kg:3000,plant_after_kg:0,kettle_after_kg:6000},
  {id:7,movement_type:'production_use',amount_kg:5000,production_entry_id:2,plant_after_kg:0,kettle_after_kg:1000},
].map(row=>({...row,created_at:`2026-10-${row.id<4?'14':row.id<7?'15':'16'} 10:00:00`,shift_date:row.id<7?'2026-10-15':'2026-10-16',shift_name:'day',actor_name:'Sample Plant Manager',note:'Demonstration data'}));
const zincMovements = buildZincMovementReport(ledger).rows;
const expenses = {salary_per_day:12000,hardware_per_day:1200,maintenance_per_day:1800,zinc_spray_per_day:450,electricity_per_day:5600,gas_per_day:9200,chemicals_per_day:1100,ms_wire_per_day:700,rent_expense:1800,acid_expense:1200,crane_expense:900,other_expense:600};
const totals = {running_plant_cost:3.46,total_expense:36550,net_zinc_consumed_kg:6800,recovered_zinc_kg:200,plant_zinc_stock_kg:0,purchased_zinc_kg:8000,total_ms_production_kg:100000,average_ms_production_per_day_kg:10000,production_days:10,average_zinc_consumption_percent:6.8};
const monthly = {
  financial_year:{name:'2026-27'},period,production:{entry_count:80,production_days:10,quantity:1000,total_ms_kg:100000,total_gi_kg:107000,net_zinc_kg:6800,zinc_consumption_percent:6.8},
  zinc:summarizeZincMovements(ledger),byproducts:{ash_weight_kg:120,dross_weight_kg:80,recovered_zinc_kg:200,total_with_gst:50000},expenses:{totals,expenses},
  shifts:[{shift_name:'day',entry_count:45,quantity:600,ms_kg:60000,gi_kg:64200},{shift_name:'night',entry_count:35,quantity:400,ms_kg:40000,gi_kg:42800}],
  materials:repeat(6,i=>({material:`Structural steel section ${i+1}`,quantity:100+i,ms_kg:10000+i*500,gi_kg:10700+i*535})),
  contractors:[{contractor_name:'Sample Contractor A',entry_count:45,quantity:600,ms_kg:60000,gi_kg:64200},{contractor_name:'Sample Contractor B',entry_count:35,quantity:400,ms_kg:40000,gi_kg:42800}],
  planning:repeat(8,i=>({id:i+1,challan_no:`DC/2026-27/${100+i}`,party_name:i?'Sample Engineering Works':'Sample Engineering Works and Industrial Fabrication Division',material_description:i?'Fabricated structural assembly':'Fabricated structural assembly with base plates and long material description to verify complete wrapped text DETAIL-END',planned_qty:150,produced_qty:100+i,status:i?'pending':'completed'})),
  daily_production:repeat(10,i=>({production_date:`2026-10-${String(i+1).padStart(2,'0')}`,day_ms_kg:6000,night_ms_kg:4000,total_ms_kg:10000})),zinc_movements:zincMovements,
};
const productionRows = repeat(35,i=>({sr_no:i+1,production_time:'10:30:00',challan_no:'DC/2026-27/100',party_name:'Sample Engineering Works',material:'Structural steel assembly',kettle_temperature:450,dipping_qty:10,ms_weight:12.5,gi_weight:13.4,zinc_percentage:7.2,c1:80,c2:82,c3:84,c4:86,c5:88,avg_coating:84}));
const cases = [
  {key:'production',generate:()=>generateProductionPdf({date:'2026-10-16',shiftName:'day',reportType:'shift',summary:{total_ms_production_kg:4375,total_gi_production_kg:4690,zinc_consumption:7.2},tableData:productionRows})},
  {key:'certificate',generate:()=>generateCoatingCertificatePdf({certificate:{tc_no:'TC/2026/100',inspection_date:'2026-10-16',client_name:'Sample Engineering Works',structure:'Structural assembly',challan_no:'DC/2026-27/100',quantity:'350 NOS',reference_standard:'IS 4759',remarks:'Demonstration certificate'},readings:productionRows})},
  {key:'planning',generate:()=>generateProductionPlanningPdf({planning:{id:100,status:'pending'},items:monthly.planning.map(row=>({...row,completed_qty:row.produced_qty,target_zinc_percentage:7}))})},
  {key:'daily-production',generate:()=>generateDailyProductionPdf(monthly)},
  {key:'monthly',generate:()=>generateMonthlyReportPdf(monthly)},
  {key:'expenses',generate:()=>generateExpenseReportPdf({period,totals,expenses})},
  {key:'gas',generate:()=>generateGasManagementPdf({summary:{running_bottle_number:'GAS-4',filled_bottles:12,current_gas_rate:85},receipts:[{received_at:'2026-10-14 08:00:00',bottle_count:10,price_per_bottle:36000,kg_per_bottle:425,total_amount:360000,actor_name:'Sample Manager'}],runs:repeat(6,i=>({bottle_id:i+1,position_no:i+1,started_at:'2026-10-15 08:00:00',finished_at:'2026-10-16 08:00:00',started_by_name:'Sample Supervisor',finished_by_name:'Sample Supervisor',filled_weight_kg:425,empty_weight_kg:40,consumed_gas_kg:385,production_ton:12,production_active_seconds:72000,stopped_seconds:3600,lunch_break_seconds:3600,consumed_cost:32725}))})},
  {key:'chemical-checks',generate:()=>generateChemicalChecksPdf(repeat(30,i=>({inspection_date:`2026-10-${String(i+1).padStart(2,'0')}`,flux_ph:4.5,flux_density:1.2,flux_temperature_c:60,acid_ph:2.1,acid_density:1.1,checked_by_name:'Sample Supervisor',created_at:'2026-10-16 10:00:00',note:'Routine check'})),period.label)},
  {key:'zinc-stock',generate:()=>generateZincStockPdf(zincMovements)},
  {key:'ash-dross',generate:()=>generateZincByproductPdf(repeat(30,i=>({transaction_date:`2026-10-${String(i+1).padStart(2,'0')}`,ash_weight_kg:20,ash_rate:150,ash_base_amount:3000,ash_gst_amount:540,dross_weight_kg:10,dross_rate:180,dross_base_amount:1800,dross_gst_amount:324,total_with_gst:5664,zinc_rate_snapshot:250,recovered_zinc_kg:22.656,actor_name:'Sample Manager',note:'Recovery sale'})))},
];
module.exports = { cases, monthly };
