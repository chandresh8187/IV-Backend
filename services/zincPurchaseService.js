const crypto = require('crypto');
const { normalizeMovement, serializeStock } = require('./zincStockService');
const { zincMovementLedgerSql, buildZincMovementReport } = require('./zincMovementReportService');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// Shared by the legacy receive endpoint and the dedicated purchase form.
async function recordPurchase(connection, movementId) {
  await connection.query(`INSERT INTO zinc_purchases
    (movement_id, transaction_date, transaction_time, amount_kg, zinc_rate_per_kg, batch_number, invoice_number, note, actor_user_id, created_at)
    SELECT id, COALESCE(transaction_date, DATE(created_at)), transaction_time, amount_kg, zinc_rate_per_kg, batch_number, invoice_number, note, actor_user_id, created_at
    FROM zinc_stock_movements WHERE id = ? AND movement_type = 'receive'`, [movementId]);
}

async function editPurchase(connection, { id, body, actorId }) {
  if (!Number.isSafeInteger(id) || id <= 0) throw fail('Select a valid purchase.');
  const movement = normalizeMovement({ ...body, action: 'receive' });
  if (!Number.isSafeInteger(body.purchase_revision) || body.purchase_revision < 0) throw fail('Refresh the purchase before editing.');
  if (!movement.transaction_date) throw fail('Select the purchase date.');
  const hash = crypto.createHash('sha256').update(JSON.stringify({ id, movement, purchase_revision: body.purchase_revision, actorId })).digest('hex');
  // All receipt, transfer, production and correction writes lock this row first.
  const [stocks] = await connection.query('SELECT * FROM zinc_stock WHERE id = 1 FOR UPDATE');
  const stock = stocks[0];
  if (!Number(stock?.initialized)) throw fail('Set opening zinc stock first.', 409);
  const [requests] = await connection.query('SELECT purchase_id, request_hash FROM zinc_purchase_audit WHERE request_id = ?', [movement.request_id]);
  if (requests.length) {
    if (Number(requests[0].purchase_id) !== id || requests[0].request_hash !== hash) throw fail('This request ID was already used for a different purchase edit.', 409);
    return { alreadySaved: true, data: serializeStock(stock) };
  }
  const [purchases] = await connection.query(`SELECT *, DATE_FORMAT(transaction_date, '%Y-%m-%d') transaction_date,
    TIME_FORMAT(transaction_time, '%H:%i') transaction_time FROM zinc_purchases WHERE id = ? FOR UPDATE`, [id]);
  const purchase = purchases[0];
  if (!purchase) throw fail('Purchase not found.', 404);
  if (Number(purchase.revision) !== body.purchase_revision || Number(stock.revision) !== movement.expected_revision) throw fail('Stock or purchase changed. Refresh and review before saving.', 409);
  const deltaGrams = movement.amountGrams - Math.round(Number(purchase.amount_kg) * 1000);
  const [ledger] = await connection.query(zincMovementLedgerSql);
  const batch = buildZincMovementReport(ledger).batch_balances.find(row => Number(row.receipt_id) === Number(purchase.movement_id));
  if (deltaGrams < 0 && -deltaGrams > Math.round(Number(batch?.plant_kg || 0) * 1000)) throw fail('This reduction exceeds the purchase quantity still in plant stock. Zinc already transferred or used cannot be removed from the purchase.', 409);
  const plantGrams = Math.round(Number(stock.plant_kg) * 1000) + deltaGrams;
  if (plantGrams < 0 || plantGrams > 1000000000000) throw fail('This correction would put plant stock outside the supported range.', 409);
  const [originalMovements] = await connection.query('SELECT * FROM zinc_stock_movements WHERE id = ? FOR UPDATE', [purchase.movement_id]);
  const [recoveries] = await connection.query(`SELECT b.* FROM zinc_byproduct_transactions b
    JOIN zinc_recovery_purchase_links l ON l.byproduct_id = b.id WHERE l.purchase_id = ? FOR UPDATE`, [id]);
  const delta = deltaGrams / 1000;
  const fields = [movement.transaction_date, movement.transaction_time || null, movement.amountGrams / 1000, movement.zincRatePerKg, movement.batch_number || null, movement.invoice_number || null, movement.note];
  await connection.query(`UPDATE zinc_purchases SET transaction_date=?, transaction_time=?, amount_kg=?, zinc_rate_per_kg=?, batch_number=?, invoice_number=?, note=?, revision=revision+1, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [...fields, id]);
  await connection.query(`UPDATE zinc_stock_movements SET transaction_date=?, transaction_time=?, amount_kg=?, zinc_rate_per_kg=?, batch_number=?, invoice_number=?, note=? WHERE id=?`, [...fields, purchase.movement_id]);
  // The original snapshots can be reconstructed from the audited range/delta.
  // Kettle quantities and actual production measurements are never changed.
  if (deltaGrams) await connection.query('UPDATE zinc_stock_movements SET plant_after_kg = plant_after_kg + ? WHERE id >= ?', [delta, purchase.movement_id]);
  const [rates] = await connection.query(`SELECT zinc_rate_per_kg FROM zinc_purchases WHERE zinc_rate_per_kg > 0
    ORDER BY transaction_date DESC, COALESCE(transaction_time, '00:00:00') DESC, movement_id DESC LIMIT 1`);
  const currentRate = Number(rates[0]?.zinc_rate_per_kg || movement.zincRatePerKg);
  await connection.query('UPDATE zinc_stock SET plant_kg=?, current_zinc_rate=?, revision=revision+1, updated_at=CURRENT_TIMESTAMP WHERE id=1', [plantGrams / 1000, currentRate]);
  if (Number(purchase.zinc_rate_per_kg) !== movement.zincRatePerKg) await connection.query(`UPDATE zinc_byproduct_transactions b JOIN zinc_recovery_purchase_links l ON l.byproduct_id=b.id
    SET b.zinc_rate_snapshot=?, b.recovered_zinc_kg=ROUND(b.total_with_gst / ?, 3) WHERE l.purchase_id=?`, [movement.zincRatePerKg, movement.zincRatePerKg, id]);
  await connection.query(`INSERT INTO zinc_purchase_audit (purchase_id, actor_user_id, request_id, request_hash, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, actorId, movement.request_id, hash, JSON.stringify({ purchase, stock, movement: originalMovements[0], recoveries }),
      JSON.stringify({ transaction_date: movement.transaction_date, transaction_time: movement.transaction_time || null, amount_kg: movement.amountGrams / 1000, zinc_rate_per_kg: movement.zincRatePerKg, batch_number: movement.batch_number || null, invoice_number: movement.invoice_number || null, note: movement.note, plant_delta_kg: delta, snapshots_from_movement_id: purchase.movement_id, snapshots_to_movement_id: Math.max(...ledger.map(row => Number(row.id))), revision: Number(purchase.revision) + 1 })]);
  return { data: serializeStock({ ...stock, plant_kg: plantGrams / 1000, current_zinc_rate: currentRate, revision: Number(stock.revision) + 1 }) };
}

module.exports = { recordPurchase, editPurchase };
