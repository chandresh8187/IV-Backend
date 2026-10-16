const test = require('node:test');
const assert = require('node:assert/strict');
const { PRODUCTS, positiveId, validateStart, validateOutput } = require('../services/unit1ProductionValidation');

test('production supports the three roll formed products', () => {
  assert.deepEqual(PRODUCTS.map(product => product.key), ['w_beam_crash_barrier', 'solar_mounting_structure', 'gl_hat_purlin']);
});

test('run start needs one machine, one physical coil, and a supported product', () => {
  assert.equal(validateStart({ machineId: 1, coilId: 2, coilNumber: 1, productType: 'gl_hat_purlin' }).value.coilNumber, 1);
  assert.match(validateStart({ machineId: 1, coilId: 2, coilNumber: 0, productType: 'gl_hat_purlin' }).error, /numbered coil/);
  assert.match(validateStart({ machineId: 1, coilId: 2, coilNumber: 1, productType: 'unknown' }).error, /product/);
  assert.equal(positiveId('1.5'), null);
});

test('piece entries require a positive whole count', () => {
  assert.deepEqual(validateOutput({ pieces: 12, note: ' First shift ' }).value, { pieces: 12, note: 'First shift' });
  assert.match(validateOutput({ pieces: 0 }).error, /Pieces/);
  assert.match(validateOutput({ pieces: 1.5 }).error, /Pieces/);
});
