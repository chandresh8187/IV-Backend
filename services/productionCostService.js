const { DateTime } = require('luxon');
const { calculateExpenseReport, normalizeExpenseSettings } = require('./expenseReportService');

const PRODUCTION_PROFIT_PER_KG = 3;

const round = (value, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

const calculateProductionCost = ({ zincPercentage, currentZincRate, runningPlantCost }) => {
  const zinc = Number(zincPercentage);
  const rate = Number(currentZincRate);
  const plantCost = Number(runningPlantCost);
  if (![zinc, rate, plantCost].every(Number.isFinite) || zinc < 0 || rate <= 0 || plantCost < 0) return null;
  return round((rate * zinc / 100) + plantCost + PRODUCTION_PROFIT_PER_KG, 2);
};

const refreshProductionCost = async (queryable, { entryId, shiftDate, zincPercentage }) => {
  const date = DateTime.fromISO(String(shiftDate || ''), { zone: 'Asia/Kolkata' });
  if (!date.isValid || zincPercentage == null) return null;
  const from = date.startOf('month').toISODate();
  const to = date.endOf('month').toISODate();
  const [settingsRows] = await queryable.query('SELECT * FROM expense_settings WHERE id = 1');
  const [productionRows] = await queryable.query(`SELECT
    ROUND(COALESCE(SUM(COALESCE(ms_weight, 0) * COALESCE(dipping_qty, 0)), 0), 3) total_ms_kg,
    ROUND(COALESCE(SUM(COALESCE(gi_weight, 0) * COALESCE(dipping_qty, 0)), 0), 3) total_gi_kg,
    COUNT(DISTINCT shift_date) production_days
    FROM production_entries WHERE shift_date BETWEEN ? AND ? AND COALESCE(row_type, 'entry') = 'entry'`, [from, to]);
  const [rateRows] = await queryable.query('SELECT current_zinc_rate FROM zinc_stock WHERE id = 1');
  const runningPlantCost = calculateExpenseReport({
    settings: normalizeExpenseSettings(settingsRows[0]), production: productionRows[0],
    stock: {}, purchasedZincKg: 0, recoveredZincKg: 0,
  }).totals.running_plant_cost;
  const currentZincRate = Number(rateRows[0]?.current_zinc_rate || 0);
  const productionCost = calculateProductionCost({ zincPercentage, currentZincRate, runningPlantCost });
  await queryable.query(`UPDATE production_entries SET
    production_cost = ?, production_cost_zinc_rate = ?, production_cost_plant_cost = ?, production_cost_profit = ?
    WHERE id = ?`, [productionCost, currentZincRate || null, runningPlantCost, PRODUCTION_PROFIT_PER_KG, entryId]);
  return { production_cost: productionCost, current_zinc_rate: currentZincRate || null,
    running_plant_cost: runningPlantCost, profit: PRODUCTION_PROFIT_PER_KG };
};

module.exports = { PRODUCTION_PROFIT_PER_KG, calculateProductionCost, refreshProductionCost };
