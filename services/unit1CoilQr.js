const ROLES = ['superadmin', 'production_manager', 'plant_manager', 'admin', 'supervisor', 'labour'];

const FIELDS = [
  { key: 'invoice', label: 'Invoice number' },
  { key: 'invoiceDate', label: 'Invoice date' },
  { key: 'tcNumber', label: 'TC number' },
  { key: 'vendorCode', label: 'Vendor code' },
  { key: 'materialType', label: 'Material type' },
  { key: 'grade', label: 'Grade / GSM' },
  { key: 'widthMm', label: 'Coil size / width (mm)' },
  { key: 'thicknessMm', label: 'Coil thickness (mm)' },
  { key: 'coilQty', label: 'Coil Qty' },
  { key: 'totalWeightKg', label: 'Total weight (kg)' },
  { key: 'perCoilWeightKg', label: 'Calculated coil weight (kg)' },
  { key: 'receivedAt', label: 'Received date' },
];

const ALLOWED_FIELDS = new Set(FIELDS.map(field => field.key));
const DEFAULT_FIELDS = ['materialType', 'grade', 'widthMm', 'thicknessMm', 'perCoilWeightKg'];

function normalizeFields(value) {
  if (!Array.isArray(value) || value.some(field => typeof field !== 'string' || !ALLOWED_FIELDS.has(field))) return null;
  return [...new Set(value)];
}

function parseFields(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return normalizeFields(parsed) || DEFAULT_FIELDS;
  } catch { return DEFAULT_FIELDS; }
}

function coilWeightKg(totalWeightKg, coilQty, coilNumber) {
  const qty = Number(coilQty);
  const number = Number(coilNumber);
  const totalGrams = Math.round(Number(totalWeightKg) * 1000);
  if (!Number.isSafeInteger(qty) || qty < 1 || !Number.isSafeInteger(number) || number < 1 || number > qty || !Number.isSafeInteger(totalGrams) || totalGrams < 0) return null;
  return (Math.floor(totalGrams / qty) + (number <= totalGrams % qty ? 1 : 0)) / 1000;
}

module.exports = { ROLES, FIELDS, DEFAULT_FIELDS, normalizeFields, parseFields, coilWeightKg };
