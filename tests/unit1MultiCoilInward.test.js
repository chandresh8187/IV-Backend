const test = require('node:test');
const assert = require('node:assert/strict');
const { validateInward, validateMultiBatchInward } = require('../services/unit1CoilValidation');

const documents = { invoice: 'INV-100', invoiceDate: '2026-10-15', vendorCode: 'V01', tcNumber: '' };
const line = (widthMm, coilQty, totalWeightKg) => ({ materialType: 'MS', grade: 'Normal', widthMm, thicknessMm: 2, coilQty, totalWeightKg });

test('one invoice accepts multiple sizes and an omitted TC number', () => {
  const result = validateMultiBatchInward({ ...documents, lines: [line(298, 2, 2400), line(142, 1, 650)] });
  assert.equal(result.error, undefined);
  assert.equal(result.value.length, 2);
  assert.deepEqual(result.value.map(coil => coil.widthMm), [298, 142]);
  assert.deepEqual(result.value.map(coil => coil.coilQty), [2, 1]);
  assert.deepEqual(result.value.map(coil => coil.actualNetKg), [2400, 650]);
  assert.ok(result.value.every(coil => coil.invoice === 'INV-100' && coil.tcNumber === null));
  assert.notEqual(result.value[0].internalId, result.value[1].internalId);
});

test('single coil edits accept a blank TC number', () => {
  assert.equal(validateInward({ ...documents, ...line(298, 2, 2400) }).value.tcNumber, null);
});

test('invalid second line is identified before any inserts', () => {
  const result = validateMultiBatchInward({ ...documents, lines: [line(298, 2, 2400), line(142, 0, 650)] });
  assert.match(result.error, /^Line 2:/);
});
