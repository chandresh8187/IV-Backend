const test = require('node:test');
const assert = require('node:assert/strict');
const { ROLES, FIELDS, normalizeFields, coilWeightKg } = require('../services/unit1CoilQr');

test('QR scan settings accept only known fields and roles', () => {
  assert.ok(ROLES.includes('labour'));
  assert.ok(FIELDS.some(field => field.key === 'perCoilWeightKg'));
  assert.deepEqual(normalizeFields(['grade', 'grade', 'perCoilWeightKg']), ['grade', 'perCoilWeightKg']);
  assert.equal(normalizeFields(['password']), null);
});

test('calculated individual weights sum exactly to total weight in grams', () => {
  assert.deepEqual([1, 2, 3].map(index => coilWeightKg(100, 3, index)), [33.334, 33.333, 33.333]);
  assert.equal(coilWeightKg(100, 3, 4), null);
  assert.equal(coilWeightKg(0.002, 3, 3), 0);
});
