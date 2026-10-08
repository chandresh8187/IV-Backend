const test = require('node:test');
const assert = require('node:assert/strict');
const { validateInward } = require('../services/unit1CoilValidation');

const valid = {
  internalId: 'U1-001', supplier: 'Steel Works', supplierCoilId: 'S-001',
  grade: 'A', thicknessMm: '1.2', widthMm: '950', estimatedKg: '1020',
  grossKg: '1010', tareKg: '10', qualityStatus: 'pending',
};

test('Unit 1 inward data calculates net weight', () => {
  const result = validateInward(valid);
  assert.equal(result.value.actualNetKg, 1000);
});

test('Unit 1 inward data rejects gross weight below tare', () => {
  assert.match(validateInward({ ...valid, grossKg: '8' }).error, /greater than tareKg/);
});

test('Unit 1 inward keeps invoice, TC, and vendor details', () => {
  const result = validateInward({ ...valid, invoice: 'INV-1', invoiceDate: '2026-10-08', tcNumber: 'TC-1', vendorCode: 'VEN-1' });
  assert.equal(result.value.invoiceDate, '2026-10-08');
  assert.equal(result.value.tcNumber, 'TC-1');
  assert.equal(result.value.vendorCode, 'VEN-1');
  assert.match(validateInward({ ...valid, invoiceDate: '2026-02-30' }).error, /invoiceDate/);
});

const batch = {
  invoice: 'INV-2026-1', invoiceDate: '2026-10-08', tcNumber: 'TC-8',
  vendorCode: 'VEN-3', materialType: 'MS', grade: 'E250',
  widthMm: '600', thicknessMm: '2.5', coilQty: '4', totalWeightKg: '4020.125',
};

test('batch inward generates its reference and stores quantity and total weight', () => {
  const result = validateInward(batch);
  assert.match(result.value.internalId, /^U1-/);
  assert.equal(result.value.coilQty, 4);
  assert.equal(result.value.materialType, 'MS');
  assert.equal(result.value.actualNetKg, 4020.125);
  assert.equal(result.value.qualityStatus, 'pending');
});

test('batch inward rejects invalid material, quantity, and weight', () => {
  assert.match(validateInward({ ...batch, materialType: 'Unknown' }).error, /materialType/);
  assert.match(validateInward({ ...batch, coilQty: '2.5' }).error, /coilQty/);
  assert.match(validateInward({ ...batch, totalWeightKg: '0' }).error, /total weight/);
});

test('grades follow the selected material type', () => {
  assert.equal(validateInward({ ...batch, grade: 'Normal' }).value.grade, 'Normal');
  assert.equal(validateInward({ ...batch, materialType: 'GL', grade: '550 MPA' }).value.grade, '550 MPA');
  assert.equal(validateInward({ ...batch, materialType: 'Posmac', grade: '550 MPA' }).value.grade, '550 MPA');
  assert.equal(validateInward({ ...batch, materialType: 'GL', grade: 'E250' }).value.grade, 'E250');
});

test('GP accepts whole GSM grades from 80 through 140', () => {
  assert.equal(validateInward({ ...batch, materialType: 'GP', grade: 'GSM - 80' }).value.grade, 'GSM - 80');
  assert.equal(validateInward({ ...batch, materialType: 'GP', grade: 'GSM - 140' }).value.grade, 'GSM - 140');
  for (const grade of ['GSM - 79', 'GSM - 141', 'GSM - 80.5', '550 MPA']) {
    assert.match(validateInward({ ...batch, materialType: 'GP', grade }).error, /GSM/);
  }
});
