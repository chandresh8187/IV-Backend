require('dotenv-flow').config({ silent: true });
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomBytes } = require('node:crypto');
const db = require('../config/unit1Db');

const target = 'u436685010_iv1_app';

async function main() {
  const connection = await db.getConnection();
  const scratch = `codex_unit1_schema_${randomBytes(6).toString('hex')}`;
  let created = false;
  try {
    await connection.query(`CREATE DATABASE \`${scratch}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await connection.query(`USE \`${scratch}\``);
    const filename = path.join(__dirname, 'migrateUnit1Coils.js');
    const realRequire = createRequire(filename);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, exports: module.exports, console, process,
      require: name => name === '../config/unit1Db' ? connection : realRequire(name),
    }, { filename });
    await module.exports.migrateUnit1Coils();

    const [rows] = await connection.query('SHOW TABLES');
    const pending = new Set(rows.map(row => Object.values(row)[0]));
    const [foreignKeys] = await connection.execute(`SELECT TABLE_NAME AS child,REFERENCED_TABLE_NAME AS parent
      FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME IS NOT NULL`, [scratch]);
    const ordered = [];
    while (pending.size) {
      const ready = [...pending].filter(table => !foreignKeys.some(key => key.child === table && key.parent !== table && pending.has(key.parent))).sort();
      if (!ready.length) throw new Error('Circular schema dependencies require explicit review.');
      for (const table of ready) { ordered.push(table); pending.delete(table); }
    }
    const sql = [
      '-- Unit 1 app and web: clean-install database',
      '-- Database: u436685010_iv1_app',
      '-- Schema reviewed against Unit 1 routes and migrateUnit1Coils.js on 2026-10-16.',
      '-- MariaDB 10.4+ / MySQL 8.0.16+ syntax. Verified on MariaDB 10.4.32.',
      '-- Import into an EMPTY database.',
      '-- Contains system defaults and the requested bootstrap superadmin; no device tokens or production rows.',
      '-- Create/select the database in your hosting control panel before importing.',
      '-- Optional, only when your database user has CREATE DATABASE permission:',
      '-- CREATE DATABASE IF NOT EXISTS `u436685010_iv1_app` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',
      '-- This is a fresh-install file, not an upgrade or reset script.',
      '',
      'SET NAMES utf8mb4;',
      "SET time_zone = '+05:30';",
      "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';",
      `USE \`${target}\`;`,
      '',
    ];
    for (const table of ordered) {
      const [[definition]] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
      sql.push(definition['Create Table'].replace(/\sAUTO_INCREMENT=\d+/g, '') + ';', '');
    }
    sql.push('-- Required system defaults. GP grades are numeric GSM values validated in application code.');
    for (const [table, columns] of [
      ['unit1_material_densities', ['material_type', 'density_g_cm3']],
      ['unit1_material_grades', ['material_type', 'grade_value']],
      ['unit1_shift_settings', ['id', 'day_start', 'day_end', 'night_start', 'night_end']],
    ]) {
      const [defaults] = await connection.query(`SELECT ${columns.map(column => `\`${column}\``).join(',')} FROM \`${table}\``);
      const values = defaults.map(row => '(' + columns.map(column => connection.escape(row[column])).join(', ') + ')');
      sql.push(`INSERT INTO \`${table}\` (${columns.map(column => `\`${column}\``).join(', ')}) VALUES`, values.join(',\n') + ';', '');
    }
    const bootstrapHash = await require('bcryptjs').hash('12345678', 12);
    sql.push('-- Requested bootstrap account: dev@iv.com / 12345678 (bcrypt hash stored below).',
      '-- Change this bootstrap password after initial setup.',
      'INSERT INTO `users` (`name`, `email`, `password`, `role`, `status`) VALUES',
      `('IV Developer', 'dev@iv.com', ${connection.escape(bootstrapHash)}, 'superadmin', 'active');`, '');
    sql.push('-- Role permissions and default QR fields are resolved by the backend when no overrides exist.',
      '-- After import, set UNIT1_DB_NAME=u436685010_iv1_app in the backend environment.',
      '-- Sign in using the bootstrap account above.', '');
    const output = path.join(__dirname, '..', 'database', `${target}_clean_install.sql`);
    fs.writeFileSync(output, sql.join('\n'));
    console.log(`Exported ${ordered.length} tables and system defaults to ${output}`);
  } finally {
    // Only remove the scratch database created by this invocation.
    if (created && /^codex_unit1_schema_[a-f0-9]{12}$/.test(scratch)) await connection.query(`DROP DATABASE \`${scratch}\``);
    connection.release();
    await db.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
