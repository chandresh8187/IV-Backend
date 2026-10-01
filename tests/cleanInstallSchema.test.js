const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getMigrationChecksums } = require('../scripts/migrate');

test('clean install represents every versioned schema migration and marks it applied', () => {
  const root = path.join(__dirname, '..');
  const schema = fs.readFileSync(path.join(root, 'database', 'u436685010_iv_app_clean_install.sql'), 'utf8');
  const directory = path.join(root, 'migrations', 'versioned');
  const files = fs.readdirSync(directory).filter(name => name.endsWith('.sql'));
  assert.ok(files.length > 0);

  for (const filename of files) {
    const migration = fs.readFileSync(path.join(directory, filename), 'utf8');
    const checksum = getMigrationChecksums(migration).checksum;
    assert.ok(schema.includes(`('${filename}','${checksum}',0)`), `${filename} is missing from the manifest`);
    const table = migration.match(/(?:CREATE TABLE IF NOT EXISTS|ALTER TABLE)\s+`?([a-z_]+)`?/i)?.[1];
    if (!table) continue; // data backfills are intentionally absent from an empty database
    const tableBlock = schema.match(new RegExp('CREATE TABLE IF NOT EXISTS `'+table+'` \\(([\\s\\S]*?)\\) ENGINE=InnoDB', 'i'))?.[1];
    assert.ok(tableBlock, `${table} is missing from the clean-install schema`);
    for (const [, column] of migration.matchAll(/ADD COLUMN\s+`?([a-z_]+)`?/gi)) {
      assert.ok(tableBlock.includes('`'+column+'`'), `${table}.${column} is missing from the clean-install schema`);
    }
    for (const [, column] of migration.matchAll(/DROP COLUMN\s+`?([a-z_]+)`?/gi)) {
      assert.ok(!tableBlock.includes('`'+column+'`'), `${table}.${column} should have been removed`);
    }
  }
});
