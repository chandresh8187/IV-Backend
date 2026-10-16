const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_DENSITY, MATERIAL_TYPES, theoreticalWeightKg, punchAreaMm2, holeScrapKg } = require('../services/unit1MaterialWeight');

test('steel sheet example matches mass from dimensions and density', () => {
  assert.equal(theoreticalWeightKg({ widthMm: 254, lengthMm: 2300, thicknessMm: 3, densityGcm3: 7.86 }), 13.775436);
});

test('bundle gross use includes all pieces and keeps punched slugs in coil consumption', () => {
  const perPiece = theoreticalWeightKg({ widthMm: 178, lengthMm: 5350, thicknessMm: 2, densityGcm3: DEFAULT_DENSITY });
  assert.equal(theoreticalWeightKg({ widthMm: 178, lengthMm: 5350, thicknessMm: 2, pieces: 80 }), perPiece * 80);
  assert.deepEqual(MATERIAL_TYPES, ['MS', 'GL', 'GP', 'Posmac']);
});

test('rounded slot area includes straight middle and two semicircular ends', () => {
  const expected = 9 * (20 - 9) + Math.PI * 4.5 ** 2;
  assert.ok(Math.abs(punchAreaMm2('9×20') - expected) < 1e-10);
  assert.ok(Math.abs(punchAreaMm2('20*9 mm') - expected) < 1e-10);
  assert.ok(Math.abs(punchAreaMm2('Ø9') - Math.PI * 4.5 ** 2) < 1e-10);
});

test('hole scrap counts every hole position in every produced piece', () => {
  const holes = [{ punchSize: '9x20' }, { punchSize: '9x20' }, { punchSize: 'Ø12' }];
  const onePiece = holeScrapKg({ holes, thicknessMm: 3, densityGcm3: 7.85 });
  const bundle = holeScrapKg({ holes, thicknessMm: 3, densityGcm3: 7.85, pieces: 80 });
  assert.ok(Math.abs(bundle - onePiece * 80) < 1e-10);
  assert.equal(holeScrapKg({ holes: [{ punchSize: 'unknown' }], thicknessMm: 3 }), null);
});
