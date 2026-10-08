const { randomUUID } = require('node:crypto');

const text = value => String(value ?? '').trim();
const measurement = value => {
  if (typeof value !== 'string' && typeof value !== 'number') return NaN;
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(raw)) return NaN;
  return Number(raw);
};

function validInvoiceDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validateBatchInward(body) {
  for (const field of ['invoice', 'invoiceDate', 'tcNumber', 'vendorCode', 'materialType', 'grade']) {
    if (!text(body[field])) return { error: `${field} is required.` };
  }
  if ([body.invoice, body.tcNumber, body.vendorCode, body.grade].some(value => text(value).length > 100)) {
    return { error: 'One or more text fields exceed their maximum length.' };
  }
  if (!validInvoiceDate(text(body.invoiceDate))) return { error: 'invoiceDate must be a valid date in YYYY-MM-DD format.' };
  const materialType = text(body.materialType);
  if (!['MS', 'GL', 'GP', 'Posmac'].includes(materialType)) return { error: 'Select a valid materialType.' };
  const grade = text(body.grade);
  if (materialType === 'GP') {
    const match = /^GSM - (\d+)$/.exec(grade);
    const gsm = match ? Number(match[1]) : NaN;
    if (!Number.isInteger(gsm) || gsm < 80 || gsm > 140) {
      return { error: 'GP grade must be a GSM number from 80 to 140.' };
    }
  }
  const coilQty = Number(body.coilQty);
  if (!/^\d+$/.test(String(body.coilQty)) || !Number.isSafeInteger(coilQty) || coilQty < 1 || coilQty > 100000) {
    return { error: 'coilQty must be a whole number between 1 and 100000.' };
  }
  const widthMm = measurement(body.widthMm);
  const thicknessMm = measurement(body.thicknessMm);
  const totalWeightKg = measurement(body.totalWeightKg);
  if (![widthMm, thicknessMm, totalWeightKg].every(value => Number.isFinite(value) && value > 0)) {
    return { error: 'Coil size, thickness, and total weight must be positive values with up to three decimal places.' };
  }
  if (widthMm > 9999999 || thicknessMm > 9999999 || totalWeightKg > 999999999) {
    return { error: 'A measurement exceeds the supported range.' };
  }
  const internalId = `U1-${randomUUID()}`;
  return {
    value: {
      internalId, supplier: text(body.vendorCode), supplierCoilId: internalId,
      invoice: text(body.invoice), invoiceDate: text(body.invoiceDate),
      tcNumber: text(body.tcNumber), vendorCode: text(body.vendorCode),
      grade, materialType, coilQty,
      thicknessMm, widthMm, estimatedKg: totalWeightKg,
      grossKg: totalWeightKg, tareKg: 0, actualNetKg: totalWeightKg,
      qualityStatus: 'pending', qualityNote: null,
      receivedAt: new Date().toISOString().slice(0, 23).replace('T', ' '),
    },
  };
}

function validateInward(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'A coil object is required.' };
  if ('materialType' in body || 'coilQty' in body || 'totalWeightKg' in body) return validateBatchInward(body);
  const fields = ['internalId', 'supplier', 'supplierCoilId', 'grade'];
  for (const field of fields) {
    if (!text(body[field])) return { error: `${field} is required.` };
  }
  if (text(body.internalId).length > 80 || text(body.supplier).length > 160 || text(body.supplierCoilId).length > 100 || text(body.grade).length > 100 || text(body.invoice).length > 100 || text(body.tcNumber).length > 100 || text(body.vendorCode).length > 100) {
    return { error: 'One or more text fields exceed their maximum length.' };
  }
  const invoiceDate = text(body.invoiceDate);
  if (invoiceDate) {
    if (!validInvoiceDate(invoiceDate)) {
      return { error: 'invoiceDate must be a valid date in YYYY-MM-DD format.' };
    }
  }
  const numeric = {};
  for (const field of ['thicknessMm', 'widthMm', 'estimatedKg', 'grossKg', 'tareKg']) {
    numeric[field] = measurement(body[field]);
    if (!Number.isFinite(numeric[field]) || (field !== 'tareKg' && numeric[field] <= 0) || (field === 'tareKg' && numeric[field] < 0)) {
      return { error: `${field} must be a valid value with up to three decimal places.` };
    }
  }
  if (numeric.grossKg <= numeric.tareKg) return { error: 'grossKg must be greater than tareKg.' };
  if (numeric.thicknessMm > 9999999 || numeric.widthMm > 9999999 || numeric.grossKg > 999999999 || numeric.estimatedKg > 999999999) return { error: 'A measurement exceeds the supported range.' };
  const qualityStatus = text(body.qualityStatus || 'pending');
  if (!['pending', 'passed', 'hold'].includes(qualityStatus)) return { error: 'Invalid qualityStatus.' };
  const receivedAt = body.receivedAt == null ? new Date() : new Date(body.receivedAt);
  if (Number.isNaN(receivedAt.getTime()) ||
      (body.receivedAt != null && !/^\d{4}-\d{2}-\d{2}T/.test(String(body.receivedAt))) ||
      receivedAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return { error: 'receivedAt must be a valid past ISO date.' };
  }
  return {
    value: {
      internalId: text(body.internalId), supplier: text(body.supplier),
      supplierCoilId: text(body.supplierCoilId), invoice: text(body.invoice) || null,
      invoiceDate: invoiceDate || null, tcNumber: text(body.tcNumber) || null,
      vendorCode: text(body.vendorCode) || null,
      grade: text(body.grade), materialType: null, coilQty: 1, ...numeric,
      actualNetKg: Math.round((numeric.grossKg - numeric.tareKg) * 1000) / 1000,
      qualityStatus, qualityNote: text(body.qualityNote) || null,
      receivedAt: receivedAt.toISOString().slice(0, 23).replace('T', ' '),
    },
  };
}

module.exports = { validateInward };
