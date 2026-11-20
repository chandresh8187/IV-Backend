async function migrateUnit1CoilStock(db) {
  const [[column]] = await db.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='coils' AND COLUMN_NAME='stock_archived_at'");
  if (!Number(column.n)) await db.query('ALTER TABLE coils ADD COLUMN stock_archived_at DATETIME(3) NULL');
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_coil_stock_balances (
    coil_id BIGINT UNSIGNED NOT NULL,
    coil_number INT UNSIGNED NOT NULL,
    adjustment_kg DECIMAL(18,4) NOT NULL DEFAULT 0,
    confirmed TINYINT NOT NULL DEFAULT 0,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY(coil_id,coil_number),
    CONSTRAINT fk_unit1_stock_balance_coil FOREIGN KEY(coil_id) REFERENCES coils(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_coil_stock_changes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    width_mm DECIMAL(10,3) NOT NULL,
    thickness_mm DECIMAL(10,3) NOT NULL,
    action ENUM('adjust','delete') NOT NULL,
    target_kg DECIMAL(18,3) NULL,
    reason VARCHAR(1000) NOT NULL,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    request_key VARCHAR(100) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    before_data LONGTEXT NOT NULL,
    after_data LONGTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_unit1_stock_change_request(request_key),
    KEY idx_unit1_stock_change_size(width_mm,thickness_mm,created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
module.exports = {migrateUnit1CoilStock};
