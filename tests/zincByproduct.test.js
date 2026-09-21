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

test('ash and dross migrations pass migration safety checks', () => {
  for (const name of ['20260921000200_add_current_zinc_rate.sql', '20260921000300_create_zinc_byproduct_transactions.sql']) {
    validateMigrationSql(fs.readFileSync(path.join(__dirname, '../migrations/versioned', name), 'utf8'));
  }
});
