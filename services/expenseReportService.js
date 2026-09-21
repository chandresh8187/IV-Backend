const SETTING_FIELDS = Object.freeze([
  'rate_per_ton', 'staff_salary', 'hardware_expense', 'maintenance_expense',
  'zinc_spray_expense', 'electricity_per_day', 'gas_bottle_rate',
  'chemicals_per_day', 'ms_wire_per_day', 'rent_expense', 'acid_expense',
  'crane_expense', 'other_expense',
]);

const round = (value, decimals = 2) => {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
};

const normalizeExpenseSettings = source => Object.fromEntries(
  SETTING_FIELDS.map(field => [field, round(Number(source?.[field] || 0), 2)]),
);

const validateExpenseSettings = source => {
  const result = {};
  for (const field of SETTING_FIELDS) {
    const raw = source?.[field];
    if (!['string', 'number'].includes(typeof raw) || String(raw).trim() === '' || !/^\d+(\.\d{1,2})?$/.test(String(raw).trim())) {
      throw Object.assign(new Error('Enter every expense as zero or a positive amount with up to 2 decimals.'), { status: 400 });
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || value > 1000000000) {
      throw Object.assign(new Error('Expense amounts must be between 0 and 1,000,000,000.'), { status: 400 });
    }
    result[field] = round(value, 2);
  }
  return result;
};

const calculateExpenseReport = ({ settings, production, stock, purchasedZincKg, recoveredZincKg }) => {
  const values = normalizeExpenseSettings(settings);
  const totalMsKg = round(production?.total_ms_kg || 0, 3);
  const totalGiKg = round(production?.total_gi_kg || 0, 3);
  const productionDays = Math.max(0, Number(production?.production_days || 0));
  const totalProductionTon = totalMsKg / 1000;
  const averagePerDayKg = productionDays ? totalMsKg / productionDays : 0;
  const grossZincKg = Math.max(0, totalGiKg - totalMsKg);
  const netZincKg = Math.max(0, grossZincKg - Number(recoveredZincKg || 0));
  const expenses = {
    salary_per_day: productionDays ? (totalProductionTon * values.rate_per_ton) / productionDays + values.staff_salary : values.staff_salary,
    hardware_per_day: values.hardware_expense,
    maintenance_per_day: values.maintenance_expense,
    zinc_spray_per_day: values.zinc_spray_expense,
    electricity_per_day: values.electricity_per_day,
    gas_per_day: 850 * values.gas_bottle_rate,
    chemicals_per_day: values.chemicals_per_day,
    ms_wire_per_day: values.ms_wire_per_day,
    rent_expense: values.rent_expense,
    acid_expense: values.acid_expense,
    crane_expense: values.crane_expense,
    other_expense: values.other_expense,
  };
  Object.keys(expenses).forEach(key => { expenses[key] = round(expenses[key], 2); });
  const totalExpense = round(Object.values(expenses).reduce((sum, value) => sum + value, 0), 2);
  const averagePerDayTon = averagePerDayKg / 1000;
  return {
    settings: values,
    expenses,
    totals: {
      total_expense: totalExpense,
      running_plant_cost: averagePerDayTon ? round(totalExpense / averagePerDayTon / 1000, 4) : 0,
      total_ms_production_kg: totalMsKg,
      average_ms_production_per_day_kg: round(averagePerDayKg, 3),
      production_days: productionDays,
      plant_zinc_stock_kg: round(stock?.plant_kg || 0, 3),
      purchased_zinc_kg: round(purchasedZincKg || 0, 3),
      gross_zinc_consumed_kg: round(grossZincKg, 3),
      recovered_zinc_kg: round(recoveredZincKg || 0, 3),
      net_zinc_consumed_kg: round(netZincKg, 3),
      average_zinc_consumption_percent: totalMsKg ? round(netZincKg / totalMsKg * 100, 2) : 0,
    },
  };
};

module.exports = { SETTING_FIELDS, normalizeExpenseSettings, validateExpenseSettings, calculateExpenseReport };
