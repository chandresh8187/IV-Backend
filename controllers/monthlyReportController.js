const db = require('../config/db');
const { getConfiguredCurrentFinancialYear } = require('../services/financialYearService');
const { financialYearMonth, summarizeZincMovements } = require('../services/monthlyReportService');
const { normalizeExpenseSettings, calculateExpenseReport } = require('../services/expenseReportService');
const { generateMonthlyReportPdf } = require('../services/pdf/monthlyReportPdfGenerator');

const numeric = rows => rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value])));

const buildMonthlyReport = async ({ month, financialYearId }) => {
  const year = await getConfiguredCurrentFinancialYear();
  if (financialYearId != null && Number(financialYearId) !== Number(year.id)) throw Object.assign(new Error('The financial year changed. Refresh and try again.'), { status: 409 });
  const period = financialYearMonth(year, month);
  const params = [period.from, period.to];
  const [productionResult, shiftsResult, materialsResult, contractorsResult, planningResult, openingResult, movementsResult, byproductsResult, settingsResult, historicalSettingsResult] = await Promise.all([
    db.query(`SELECT COUNT(*) entry_count, COUNT(DISTINCT shift_date) production_days, COALESCE(SUM(dipping_qty),0) quantity,
      ROUND(COALESCE(SUM(COALESCE(ms_weight,0)*COALESCE(dipping_qty,0)),0),3) total_ms_kg,
      ROUND(COALESCE(SUM(COALESCE(gi_weight,0)*COALESCE(dipping_qty,0)),0),3) total_gi_kg
      FROM production_entries WHERE shift_date BETWEEN ? AND ? AND COALESCE(row_type,'entry')='entry'`, params),
    db.query(`SELECT shift_name, COUNT(*) entry_count, COALESCE(SUM(dipping_qty),0) quantity,
      ROUND(COALESCE(SUM(COALESCE(ms_weight,0)*COALESCE(dipping_qty,0)),0),3) ms_kg,
      ROUND(COALESCE(SUM(COALESCE(gi_weight,0)*COALESCE(dipping_qty,0)),0),3) gi_kg
      FROM production_entries WHERE shift_date BETWEEN ? AND ? AND COALESCE(row_type,'entry')='entry' GROUP BY shift_name ORDER BY shift_name`, params),
    db.query(`SELECT COALESCE(material,'Unspecified') material, COUNT(*) entry_count, COALESCE(SUM(dipping_qty),0) quantity,
      ROUND(COALESCE(SUM(COALESCE(ms_weight,0)*COALESCE(dipping_qty,0)),0),3) ms_kg,
      ROUND(COALESCE(SUM(COALESCE(gi_weight,0)*COALESCE(dipping_qty,0)),0),3) gi_kg
      FROM production_entries WHERE shift_date BETWEEN ? AND ? AND COALESCE(row_type,'entry')='entry' GROUP BY material ORDER BY ms_kg DESC`, params),
    db.query(`SELECT COALESCE(c.name,'Unassigned') contractor_name, COUNT(*) entry_count, COALESCE(SUM(pe.dipping_qty),0) quantity,
      ROUND(COALESCE(SUM(COALESCE(pe.ms_weight,0)*COALESCE(pe.dipping_qty,0)),0),3) ms_kg,
      ROUND(COALESCE(SUM(COALESCE(pe.gi_weight,0)*COALESCE(pe.dipping_qty,0)),0),3) gi_kg
      FROM production_entries pe LEFT JOIN contractors c ON c.id=pe.contractor_id
      WHERE pe.shift_date BETWEEN ? AND ? AND COALESCE(pe.row_type,'entry')='entry' GROUP BY c.id,c.name ORDER BY ms_kg DESC`, params),
    db.query(`SELECT ppi.id, ppi.challan_no, ppi.party_name, ppi.material_description, ppi.planned_qty,
      COALESCE(SUM(CASE WHEN pe.shift_date BETWEEN ? AND ? THEN pe.dipping_qty ELSE 0 END),0) produced_qty,
      ROUND(COALESCE(SUM(CASE WHEN pe.shift_date BETWEEN ? AND ? THEN COALESCE(pe.ms_weight,0)*COALESCE(pe.dipping_qty,0) ELSE 0 END),0),3) ms_kg,
      ppi.status FROM production_planning_items ppi JOIN production_planning pp ON pp.id=ppi.planning_id
      LEFT JOIN production_entries pe ON pe.planning_item_id=ppi.id AND pe.shift_date BETWEEN ? AND ? AND COALESCE(pe.row_type,'entry')='entry'
      WHERE pp.financial_year_id=? AND (DATE(ppi.created_at) BETWEEN ? AND ? OR EXISTS
        (SELECT 1 FROM production_entries monthly_pe WHERE monthly_pe.planning_item_id=ppi.id
         AND monthly_pe.shift_date BETWEEN ? AND ? AND COALESCE(monthly_pe.row_type,'entry')='entry'))
      GROUP BY ppi.id,ppi.challan_no,ppi.party_name,ppi.material_description,ppi.planned_qty,ppi.status
      ORDER BY ppi.challan_no,ppi.id`, [period.from, period.to, period.from, period.to, period.from, period.to, year.id, period.from, period.to, period.from, period.to]),
    db.query(`SELECT plant_after_kg,kettle_after_kg FROM zinc_stock_movements WHERE created_at < ? ORDER BY id DESC LIMIT 1`, [period.from]),
    db.query(`SELECT movement_type,amount_kg,plant_after_kg,kettle_after_kg,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s') created_at,note
      FROM zinc_stock_movements WHERE created_at>=? AND created_at<DATE_ADD(?,INTERVAL 1 DAY) ORDER BY id`, params),
    db.query(`SELECT ROUND(COALESCE(SUM(ash_weight_kg),0),3) ash_weight_kg,ROUND(COALESCE(SUM(dross_weight_kg),0),3) dross_weight_kg,
      ROUND(COALESCE(SUM(total_with_gst),0),2) total_with_gst,ROUND(COALESCE(SUM(recovered_zinc_kg),0),3) recovered_zinc_kg,COUNT(*) transaction_count
      FROM zinc_byproduct_transactions WHERE transaction_date BETWEEN ? AND ?`, params),
    db.query('SELECT * FROM expense_settings WHERE id=1'),
    db.query(`SELECT * FROM expense_settings_history WHERE created_at<DATE_ADD(?,INTERVAL 1 DAY) ORDER BY id DESC LIMIT 1`, [period.to]),
  ]);
  const production = numeric(productionResult[0])[0];
  const byproducts = numeric(byproductsResult[0])[0];
  const movements = numeric(movementsResult[0]);
  const zinc = summarizeZincMovements(movements, openingResult[0][0]);
  const expenseSettings = historicalSettingsResult[0][0] || settingsResult[0][0];
  const expenses = calculateExpenseReport({ settings: normalizeExpenseSettings(expenseSettings), production: { total_ms_kg: production.total_ms_kg, total_gi_kg: production.total_gi_kg, production_days: production.production_days }, stock: { plant_kg: zinc.closing_plant_kg }, purchasedZincKg: zinc.received_kg, recoveredZincKg: byproducts.recovered_zinc_kg });
  return { financial_year: { id: year.id, name: year.financial_year }, period, production: { ...production, gross_zinc_kg: Math.max(0, production.total_gi_kg-production.total_ms_kg), net_zinc_kg: expenses.totals.net_zinc_consumed_kg, zinc_consumption_percent: expenses.totals.average_zinc_consumption_percent }, shifts: numeric(shiftsResult[0]), materials: numeric(materialsResult[0]), contractors: numeric(contractorsResult[0]), planning: numeric(planningResult[0]), zinc, zinc_movements: movements, byproducts, expenses };
};

const sendError = (res,error) => res.status(error.status||500).json({success:false,message:error.status?error.message:'Could not generate the monthly report.'});
const getMonthlyReport = async (req,res) => { try{return res.json({success:true,data:await buildMonthlyReport({month:req.query.month,financialYearId:req.query.financial_year_id})});}catch(error){console.error(error);return sendError(res,error);} };
const downloadMonthlyReportPdf = async (req,res) => { try{const report=await buildMonthlyReport({month:req.query.month,financialYearId:req.query.financial_year_id});const pdf=await generateMonthlyReportPdf(report);res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Length',pdf.length);res.setHeader('Content-Disposition',`inline; filename="monthly-report-${report.period.from.slice(0,7)}.pdf"`);return res.end(pdf);}catch(error){return sendError(res,error);} };
module.exports={buildMonthlyReport,getMonthlyReport,downloadMonthlyReportPdf};
