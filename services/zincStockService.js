const ZINC_DENSITY_KG_M3 = 7130;
const ZINC_KG_PER_MM = 35.65;
const TANK = Object.freeze({
  length_m: 5,
  width_m: 1,
  depth_mm: 1250,
  zinc_density_g_cm3: 7.13,
});
const MAX_GRAMS = 1000000000000;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function grams(value, label, allowZero = false) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+(\.\d{1,3})?$/.test(String(value))) {
    throw fail(`${label} must be kilograms with up to 3 decimal places.`);
  }
  const result = Math.round(Number(value) * 1000);
  if (!Number.isSafeInteger(result) || result < (allowZero ? 0 : 1) || result > MAX_GRAMS) {
    throw fail(`${label} must be ${allowZero ? 'zero or greater' : 'greater than zero'} and within the supported range.`);
  }
  return result;
}

function normalizeMovement(body) {
  if (!['initialize', 'adjust', 'receive', 'transfer'].includes(body.action)) throw fail('Select a valid stock action.');
  if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) throw fail('Refresh stock before saving.');
  if (typeof body.request_id !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(body.request_id)) throw fail('A valid request ID is required.');
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > 255) throw fail('Notes must be 255 characters or fewer.');
  const result = { action: body.action, expected_revision: body.expected_revision, request_id: body.request_id, note };
  if (['initialize', 'adjust'].includes(body.action)) {
    result.plantGrams = grams(body.plant_kg, 'Plant stock', true);
    result.kettleGrams = grams(body.kettle_kg, 'Kettle stock', true);
    result.kgPerMm = ZINC_KG_PER_MM;
  } else result.amountGrams = grams(body.amount_kg, 'Zinc amount');
  return result;
}

function applyMovement(stock, movement) {
  if (Number(stock.revision) !== movement.expected_revision) throw fail('Stock changed on another device. Refresh and review the balances before saving again.', 409);
  let plant = Math.round(Number(stock.plant_kg) * 1000);
  let kettle = Math.round(Number(stock.kettle_kg) * 1000);
  // The configured tank calculation always uses zinc density 7.13 g/cm³.
  // Ignore legacy stored conversion values so existing stock is recalculated too.
  let kgPerMm = ZINC_KG_PER_MM;
  if (movement.action === 'initialize') {
    if (Number(stock.initialized)) throw fail('Opening stock has already been saved.', 409);
    plant = movement.plantGrams;
    kettle = movement.kettleGrams;
    kgPerMm = ZINC_KG_PER_MM;
  } else if (movement.action === 'adjust') {
    if (!Number(stock.initialized)) throw fail('Set opening stock before changing balances.', 409);
    plant = movement.plantGrams;
    kettle = movement.kettleGrams;
    kgPerMm = ZINC_KG_PER_MM;
  } else {
    if (!Number(stock.initialized)) throw fail('Set opening stock before adding or transferring zinc.', 409);
    if (movement.action === 'receive') plant += movement.amountGrams;
    else {
      if (movement.amountGrams > plant) throw fail('There is not enough zinc in plant stock for this transfer.', 409);
      plant -= movement.amountGrams;
      kettle += movement.amountGrams;
    }
  }
  if (plant > MAX_GRAMS) throw fail('Plant stock exceeds the supported range.');
  if (kettle > Math.round(kgPerMm * TANK.depth_mm * 1000)) throw fail('This amount exceeds the tank volume at the configured kg per mm.', 409);
  return { initialized: 1, plant_kg: plant / 1000, kettle_kg: kettle / 1000, kg_per_mm: kgPerMm, revision: Number(stock.revision) + 1 };
}

function serializeStock(stock) {
  const initialized = Boolean(Number(stock?.initialized));
  const kgPerMm = initialized ? ZINC_KG_PER_MM : null;
  const kettle = Number(stock?.kettle_kg || 0);
  return {
    initialized, plant_kg: Number(stock?.plant_kg || 0), kettle_kg: kettle,
    revision: Number(stock?.revision || 0), kg_per_mm: kgPerMm,
    tank: TANK, level_mm: initialized ? kettle / kgPerMm : null,
    capacity_kg: initialized ? kgPerMm * TANK.depth_mm : null,
    fill_percent: initialized ? kettle / (kgPerMm * TANK.depth_mm) * 100 : null,
  };
}

module.exports = {
  TANK,
  ZINC_DENSITY_KG_M3,
  ZINC_KG_PER_MM,
  grams,
  normalizeMovement,
  applyMovement,
  serializeStock,
};
