const test = require('node:test');
const assert = require('node:assert/strict');
const { historySummary } = require('../services/unit1HistorySummary');

test('production weight excludes punched scrap without subtracting it twice from coil consumption', () => {
  const summary = historySummary({ entryCount: 60, pieces: 1200, estimatedUsedKg: '1500.25', holeScrapKg: '25.125' });
  assert.equal(summary.coilUsedKg, 1500.25);
  assert.equal(summary.productionKg, 1475.125);
  assert.equal(summary.holeScrapKg, 25.125);
  assert.equal(summary.otherScrapKg, null);
  assert.equal(summary.entryCount, 60);
});

test('unknown historic hole scrap stays unknown; an empty date returns zero known weights', () => {
  assert.equal(historySummary({ estimatedUsedKg: 100, holeScrapKg: null }).productionKg, null);
  const empty = historySummary({ estimatedUsedKg: 0, holeScrapKg: 0 });
  assert.equal(empty.coilUsedKg, 0);
  assert.equal(empty.productionKg, 0);
  assert.equal(empty.holeScrapKg, 0);
  assert.equal(empty.otherScrapKg, null);
});

test('history deducts the recorded blade scrap once from total coil usage', () => {
  const result = historySummary({ estimatedUsedKg: 101, holeScrapKg: 2, cutBladeScrapKg: 1 });
  assert.equal(result.productionKg, 98);
  assert.equal(result.cutBladeScrapKg, 1);
});
