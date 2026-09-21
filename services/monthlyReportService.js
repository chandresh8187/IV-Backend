const { DateTime } = require('luxon');

const financialYearMonth = (year, monthValue) => {
  const month = Number(monthValue);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw Object.assign(new Error('Select a month from January to December.'), { status: 400 });
  }
  const startYear = Number(String(year.start_date).slice(0, 4));
  const calendarYear = startYear + (month < 4 ? 1 : 0);
  const start = DateTime.fromObject({ year: calendarYear, month, day: 1 });
  return { month, label: start.toFormat('LLLL yyyy'), from: start.toISODate(), to: start.endOf('month').toISODate() };
};

const summarizeZincMovements = (rows, opening = {}) => {
  const summary = { received_kg: 0, transferred_to_kettle_kg: 0, production_used_kg: 0, production_restored_kg: 0, corrections: 0 };
  rows.forEach(row => {
    const amount = Number(row.amount_kg || 0);
    if (row.movement_type === 'receive') summary.received_kg += amount;
    if (row.movement_type === 'transfer') summary.transferred_to_kettle_kg += amount;
    if (row.movement_type === 'production_use') summary.production_used_kg += amount;
    if (row.movement_type === 'production_restore') summary.production_restored_kg += amount;
    if (['initialize', 'adjust'].includes(row.movement_type)) summary.corrections += 1;
  });
  const closing = rows.at(-1) || opening;
  return {
    opening_plant_kg: Number(opening.plant_after_kg || 0), opening_kettle_kg: Number(opening.kettle_after_kg || 0),
    closing_plant_kg: Number(closing.plant_after_kg || 0), closing_kettle_kg: Number(closing.kettle_after_kg || 0),
    ...Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, Math.round(value * 1000) / 1000])),
  };
};

module.exports = { financialYearMonth, summarizeZincMovements };
