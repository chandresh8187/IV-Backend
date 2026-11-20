async function migrateUnit1StockCards(db) {
 await db.query(`CREATE TABLE IF NOT EXISTS unit1_coil_stock_cards (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 spec_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 material_type VARCHAR(20) NOT NULL, grade VARCHAR(100) NOT NULL,
 width_mm DECIMAL(10,3) NOT NULL, thickness_mm DECIMAL(10,3) NOT NULL,
 created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 archived_at DATETIME(3) NULL
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
module.exports={migrateUnit1StockCards};
