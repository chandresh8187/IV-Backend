const { weightInput, lockWeights, finishCoils } = require('./unit1Weighbridge');
const fail = (status, message) => Object.assign(new Error(message), { status });
function normalizeDispatch(body = {}) {
  const itemId = Number(body.itemId), quantity = Number(body.quantity);
  if (!/^[1-9]\d*$/.test(String(body.itemId)) || !Number.isSafeInteger(itemId)) throw fail(400, 'Select a valid stock item.');
  if (!/^[1-9]\d*$/.test(String(body.quantity)) || !Number.isSafeInteger(quantity) || quantity > 1000000) throw fail(400, 'Dispatch quantity must be 1 to 1,000,000 whole nos.');
  if (!['unit2', 'other'].includes(body.destination)) throw fail(400, 'Select To Unit 2 or To Other.');
  if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId)) throw fail(400, 'A valid request ID is required.');
  const note = body.note ?? '';
  if (typeof note !== 'string' || note.trim().length > 255 || /[\x00-\x1f]/.test(note)) throw fail(400, 'Enter a valid dispatch reference or note.');
  if (body.finishCoils != null && typeof body.finishCoils !== 'boolean') throw fail(400, 'Choose whether to finish the source coils.');
  return { itemId, quantity, destination: body.destination, note: note.trim(), requestId: body.requestId, weighbridgeWeightKg: weightInput(body.weighbridgeWeightKg), finishCoils: body.finishCoils === true };
}

// Allocations stay attached to the original production/opening movement. When a
// job correction reclassifies material or customer, balances and reports follow
// that movement while the dispatch's original item snapshot remains auditable.
async function recordDispatch(c, body, userId) {
  const v = normalizeDispatch(body);
  await lockWeights(c);
  const [[item]] = await c.execute('SELECT * FROM unit1_material_stock_items WHERE id=? FOR UPDATE', [v.itemId]);
  if (!item) throw fail(404, 'Material not found.');
  const [[prior]] = await c.execute('SELECT * FROM unit1_material_dispatches WHERE request_key=? FOR UPDATE', [v.requestId]);
  if (prior) {
    if (Number(prior.item_id) !== v.itemId || Number(prior.quantity) !== v.quantity || prior.destination !== v.destination || (prior.note || '') !== v.note || Number(prior.actor_user_id) !== Number(userId) || Number(prior.weighbridge_weight_kg) !== v.weighbridgeWeightKg || Boolean(prior.finish_requested) !== v.finishCoils) throw fail(409, 'This request was already used for a different dispatch.');
    return { id: prior.id, itemId: v.itemId, quantity: v.quantity };
  }
  const [[packed]]=await c.execute(`SELECT COUNT(*) AS count FROM unit1_material_packed_bundles pb JOIN unit1_material_stock_movements m ON m.id=pb.source_movement_id WHERE m.item_id=? AND pb.quantity>(SELECT COALESCE(SUM(bw.quantity),0) FROM unit1_material_dispatch_bundle_weights bw WHERE bw.bundle_id=pb.id)`,[v.itemId]);
  if(Number(packed.count))throw fail(409,'This material has labelled bundles. Open party stock and dispatch the selected bundles with their actual weights.');
  const [sources] = await c.execute(`SELECT m.id,m.quantity FROM unit1_material_stock_movements m WHERE m.item_id=? ORDER BY m.created_at,m.id FOR UPDATE`, [v.itemId]);
  const [used] = await c.execute(`SELECT a.source_movement_id AS movementId,SUM(a.quantity) AS quantity FROM unit1_material_dispatch_allocations a
    JOIN unit1_material_stock_movements m ON m.id=a.source_movement_id WHERE m.item_id=? GROUP BY a.source_movement_id`, [v.itemId]);
  const allocated = new Map(used.map(row => [String(row.movementId), Number(row.quantity)]));
  const available = sources.reduce((total, row) => total + Number(row.quantity) - (allocated.get(String(row.id)) || 0), 0);
  if (v.quantity > available) throw fail(409, `Only ${available} nos are available. Refresh stock and reduce the dispatch quantity.`);
  const [entry] = await c.execute(`INSERT INTO unit1_material_dispatches (item_id,quantity,destination,note,request_key,actor_user_id,item_snapshot,weighbridge_weight_kg,weighed_at,weighed_by,finish_requested) VALUES (?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(3),?,?)`, [v.itemId,v.quantity,v.destination,v.note || null,v.requestId,userId,JSON.stringify(item),v.weighbridgeWeightKg,userId,v.finishCoils ? 1 : 0]);
  let remaining = v.quantity;
  for (const source of sources) {
    const quantity = Math.min(remaining, Number(source.quantity) - (allocated.get(String(source.id)) || 0));
    if (quantity <= 0) continue;
    await c.execute('INSERT INTO unit1_material_dispatch_allocations (dispatch_id,source_movement_id,quantity) VALUES (?,?,?)', [entry.insertId,source.id,quantity]);
    remaining -= quantity;
    if (!remaining) break;
  }
  const reconciliation = v.finishCoils ? await finishCoils(c,entry.insertId,userId) : null;
  return { id: entry.insertId, itemId: v.itemId, quantity: v.quantity, weighbridgeWeightKg:v.weighbridgeWeightKg, reconciliation };
}
const allocatedSql = 'SELECT source_movement_id,SUM(quantity) AS quantity FROM unit1_material_dispatch_allocations GROUP BY source_movement_id';
const balanceJoin = `LEFT JOIN (SELECT m.item_id,SUM(m.quantity-COALESCE(a.quantity,0)) AS quantity,
  SUM(CASE WHEN m.movement_type='production' THEN m.quantity ELSE 0 END) AS productionNos,
  SUM(CASE WHEN m.movement_type='opening' THEN m.quantity ELSE 0 END) AS openingNos,
  SUM(COALESCE(a.quantity,0)) AS dispatchedNos FROM unit1_material_stock_movements m
  LEFT JOIN (${allocatedSql}) a ON a.source_movement_id=m.id GROUP BY m.item_id) s ON s.item_id=i.id`;
module.exports = { normalizeDispatch, recordDispatch, balanceJoin };
