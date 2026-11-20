const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calculateByproductRecovery } = require('../services/zincByproductService');
const { validateMigrationSql } = require('../scripts/migrationSafety');

test('ash and dross recovery includes 18 percent GST and converts value at current zinc rate', () => {
  const result = calculateByproductRecovery({
    ash_weight_kg: 100,
    ash_rate: 173,
    dross_weight_kg: 50,
    dross_rate: 210,
    zinc_rate: 300,
  });
  assert.equal(result.ash_base_amount, 17300);
  assert.equal(result.ash_gst_amount, 3114);
  assert.equal(result.dross_base_amount, 10500);
  assert.equal(result.dross_gst_amount, 1890);
  assert.equal(result.total_with_gst, 32804);
  assert.equal(result.recovered_zinc_kg, 109.347);
});

test('ash-only and dross-only entries are accepted, while an empty entry is rejected', () => {
  assert.equal(calculateByproductRecovery({ ash_weight_kg: 100, ash_rate: 173, dross_weight_kg: 0, dross_rate: 0, zinc_rate: 300 }).recovered_zinc_kg, 68.047);
  assert.throws(() => calculateByproductRecovery({ ash_weight_kg: 0, ash_rate: 0, dross_weight_kg: 0, dross_rate: 0, zinc_rate: 300 }), /ash or dross weight/);
});

test('blank form fields allow ash-only and dross-only recovery', () => {
  const ash = calculateByproductRecovery({ ash_weight_kg: '100', ash_rate: '173', dross_weight_kg: '', dross_rate: '', zinc_rate: 300 });
  assert.equal(ash.recovered_zinc_kg, 68.047);
  assert.equal(ash.dross_weight_kg, 0);
  assert.equal(ash.dross_rate, 0);
  assert.equal(ash.dross_base_amount, 0);
  const dross = calculateByproductRecovery({ ash_weight_kg: ' ', ash_rate: '', dross_weight_kg: '50', dross_rate: '210', zinc_rate: 300 });
  assert.equal(dross.recovered_zinc_kg, 41.3);
  assert.equal(dross.ash_weight_kg, 0);
  assert.equal(dross.ash_rate, 0);
  assert.equal(dross.ash_base_amount, 0);
});

test('entered byproducts require rates and blank or invalid weights are rejected', () => {
  assert.throws(() => calculateByproductRecovery({ ash_weight_kg: '100', ash_rate: '', dross_weight_kg: '', dross_rate: '', zinc_rate: 300 }), /Ash sell rate is required/);
  assert.throws(() => calculateByproductRecovery({ ash_weight_kg: '', ash_rate: '', dross_weight_kg: '50', dross_rate: '', zinc_rate: 300 }), /Dross sell rate is required/);
  assert.throws(() => calculateByproductRecovery({ ash_weight_kg: '', ash_rate: '', dross_weight_kg: '', dross_rate: '', zinc_rate: 300 }), /Enter an ash or dross weight/);
  assert.throws(() => calculateByproductRecovery({ ash_weight_kg: '-1', dross_weight_kg: '', zinc_rate: 300 }), /Ash weight must be zero or greater/);
});

test('ash and dross migrations pass migration safety checks', () => {
  for (const name of ['20260921000200_add_current_zinc_rate.sql', '20260921000300_create_zinc_byproduct_transactions.sql']) {
    validateMigrationSql(fs.readFileSync(path.join(__dirname, '../migrations/versioned', name), 'utf8'));
  }
});
