const test = require('node:test');
const assert = require('node:assert/strict');
const { numberedCoilUsage } = require('../services/unit1CoilUsage');

test('splits a five-coil batch and attributes usage to its numbered coil', () => {
  const batch = { coilQty: 5, totalWeightKg: 5000 };
  const coils = numberedCoilUsage(batch, [
    { runId: 7, coilNumber: 2, status: 'running', producedPieces: 80, theoreticalUsedKg: 400, holeScrapKg: 2, jobCardId: 9, machineCode: 'C1' },
  ]);
  assert.equal(coils.length, 5);
  assert.equal(coils.reduce((sum, coil) => sum + coil.startingWeightKg, 0), 5000);
  assert.deepEqual(coils.map(coil => coil.theoreticalUsedKg), [0, 400, 0, 0, 0]);
  assert.equal(coils[1].theoreticalRemainingKg, 600);
  assert.equal(coils[1].holeScrapKg, 2);
  assert.equal(coils[0].holeScrapKg, 0);
  assert.equal(coils[1].jobCardId, 9);
});

test('unknown punched scrap stays unknown for the affected numbered coil', () => {
  const [coil] = numberedCoilUsage({ coilQty: 1, totalWeightKg: 1000 }, [{ coilNumber: 1, theoreticalUsedKg: 10, holeScrapKg: null }]);
  assert.equal(coil.holeScrapKg, null);
  assert.equal(coil.theoreticalRemainingKg, 990);
});

test('paginates physical coil numbers without changing their identity', () => {
  const coils = numberedCoilUsage({ coilQty: 101, totalWeightKg: 1010 }, [], { startNumber: 51, count: 50 });
  assert.equal(coils.length, 50);
  assert.equal(coils[0].coilNumber, 51);
  assert.equal(coils.at(-1).coilNumber, 100);
});
