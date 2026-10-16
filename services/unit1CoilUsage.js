const { coilWeightKg } = require('./unit1CoilQr');
const { roundKg } = require('./unit1MaterialWeight');

function numberedCoilUsage(batch, runs, { startNumber = 1, count = Number(batch.coilQty || 0) } = {}) {
  const byNumber = new Map(runs.map(run => [Number(run.coilNumber), run]));
  return Array.from({ length: count }, (_, index) => {
    const coilNumber = startNumber + index;
    const run = byNumber.get(coilNumber) || null;
    const startingWeightKg = coilWeightKg(batch.totalWeightKg, batch.coilQty, coilNumber);
    const theoreticalUsedKg = Number(run?.theoreticalUsedKg || 0);
    return {
      coilNumber,
      startingWeightKg,
      theoreticalUsedKg: roundKg(theoreticalUsedKg),
      holeScrapKg: run?.holeScrapKg === null ? null : roundKg(run?.holeScrapKg || 0),
      theoreticalRemainingKg: roundKg(startingWeightKg - theoreticalUsedKg),
      producedPieces: Number(run?.producedPieces || 0),
      runId: run?.runId || null,
      runStatus: run?.status || null,
      jobCardId: run?.jobCardId || null,
      memberName: run?.memberName || null,
      machineCode: run?.machineCode || null,
      machineName: run?.machineName || null,
    };
  });
}

module.exports = { numberedCoilUsage };
