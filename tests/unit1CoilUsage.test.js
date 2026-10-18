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

test('reinserted coil accumulates usage and pieces across returned runs', () => {
  const [coil] = numberedCoilUsage({ coilQty: 1, totalWeightKg: 1000 }, [
    { runId: 10, coilNumber: 1, status: 'returned', theoreticalUsedKg: 400, producedPieces: 80, holeScrapKg: 2, jobCardId: 7 },
    { runId: 12, coilNumber: 1, status: 'returned', theoreticalUsedKg: 100, producedPieces: 20, holeScrapKg: 1, jobCardId: 8 },
    { runId: 15, coilNumber: 1, status: 'running', theoreticalUsedKg: 50, producedPieces: 10, holeScrapKg: 0.5, jobCardId: 9 },
  ]);
  assert.equal(coil.theoreticalUsedKg, 550);
  assert.equal(coil.theoreticalRemainingKg, 450);
  assert.equal(coil.producedPieces, 110);
  assert.equal(coil.holeScrapKg, 3.5);
  assert.equal(coil.runId, 15);
  assert.equal(coil.runStatus, 'running');
  assert.equal(coil.jobCardId, 9);
});

test('returned coil stays visible with its full remaining balance', () => {
  const [coil] = numberedCoilUsage({ coilQty: 1, totalWeightKg: 1000 }, [
    { runId: 10, coilNumber: 1, status: 'returned', theoreticalUsedKg: 500, producedPieces: 100, holeScrapKg: null },
    { runId: 11, coilNumber: 1, status: 'returned', theoreticalUsedKg: 10, producedPieces: 2, holeScrapKg: 0.1 },
  ]);
  assert.equal(coil.runStatus, 'returned');
  assert.equal(coil.theoreticalRemainingKg, 490);
  assert.equal(coil.holeScrapKg, null);
});
