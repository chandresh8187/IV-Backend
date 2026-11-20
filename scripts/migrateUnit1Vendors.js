async function migrateUnit1Vendors(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_vendors (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(100) NOT NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_unit1_vendor_code (code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [[column]] = await db.query(
    "SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='unit1_coil_invoices' AND COLUMN_NAME='vendor_id'",
  );
  if (!Number(column.n)) {
    await db.query(`ALTER TABLE unit1_coil_invoices
      ADD COLUMN vendor_id BIGINT UNSIGNED NULL,
      ADD KEY idx_unit1_invoice_vendor (vendor_id),
      ADD CONSTRAINT fk_unit1_invoice_vendor FOREIGN KEY (vendor_id) REFERENCES unit1_vendors(id)`);
  }
}

module.exports = { migrateUnit1Vendors };
