const { roundKg } = require('./unit1MaterialWeight');

function historySummary(totals) {
  const coilUsedKg = roundKg(Number(totals.estimatedUsedKg || 0));
  const holeScrapKg = totals.holeScrapKg == null ? null : roundKg(Number(totals.holeScrapKg));
  const cutBladeScrapKg = totals.cutBladeScrapKg == null ? null : roundKg(totals.cutBladeScrapKg);
  return {
    ...totals,
    coilUsedKg,
    holeScrapKg,
    cutBladeScrapKg,
    productionKg: holeScrapKg == null ? null : roundKg(Math.max(0, Number(totals.estimatedUsedKg || 0) - Number(totals.holeScrapKg) - Number(totals.cutBladeScrapKg || 0))),
    // Actual total scrap belongs to a finished weighbridge group, reported once
    // in dispatch history. Other scrap is not measured per production entry.
    otherScrapKg: null,
  };
}

module.exports = { historySummary };
