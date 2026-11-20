const { roundKg } = require('./unit1MaterialWeight');

function numberedCoilUsage(batch, runs, { startNumber = 1, count = Number(batch.coilQty || 0) } = {}) {
  const byNumber = new Map();
  for (const run of runs) {
    const number = Number(run.coilNumber);
    const previous = byNumber.get(number);
    // Routes order runs by ID, so metadata describes the latest use.
    byNumber.set(number, {
      ...run,
      theoreticalUsedKg: Number(previous?.theoreticalUsedKg || 0) + Number(run.theoreticalUsedKg || 0),
      producedPieces: Number(previous?.producedPieces || 0) + Number(run.producedPieces || 0),
      holeScrapKg: previous?.holeScrapKg === null || run.holeScrapKg === null ? null : Number(previous?.holeScrapKg || 0) + Number(run.holeScrapKg || 0),
    });
  }
  return Array.from({ length: count }, (_, index) => {
    const coilNumber = startNumber + index;
    const run = byNumber.get(coilNumber) || null;
    const startingWeightKg = null;
    const theoreticalUsedKg = Number(run?.theoreticalUsedKg || 0);
    const settlement = batch.weightSettlements?.find(row=>Number(row.coilNumber)===coilNumber);
    return {
      coilNumber,
      startingWeightKg,
      theoreticalUsedKg: roundKg(theoreticalUsedKg),
      holeScrapKg: run?.holeScrapKg === null ? null : roundKg(run?.holeScrapKg || 0),
      theoreticalRemainingKg: startingWeightKg==null?null:settlement ? 0 : roundKg(startingWeightKg - theoreticalUsedKg),
      weightFinished: Boolean(settlement),
      reconciliationId: settlement?.settlementId || null,
      groupScrapKg: settlement?.groupScrapKg==null?null:Number(settlement.groupScrapKg),
      producedPieces: Number(run?.producedPieces || 0),
      runId: run?.runId || null,
      runStatus: run?.status || null,
      jobCardId: run?.jobCardId || null,
      planningId: run?.planningId || null,
      templateId: run?.templateId || null,
      memberName: run?.memberName || null,
      machineCode: run?.machineCode || null,
      machineName: run?.machineName || null,
    };
  });
}

module.exports = { numberedCoilUsage };
