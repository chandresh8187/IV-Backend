require('dotenv-flow').config({ silent: true });
const db = require('../config/unit1Db');

const additions = [
  ['invoice_date', 'DATE NULL AFTER invoice'],
  ['tc_number', 'VARCHAR(100) NULL AFTER invoice_date'],
  ['vendor_code', 'VARCHAR(100) NULL AFTER supplier'],
  ['material_type', 'VARCHAR(20) NULL AFTER grade'],
  ['coil_qty', 'INT UNSIGNED NOT NULL DEFAULT 1 AFTER material_type'],
];

async function migrateUnit1Coils() {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coils'`,
  );
  if (!rows.length) throw new Error('Unit 1 coils table is missing');
  const existing = new Set(rows.map(row => row.COLUMN_NAME));
  for (const [name, definition] of additions) {
    if (existing.has(name)) continue;
    await db.query(`ALTER TABLE coils ADD COLUMN \`${name}\` ${definition}`);
  }
  const [gradeTables] = await db.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'unit1_material_grades'`,
  );
  if (!gradeTables.length) {
    await db.query(`CREATE TABLE unit1_material_grades (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      material_type VARCHAR(20) NOT NULL,
      grade_value VARCHAR(100) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_unit1_material_grade (material_type, grade_value)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    const defaults = [
      ['MS', 'Normal'], ['MS', 'E250'], ['MS', 'E350'],
      ['GL', '550 MPA'], ['Posmac', '550 MPA'],
    ];
    await db.query(
      `INSERT INTO unit1_material_grades (material_type, grade_value) VALUES ${defaults.map(() => '(?, ?)').join(', ')}`,
      defaults.flat(),
    );
  }
  await db.execute("DELETE FROM unit1_material_grades WHERE material_type = 'GP'");
}

if (require.main === module) {
  migrateUnit1Coils()
    .then(() => console.log('Unit 1 coil schema is ready.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => db.end());
}

module.exports = { migrateUnit1Coils };
