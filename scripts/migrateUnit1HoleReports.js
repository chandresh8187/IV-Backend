async function migrateUnit1HoleReports(db) {
  const [columns] = await db.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='unit1_hole_checks'");
  for (const [name, type] of [['report_snapshot', 'LONGTEXT NULL'], ['remarks', 'VARCHAR(1000) NULL'], ['request_key', 'VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL']]) {
    if (!columns.some(column => column.COLUMN_NAME === name)) await db.query(`ALTER TABLE unit1_hole_checks ADD COLUMN ${name} ${type}`);
  }
  const [indexes] = await db.query("SHOW INDEX FROM unit1_hole_checks WHERE Key_name='uq_unit1_check_request'");
  if (!indexes.length) await db.query('ALTER TABLE unit1_hole_checks ADD UNIQUE KEY uq_unit1_check_request (request_key)');
}
module.exports = { migrateUnit1HoleReports };
