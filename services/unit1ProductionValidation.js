const PRODUCTS = [
  { key: 'w_beam_crash_barrier', label: 'W beam crash barrier' },
  { key: 'solar_mounting_structure', label: 'Solar mounting structure' },
  { key: 'gl_hat_purlin', label: 'GL Hat Purlin' },
  { key: 'purlin_c_lip', label: 'Purlin C Lip' },
];

function positiveId(value) {
  const text = String(value ?? '');
  const number = Number(text);
  return /^\d+$/.test(text) && Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validateStart(body) {
  const machineId = positiveId(body?.machineId);
  const coilId = positiveId(body?.coilId);
  const coilNumber = positiveId(body?.coilNumber);
  const productType = String(body?.productType || '');
  if (!machineId || !coilId || !coilNumber) return { error: 'Select a machine and a numbered coil.' };
  if (!PRODUCTS.some(product => product.key === productType)) return { error: 'Select a valid product.' };
  return { value: { machineId, coilId, coilNumber, productType } };
}

function validateOutput(body) {
  const pieces = positiveId(body?.pieces);
  if (!pieces || pieces > 100000) return { error: 'Pieces must be a whole number from 1 to 100000.' };
  const note = String(body?.note ?? '').trim();
  if (note.length > 255) return { error: 'Note must be 255 characters or fewer.' };
  return { value: { pieces, note: note || null } };
}

module.exports = { PRODUCTS, positiveId, validateStart, validateOutput };
