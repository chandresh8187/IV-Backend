const fs = require('fs');
const path = require('path');
const { getMigrationChecksums } = require('./migrate');

const migrationDirectory = path.join(__dirname, '..', 'migrations', 'versioned');

const steps = [
  {
    filename: '20260928000100_link_labour_weight_production.sql',
    table: 'labour_weight_entries',
    columns: { production_entry_id: 'BIGINT NULL' },
    indexes: { uq_labour_weight_production: 'UNIQUE KEY uq_labour_weight_production (production_entry_id)' },
  },
  {
    filename: '20260928000400_add_labour_consumed_qty.sql',
    table: 'labour_weight_entries',
    columns: { consumed_qty: 'INT UNSIGNED NOT NULL DEFAULT 0' },
  },
  {
    filename: '20260928000500_create_labour_weight_consumptions.sql',
    table: 'labour_weight_consumptions',
    createTable: true,
  },
  {
    filename: '20260929000100_add_labour_process_times.sql',
    table: 'labour_weight_entries',
    columns: { pickling_time: 'TIME NULL', flux_time: 'TIME NULL', hot_drier_time: 'TIME NULL' },
  },
  {
    filename: '20260929000200_add_production_process_times.sql',
    table: 'production_entries',
    columns: { pickling_time: 'TIME NULL', flux_time: 'TIME NULL', hot_drier_time: 'TIME NULL' },
  },
  {
    filename: '20260929000300_add_labour_process_timers.sql',
    table: 'labour_weight_entries',
    columns: {
      pickling_started_at: 'TIMESTAMP(3) NULL', pickling_duration_seconds: 'INT UNSIGNED NULL',
      flux_started_at: 'TIMESTAMP(3) NULL', flux_duration_seconds: 'INT UNSIGNED NULL',
      hot_drier_started_at: 'TIMESTAMP(3) NULL', hot_drier_duration_seconds: 'INT UNSIGNED NULL',
    },
  },
  {
    filename: '20260929000400_add_production_process_durations.sql',
    table: 'production_entries',
    columns: {
      pickling_duration_seconds: 'INT UNSIGNED NULL', flux_duration_seconds: 'INT UNSIGNED NULL',
      hot_drier_duration_seconds: 'INT UNSIGNED NULL',
    },
  },
  {
    filename: '20260929000500_add_labour_client_timer_starts.sql',
    table: 'labour_weight_entries',
    columns: {
      pickling_client_started_at_ms: 'BIGINT UNSIGNED NULL', flux_client_started_at_ms: 'BIGINT UNSIGNED NULL',
      hot_drier_client_started_at_ms: 'BIGINT UNSIGNED NULL',
    },
  },
  {
    filename: '20260929000600_add_labour_timer_limits.sql',
    table: 'labour_weight_entries',
    columns: {
      pickling_limit_seconds: 'INT NULL', flux_limit_seconds: 'INT NULL', hot_drier_limit_seconds: 'INT NULL',
      zinc_kettle_started_at: 'TIMESTAMP(3) NULL', zinc_kettle_duration_seconds: 'INT NULL',
      zinc_kettle_client_started_at_ms: 'BIGINT UNSIGNED NULL', zinc_kettle_limit_seconds: 'INT NULL',
    },
  },
  {
    filename: '20260929000700_add_production_zinc_kettle_duration.sql',
    table: 'production_entries',
    columns: { zinc_kettle_duration_seconds: 'INT NULL' },
  },
];

async function tableExists(connection, table) {
  const [[row]] = await connection.query(
    'SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table],
  );
  return Number(row.count) > 0;
}

async function existingNames(connection, sql, table) {
  const [rows] = await connection.query(sql, [table]);
  return new Set(rows.map(row => row.name));
}

async function repair(connection) {
  // A new database needs the normal migration sequence to create this table.
  if (!await tableExists(connection, 'labour_weight_entries')) return false;

  for (const step of steps) {
    const sql = fs.readFileSync(path.join(migrationDirectory, step.filename), 'utf8');
    const { checksum, acceptedChecksums } = getMigrationChecksums(sql);
    const [[record]] = await connection.query('SELECT checksum FROM schema_migrations WHERE filename = ?', [step.filename]);
    if (record && !acceptedChecksums.has(record.checksum)) {
      throw new Error(`Applied migration was modified: ${step.filename}`);
    }
    if (step.createTable) {
      await connection.query(sql.trim());
    } else {
      if (!await tableExists(connection, step.table)) {
        throw new Error(`Required table ${step.table} is missing. Restore the clean-install schema before this repair.`);
      }
      const columns = await existingNames(connection,
        'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', step.table);
      const indexes = await existingNames(connection,
        'SELECT DISTINCT INDEX_NAME AS name FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', step.table);
      const additions = [
        ...Object.entries(step.columns || {}).filter(([name]) => !columns.has(name))
          .map(([name, definition]) => `ADD COLUMN \`${name}\` ${definition}`),
        ...Object.entries(step.indexes || {}).filter(([name]) => !indexes.has(name))
          .map(([, definition]) => `ADD ${definition}`),
      ];
      if (additions.length) {
        await connection.query(`ALTER TABLE \`${step.table}\` ${additions.join(', ')}`);
        console.log(`Repaired ${step.table}: ${additions.length} missing definition(s)`);
      }
    }
    if (!record) await connection.query(
      'INSERT INTO schema_migrations (filename, checksum, execution_ms) VALUES (?, ?, 0)',
      [step.filename, checksum],
    );
  }
  return true;
}

module.exports = { steps, repair };
