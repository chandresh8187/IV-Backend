const crypto = require('crypto');
const { ZINC_KG_PER_MM } = require('./zincStockService');

const roundKg = value => Math.round(Number(value) * 1000) / 1000;

const calculateProductionZincKg = ({ dipping_qty, ms_weight, gi_weight }) => {
  const quantity = Number(dipping_qty);
  const ms = Number(ms_weight);
  const gi = Number(gi_weight);
  if (!Number.isFinite(quantity) || !Number.isFinite(ms) || !Number.isFinite(gi)) return 0;
  return roundKg(Math.max(0, gi - ms) * Math.max(0, quantity));
};

const applyProductionZinc = async (connection, {
  entryId,
  srNo,
  actorUserId,
  previousKg = 0,
  nextKg = 0,
}) => {
  const previous = roundKg(previousKg || 0);
  const next = roundKg(nextKg || 0);
  const delta = roundKg(next - previous);
  if (delta === 0) return next;

  await connection.query('INSERT IGNORE INTO zinc_stock (id) VALUES (1)');
  const [rows] = await connection.query(
    'SELECT * FROM zinc_stock WHERE id = 1 FOR UPDATE',
  );
  const stock = rows[0];
  if (!Number(stock?.initialized)) {
    throw Object.assign(
      new Error('Set opening zinc stock before saving production.'),
      { status: 409, code: 'ZINC_STOCK_NOT_INITIALIZED' },
    );
  }
  const kettleAfter = roundKg(Number(stock.kettle_kg) - delta);
  if (kettleAfter < 0) {
    throw Object.assign(
      new Error(`Only ${Number(stock.kettle_kg).toLocaleString('en-IN')} kg zinc remains in the kettle. Add zinc before saving production.`),
      { status: 409, code: 'INSUFFICIENT_KETTLE_ZINC' },
    );
  }
  const capacityKg = roundKg(1250 * ZINC_KG_PER_MM);
  if (kettleAfter > capacityKg) {
    throw Object.assign(
      new Error('Restoring this production entry would exceed the kettle capacity. Correct the kettle stock first.'),
      { status: 409, code: 'KETTLE_CAPACITY_EXCEEDED' },
    );
  }
  const revision = Number(stock.revision) + 1;
  await connection.query(
    `UPDATE zinc_stock SET kettle_kg = ?, kg_per_mm = ?, revision = ?,
       updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
    [kettleAfter, ZINC_KG_PER_MM, revision],
  );
  const movementType = delta > 0 ? 'production_use' : 'production_restore';
  await connection.query(
    `INSERT INTO zinc_stock_movements
      (request_id, request_hash, movement_type, amount_kg, plant_after_kg,
       kettle_after_kg, note, actor_user_id, production_entry_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `production_${entryId}_${crypto.randomUUID()}`,
      crypto.createHash('sha256').update(`${entryId}:${previous}:${next}:${revision}`).digest('hex'),
      movementType,
      Math.abs(delta),
      Number(stock.plant_kg),
      kettleAfter,
      `Production SR ${srNo}`,
      actorUserId,
      entryId,
    ],
  );
  return next;
};

module.exports = { calculateProductionZincKg, applyProductionZinc, roundKg };
