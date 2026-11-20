const ROLES = ['superadmin', 'production_manager', 'plant_manager', 'admin', 'supervisor', 'labour'];

const FIELDS = [
  { key: 'invoice', label: 'Invoice number' },
  { key: 'invoiceDate', label: 'Invoice date' },
  { key: 'tcNumber', label: 'TC number' },
  { key: 'vendorCode', label: 'Vendor code' },
  { key: 'vendorName', label: 'Vendor name' },
  { key: 'materialType', label: 'Material type' },
  { key: 'grade', label: 'Grade / GSM' },
  { key: 'ratePerKg', label: 'Rate per kg (Rs)' },
  { key: 'widthMm', label: 'Coil size / width (mm)' },
  { key: 'thicknessMm', label: 'Coil thickness (mm)' },
  { key: 'coilQty', label: 'Coil Qty' },
  { key: 'totalWeightKg', label: 'Inward line weight (kg)' },
  { key: 'invoiceTotalWeightKg', label: 'Shared invoice total weight (kg)' },
  { key: 'receivedAt', label: 'Received date' },
];
const MATERIAL_FIELDS=[
  ['customerName','Party / Customer'],['memberName','Structure Type'],['sectionSize','Section size (mm)'],['lengthMm','Cut length (mm)'],['materialType','Material type'],['grade','Grade / GSM'],['thicknessMm','Thickness (mm)'],['producedNos','Produced quantity (nos)'],['dispatchedNos','Dispatched quantity (nos)'],['availableNos','Available quantity (nos)'],['transferredInNos','Transfer in (nos)'],['transferredOutNos','Transfer out (nos)'],['lastProducedAt','Last production date & time'],['originalParties','Original production parties'],['bundles','Bundle references, quantities and dates'],['sourceCoils','Source coil references and permitted coil fields'],['coilUsage','Source coil quantities and estimated weights'],['jobCards','Job Card specifications and hole dimensions'],['jobCardPreview','Job Card 3D preview (section and hole geometry)'],
].map(([key,label])=>({key:'material.'+key,label:'Material · '+label,group:'Material / Party'}));
const SCAN_FIELDS=[...FIELDS.map(field=>({...field,group:'Coil'})),...MATERIAL_FIELDS];
const DEFAULT_SCAN_FIELDS=['materialType','grade','widthMm','thicknessMm','material.customerName','material.memberName','material.sectionSize','material.lengthMm','material.materialType','material.grade','material.thicknessMm','material.availableNos'];

const ALLOWED_FIELDS = new Set(SCAN_FIELDS.map(field => field.key));
const DEFAULT_FIELDS = ['materialType', 'grade', 'widthMm', 'thicknessMm'];

function normalizeFields(value) {
  if (!Array.isArray(value) || value.some(field => typeof field !== 'string' || !ALLOWED_FIELDS.has(field))) return null;
  return [...new Set(value)];
}

function parseFields(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return normalizeFields(Array.isArray(parsed)?parsed.filter(key=>key!=='perCoilWeightKg'):parsed) || DEFAULT_FIELDS;
  } catch { return DEFAULT_FIELDS; }
}

function coilWeightKg(totalWeightKg, coilQty, coilNumber) {
  if(totalWeightKg==null||totalWeightKg==='')return null;
  const qty = Number(coilQty);
  const number = Number(coilNumber);
  const totalGrams = Math.round(Number(totalWeightKg) * 1000);
  if (!Number.isSafeInteger(qty) || qty < 1 || !Number.isSafeInteger(number) || number < 1 || number > qty || !Number.isSafeInteger(totalGrams) || totalGrams < 0) return null;
  return (Math.floor(totalGrams / qty) + (number <= totalGrams % qty ? 1 : 0)) / 1000;
}

module.exports = { ROLES, FIELDS, MATERIAL_FIELDS, SCAN_FIELDS, DEFAULT_SCAN_FIELDS, DEFAULT_FIELDS, normalizeFields, parseFields, coilWeightKg };
