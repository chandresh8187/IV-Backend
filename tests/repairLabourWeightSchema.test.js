const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { getMigrationChecksums } = require('../scripts/migrate');
const { steps, repair } = require('../scripts/repairLabourWeightSchema');

test('repair restores a missing timer column even when its migration is recorded', async () => {
  const columns = new Map();
  const indexes = new Map();
  const records = new Map();
  const alterations = [];
  for (const step of steps) {
    if (!columns.has(step.table)) columns.set(step.table, new Set());
    if (!indexes.has(step.table)) indexes.set(step.table, new Set());
    for (const name of Object.keys(step.columns || {})) columns.get(step.table).add(name);
    for (const name of Object.keys(step.indexes || {})) indexes.get(step.table).add(name);
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', 'versioned', step.filename), 'utf8');
    records.set(step.filename, getMigrationChecksums(sql).checksum);
  }
  columns.get('labour_weight_entries').delete('pickling_started_at');
  const connection = {
    async query(sql, params = []) {
      if (sql.includes('information_schema.TABLES')) return [[{ count: 1 }]];
      if (sql.includes('information_schema.COLUMNS')) return [[...columns.get(params[0])].map(name => ({ name }))];
      if (sql.includes('information_schema.STATISTICS')) return [[...indexes.get(params[0])].map(name => ({ name }))];
      if (sql.startsWith('SELECT checksum FROM schema_migrations')) return [[{ checksum: records.get(params[0]) }]];
      if (sql.startsWith('ALTER TABLE')) {
        alterations.push(sql);
        const table = sql.match(/^ALTER TABLE `([^`]+)`/)[1];
        for (const match of sql.matchAll(/ADD COLUMN `([^`]+)`/g)) columns.get(table).add(match[1]);
      }
      return [{}];
    },
  };

  await repair(connection);
  assert.equal(alterations.length, 1);
  assert.match(alterations[0], /ADD COLUMN `pickling_started_at` TIMESTAMP\(3\) NULL/);
  await repair(connection);
  assert.equal(alterations.length, 1, 'repair is safe to repeat');
});

test('new databases stay on the ordinary migration path', async () => {
  const statements = [];
  const connection = {
    async query(sql) {
      statements.push(sql);
      return [[{ count: 0 }]];
    },
  };
  assert.equal(await repair(connection), false);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /information_schema\.TABLES/);
});
