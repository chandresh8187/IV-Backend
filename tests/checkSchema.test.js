const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { expectedSchema, expectedMigrations, checkSchema } = require('../scripts/checkSchema');

test('schema check reports drift even when a migration is marked applied', async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'u436685010_iv_app_clean_install.sql'), 'utf8');
  const tables = expectedSchema(sql);
  const migrations = expectedMigrations();
  assert.equal(tables.size, 42);
  assert.equal(migrations.size, 73);

  const tableRows = [...tables.keys()].map(table_name => ({ table_name }));
  const columnRows = [...tables].flatMap(([table_name, expected]) =>
    [...expected.columns].filter(column_name => !(table_name === 'labour_weight_entries' && column_name === 'pickling_started_at'))
      .map(column_name => ({ table_name, column_name })));
  const indexRows = [...tables].flatMap(([table_name, expected]) =>
    expected.indexes.flatMap((index, indexNumber) => index.columns.map((column_name, position) => ({
      table_name,
      index_name: index.kind === 'PRIMARY KEY' ? 'PRIMARY' : `index_${indexNumber}`,
      column_name,
      position: position + 1,
      non_unique: index.kind === 'KEY' ? 1 : 0,
    }))));
  const foreignKeyRows = [...tables].flatMap(([table_name, expected]) =>
    expected.foreignKeys.flatMap((key, keyNumber) => key.columns.map((column_name, position) => ({
      table_name,
      constraint_name: `foreign_key_${keyNumber}`,
      column_name,
      reference_table: key.referenceTable,
      reference_column: key.referenceColumns[position],
      position: position + 1,
    }))));
  const migrationRows = [...migrations].map(([filename, { checksum }]) => ({ filename, checksum }));
  const connection = {
    async query(query) {
      if (query.includes('information_schema.TABLES')) return [tableRows];
      if (query.includes('information_schema.COLUMNS')) return [columnRows];
      if (query.includes('information_schema.STATISTICS')) return [indexRows];
      if (query.includes('information_schema.KEY_COLUMN_USAGE')) return [foreignKeyRows];
      if (query.includes('FROM schema_migrations')) return [migrationRows];
      if (query.includes('COUNT(*) AS count')) return [[{ count: 1 }]];
      throw new Error(`Unexpected query: ${query}`);
    },
  };

  assert.deepEqual(await checkSchema(connection, tables, migrations), [
    'Missing column: labour_weight_entries.pickling_started_at',
  ]);
});
