const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
require('dotenv-flow').config({ silent: true });

const { getDatabaseConfig, getMigrationChecksums, isAcceptedMigrationChecksum } = require('./migrate');

const root = path.join(__dirname, '..');
const cleanInstallPath = path.join(root, 'database', 'u436685010_iv_app_clean_install.sql');
const migrationDirectory = path.join(root, 'migrations', 'versioned');
const requiredSingletonTables = [
  'plant_status', 'shift_settings', 'production_shift_context',
  'zinc_stock', 'expense_settings', 'current_financial_year',
];

function expectedSchema(sql) {
  const tables = new Map();
  for (const [, table, body] of sql.matchAll(/CREATE TABLE IF NOT EXISTS `([^`]+)`\s*\(([\s\S]*?)\) ENGINE=InnoDB/g)) {
    const columns = new Set([...body.matchAll(/^\s*`([^`]+)`\s+/gm)].map(match => match[1]));
    const indexes = [...body.matchAll(/^\s*(PRIMARY KEY|UNIQUE KEY|KEY)\s*(?:`[^`]+`)?\s*\(([^)]+)\)/gm)]
      .map(([, kind, columnList]) => ({
        kind,
        columns: [...columnList.matchAll(/`([^`]+)`/g)].map(match => match[1]),
      }));
    const foreignKeys = [...body.matchAll(/FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s*`([^`]+)`\s*\(([^)]+)\)/g)]
      .map(([, columnList, referenceTable, referenceColumnList]) => ({
        columns: [...columnList.matchAll(/`([^`]+)`/g)].map(match => match[1]),
        referenceTable,
        referenceColumns: [...referenceColumnList.matchAll(/`([^`]+)`/g)].map(match => match[1]),
      }));
    tables.set(table, { columns, indexes, foreignKeys });
  }
  if (!tables.size) throw new Error('Clean-install file contains no table definitions.');
  return tables;
}

function expectedMigrations() {
  return new Map(fs.readdirSync(migrationDirectory)
    .filter(filename => filename.endsWith('.sql'))
    .map(filename => {
      const sql = fs.readFileSync(path.join(migrationDirectory, filename), 'utf8');
      return [filename, getMigrationChecksums(sql)];
    }));
}

async function checkSchema(connection, expectedTables, migrations) {
  const problems = [];
  const [tableRows] = await connection.query(
    'SELECT TABLE_NAME AS table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = ?',
    ['BASE TABLE'],
  );
  const actualTables = new Set(tableRows.map(row => row.table_name));
  const [columnRows] = await connection.query(
    'SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()',
  );
  const actualColumns = new Map();
  for (const row of columnRows) {
    if (!actualColumns.has(row.table_name)) actualColumns.set(row.table_name, new Set());
    actualColumns.get(row.table_name).add(row.column_name);
  }
  const [indexRows] = await connection.query(
    'SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, COLUMN_NAME AS column_name, SEQ_IN_INDEX AS position, NON_UNIQUE AS non_unique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()',
  );
  const actualIndexes = new Map();
  for (const row of indexRows) {
    const key = `${row.table_name}:${row.index_name}`;
    if (!actualIndexes.has(key)) actualIndexes.set(key, { table: row.table_name, name: row.index_name, unique: Number(row.non_unique) === 0, columns: [] });
    actualIndexes.get(key).columns[Number(row.position) - 1] = row.column_name;
  }
  const [foreignKeyRows] = await connection.query(
    'SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS constraint_name, COLUMN_NAME AS column_name, REFERENCED_TABLE_NAME AS reference_table, REFERENCED_COLUMN_NAME AS reference_column, ORDINAL_POSITION AS position FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL',
  );
  const actualForeignKeys = new Map();
  for (const row of foreignKeyRows) {
    const key = `${row.table_name}:${row.constraint_name}`;
    if (!actualForeignKeys.has(key)) actualForeignKeys.set(key, { table: row.table_name, referenceTable: row.reference_table, columns: [], referenceColumns: [] });
    const foreignKey = actualForeignKeys.get(key);
    foreignKey.columns[Number(row.position) - 1] = row.column_name;
    foreignKey.referenceColumns[Number(row.position) - 1] = row.reference_column;
  }
  for (const [table, expected] of expectedTables) {
    if (!actualTables.has(table)) {
      problems.push(`Missing table: ${table}`);
      continue;
    }
    for (const column of expected.columns) {
      if (!actualColumns.get(table)?.has(column)) problems.push(`Missing column: ${table}.${column}`);
    }
    const tableIndexes = [...actualIndexes.values()].filter(index => index.table === table);
    for (const index of expected.indexes) {
      const matches = tableIndexes.some(actual => {
        if (index.kind === 'PRIMARY KEY' && actual.name !== 'PRIMARY') return false;
        if (index.kind === 'UNIQUE KEY' && !actual.unique) return false;
        if (index.kind === 'PRIMARY KEY' || index.kind === 'UNIQUE KEY') {
          return actual.columns.join(',') === index.columns.join(',');
        }
        return index.columns.every((column, position) => actual.columns[position] === column);
      });
      if (!matches) problems.push(`Missing ${index.kind.toLowerCase()} on ${table}(${index.columns.join(', ')})`);
    }
    const tableForeignKeys = [...actualForeignKeys.values()].filter(key => key.table === table);
    for (const foreignKey of expected.foreignKeys) {
      const matches = tableForeignKeys.some(actual => actual.referenceTable === foreignKey.referenceTable
        && actual.columns.join(',') === foreignKey.columns.join(',')
        && actual.referenceColumns.join(',') === foreignKey.referenceColumns.join(','));
      if (!matches) problems.push(`Missing foreign key: ${table}(${foreignKey.columns.join(', ')}) -> ${foreignKey.referenceTable}(${foreignKey.referenceColumns.join(', ')})`);
    }
  }
  if (!actualTables.has('schema_migrations')) return problems;
  const [migrationRows] = await connection.query('SELECT filename, checksum FROM schema_migrations');
  const applied = new Map(migrationRows.map(row => [row.filename, row.checksum]));
  for (const [filename, checksums] of migrations) {
    if (!applied.has(filename)) problems.push(`Migration not applied: ${filename}`);
    else if (!isAcceptedMigrationChecksum(filename, checksums, applied.get(filename))) {
      problems.push(`Migration checksum mismatch: ${filename}`);
    }
  }
  for (const table of requiredSingletonTables) {
    if (!actualTables.has(table)) continue;
    const [[row]] = await connection.query(`SELECT COUNT(*) AS count FROM \`${table}\` WHERE id = 1`);
    if (Number(row.count) === 0) problems.push(`Missing required startup row: ${table}.id=1`);
  }
  if (actualTables.has('users')) {
    const [[row]] = await connection.query("SELECT COUNT(*) AS count FROM users WHERE role = 'superadmin' AND is_active = 1");
    if (Number(row.count) === 0) problems.push('No active superadmin account exists');
  }
  return problems;
}

async function main() {
  const schema = fs.readFileSync(cleanInstallPath, 'utf8');
  const expectedTables = expectedSchema(schema);
  const migrations = expectedMigrations();
  const connection = await mysql.createConnection(getDatabaseConfig());
  try {
    const problems = await checkSchema(connection, expectedTables, migrations);
    if (problems.length) {
      console.error(`Schema check found ${problems.length} problem(s):`);
      problems.forEach(problem => console.error(`- ${problem}`));
      process.exitCode = 1;
    } else {
      console.log(`Schema check passed: ${expectedTables.size} tables and ${migrations.size} migrations; required columns, indexes, foreign keys and startup rows exist.`);
    }
  } finally {
    await connection.end();
  }
}

if (require.main === module) main().catch(error => {
  console.error(`Schema check failed: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { expectedSchema, expectedMigrations, checkSchema };
