const test = require('node:test');
const assert = require('node:assert/strict');

const { PRODUCTION_PROFIT_PER_KG, calculateProductionCost } = require('../services/productionCostService');

test('production cost follows rate calculator formula with fixed profit', () => {
  assert.equal(PRODUCTION_PROFIT_PER_KG, 3);
  assert.equal(calculateProductionCost({
    zincPercentage: 7.5,
    averageZincRate: 250,
    runningPlantCost: 4.64,
  }), 26.39);
});

test('production cost requires a saved zinc receipt rate', () => {
  assert.equal(calculateProductionCost({ zincPercentage: 7, averageZincRate: 0, runningPlantCost: 5 }), null);
});
