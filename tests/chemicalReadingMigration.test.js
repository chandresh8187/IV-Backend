const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateMigrationSql } = require('../scripts/migrationSafety');
const directory = path.join(__dirname, '../migrations/versioned');
const expansion = fs.readFileSync(path.join(directory, '20261019000100_expand_chemical_readings.sql'), 'utf8');
test('startup validation accepts all versioned migrations including chemical reading expansion', () => {
  for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.sql'))) {
    assert.doesNotThrow(() => validateMigrationSql(fs.readFileSync(path.join(directory, name), 'utf8')), name);
  }
});
test('chemical expansion exemption cannot narrow or change unrelated columns', () => {
  for (const sql of [expansion.replace('flux_ph DOUBLE', 'flux_ph DECIMAL(6,3)'), expansion.replace('chemical_checks', 'production_entries'), expansion.replace('flux_density', 'production_weight'), expansion.replace('DOUBLE NULL', 'DOUBLE NOT NULL'), expansion.replace(';', ', DROP COLUMN note;')]) {
    assert.throws(() => validateMigrationSql(sql));
  }
});
test('only the obsolete named acid pH constraint can be removed', () => {
  assert.doesNotThrow(() => validateMigrationSql('ALTER TABLE chemical_checks DROP CONSTRAINT IF EXISTS chk_acid_ph;'));
  for (const sql of ['ALTER TABLE chemical_checks DROP COLUMN acid_ph;', 'ALTER TABLE chemical_checks DROP CONSTRAINT IF EXISTS other_constraint;', 'DROP TABLE chemical_checks;', 'ALTER TABLE chemical_checks DROP CONSTRAINT IF EXISTS chk_acid_ph; DELETE FROM chemical_checks;']) {
    assert.throws(() => validateMigrationSql(sql));
  }
});
