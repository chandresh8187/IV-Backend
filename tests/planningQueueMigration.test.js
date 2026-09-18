const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateMigrationSql, splitSqlStatements } = require('../scripts/migrationSafety');

test('queue migrations each contain one permitted statement', () => {
  for (const filename of ['20260918000100_add_planning_queue_position.sql', '20260918000200_initialize_planning_queue_position.sql']) {
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/versioned', filename), 'utf8');
    assert.equal(splitSqlStatements(sql).length, 1);
    assert.doesNotThrow(() => validateMigrationSql(sql));
  }
});

test('queue exception never permits overwriting existing priority or production values', () => {
  for (const sql of [
    'UPDATE production_planning SET queue_position = -CAST(id AS SIGNED);',
    'UPDATE production_planning SET queue_position = 1 WHERE queue_position IS NULL;',
    'UPDATE production_planning SET completed_qty = 0 WHERE queue_position IS NULL;',
    'UPDATE production_planning SET queue_position = -CAST(id AS SIGNED) WHERE queue_position IS NULL OR 1=1;',
    'UPDATE production_entries SET dipping_qty = 0;',
  ]) assert.throws(() => validateMigrationSql(sql), /cannot update existing rows/);
});

test('multiple statements and destructive statements remain blocked', () => {
  assert.throws(() => validateMigrationSql('SELECT 1; SELECT 2;'), /exactly one/);
  assert.throws(() => validateMigrationSql('TRUNCATE production_entries;'), /not allowed/);
  assert.throws(() => validateMigrationSql('DELETE FROM production_entries;'), /not allowed/);
});
