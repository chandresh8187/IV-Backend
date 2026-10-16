const { traceZincBatches } = require('./zincBatchService');
// Full history is required for FIFO, even for a single month's report.
const zincMovementLedgerSql = `SELECT m.id, m.movement_type, m.amount_kg, m.zinc_rate_per_kg,
  m.plant_after_kg, m.kettle_after_kg, m.note, m.batch_number, m.invoice_number,
  m.production_entry_id, u.name AS actor_name,
  DATE_FORMAT(m.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
  DATE_FORMAT(COALESCE(m.shift_date, p.shift_date), '%Y-%m-%d') AS shift_date,
  COALESCE(m.shift_name, p.shift_name) AS shift_name
  FROM zinc_stock_movements m
  LEFT JOIN production_entries p ON p.id = m.production_entry_id
  LEFT JOIN users u ON u.id = m.actor_user_id ORDER BY m.id`;

function buildZincMovementReport(rows, { period } = {}) {
  const traced = traceZincBatches(rows), result = [], groups = new Map();
  const recordedMovements = traced.movements.filter(row => !period ||
    (row.created_at.slice(0, 10) >= period.from && row.created_at.slice(0, 10) <= period.to));
  for (const row of recordedMovements) {
    const recordedDate = row.created_at.slice(0, 10);
    if (!['production_use', 'production_restore'].includes(row.movement_type)) {
      result.push({ ...row, transaction_date: recordedDate, shift_name: null, movement_count: 1 });
      continue;
    }
    const date = row.shift_date || recordedDate, shift = row.shift_name || 'unavailable', key = `${date}:${shift}`;
    if (!groups.has(key)) groups.set(key, {
      id: row.id, movement_type: 'production_summary', amount_grams: 0,
      transaction_date: date, shift_name: shift, created_at: row.created_at,
      plant_after_kg: null, kettle_after_kg: null, movement_count: 0, allocations: new Map(),
    });
    const group = groups.get(key);
    group.id = row.id;
    group.created_at = row.created_at;
    group.movement_count++;
    group.amount_grams += Math.round(Number(row.amount_kg) * 1000) * (row.movement_type === 'production_restore' ? -1 : 1);
    for (const allocation of row.batch_allocations) {
      if (!group.allocations.has(allocation.lot_key)) group.allocations.set(allocation.lot_key, { ...allocation, grams: 0 });
      group.allocations.get(allocation.lot_key).grams += Math.round(allocation.amount_kg * 1000);
    }
  }
  for (const group of groups.values()) {
    const { allocations, amount_grams, ...row } = group;
    result.push({ ...row, amount_kg: amount_grams / 1000,
      batch_allocations: [...allocations.values()].filter(item => item.grams !== 0).map(item => {
        const { grams, ...allocation } = item;
        return { ...allocation, amount_kg: grams / 1000 };
      }),
    });
  }
  return { rows: result.sort((a, b) => Number(b.id) - Number(a.id)),
    recorded_movements: recordedMovements, batch_balances: traced.batch_balances };
}
module.exports = { zincMovementLedgerSql, buildZincMovementReport };
