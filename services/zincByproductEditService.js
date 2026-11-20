const crypto = require('node:crypto');
const { DateTime } = require('luxon');
const { calculateByproductRecovery } = require('./zincByproductService');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const version = row => crypto.createHash('sha256').update(JSON.stringify([
  String(row.transaction_date), ...['ash_weight_kg','ash_rate','dross_weight_kg','dross_rate','zinc_rate_snapshot','recovered_zinc_kg'].map(key => Number(row[key])), row.note || '',
])).digest('hex');
async function editByproduct(connection, { id, body, actorId }) {
  if (!Number.isSafeInteger(id) || id <= 0) throw fail('Select a valid collection.');
  const date = body.transaction_date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date).isValid || date > DateTime.now().setZone('Asia/Kolkata').toISODate()) throw fail('Select a valid date on or before today.');
  if (typeof body.edit_version !== 'string' || !/^[a-f0-9]{64}$/.test(body.edit_version)) throw fail('Refresh the collection before editing.', 409);
  if (typeof body.request_id !== 'string' || !/^[\w-]{8,120}$/.test(body.request_id)) throw fail('A valid request ID is required.');
  const note = String(body.note || '').trim();
  if (note.length > 255) throw fail('Note must be 255 characters or fewer.');
  const hash = crypto.createHash('sha256').update(JSON.stringify({ id, body, actorId })).digest('hex');
  // Match purchase corrections' lock order, which can recalculate this recovery.
  await connection.query('SELECT id FROM zinc_stock WHERE id=1 FOR UPDATE');
  const [requests] = await connection.query('SELECT byproduct_id, request_hash FROM zinc_byproduct_audit WHERE request_id=?', [body.request_id]);
  if (requests.length) {
    if (Number(requests[0].byproduct_id) !== id || requests[0].request_hash !== hash) throw fail('Request ID already used for another correction.', 409);
    return { id, alreadySaved: true };
  }
  const [rows] = await connection.query("SELECT *, DATE_FORMAT(transaction_date, '%Y-%m-%d') transaction_date FROM zinc_byproduct_transactions WHERE id=? FOR UPDATE", [id]);
  const before = rows[0];
  if (!before) throw fail('Collection not found.', 404);
  if (version(before) !== body.edit_version) throw fail('This collection changed. Refresh and review it before saving.', 409);
  // Retain its historical purchase-rate snapshot and purchase link.
  const values = calculateByproductRecovery({ ...body, zinc_rate: before.zinc_rate_snapshot });
  await connection.query(`UPDATE zinc_byproduct_transactions SET transaction_date=?, ash_weight_kg=?, ash_rate=?, ash_base_amount=?, ash_gst_amount=?,
    dross_weight_kg=?, dross_rate=?, dross_base_amount=?, dross_gst_amount=?, total_with_gst=?, recovered_zinc_kg=?, note=? WHERE id=?`,
  [date, values.ash_weight_kg, values.ash_rate, values.ash_base_amount, values.ash_gst_amount, values.dross_weight_kg, values.dross_rate,
    values.dross_base_amount, values.dross_gst_amount, values.total_with_gst, values.recovered_zinc_kg, note, id]);
  const after = { ...before, ...values, transaction_date: date, note };
  await connection.query('INSERT INTO zinc_byproduct_audit (byproduct_id, actor_user_id, request_id, request_hash, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?)',
    [id, actorId, body.request_id, hash, JSON.stringify(before), JSON.stringify(after)]);
  return { ...after, edit_version: version(after) };
}
module.exports = { editByproduct, byproductVersion: version };
