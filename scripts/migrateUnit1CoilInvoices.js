async function migrateUnit1CoilInvoices(db){
 await db.query(`CREATE TABLE IF NOT EXISTS unit1_coil_invoices(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,vendor_code VARCHAR(100) NOT NULL,invoice VARCHAR(100) NOT NULL,tc_number VARCHAR(100) NULL,total_weight_kg DECIMAL(18,3) NOT NULL,request_key VARCHAR(100) NOT NULL UNIQUE,request_hash CHAR(64) NOT NULL,actor_user_id BIGINT UNSIGNED NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
 const [[col]]=await db.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='coils' AND COLUMN_NAME='invoice_group_id'");
 if(!Number(col.n))await db.query('ALTER TABLE coils ADD COLUMN invoice_group_id BIGINT UNSIGNED NULL,ADD KEY idx_coil_invoice_group(invoice_group_id)');
 await db.query(`CREATE TABLE IF NOT EXISTS unit1_coil_invoice_revisions(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,invoice_id BIGINT UNSIGNED NOT NULL,actor_user_id BIGINT UNSIGNED NOT NULL,before_data LONGTEXT NOT NULL,after_data LONGTEXT NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
module.exports={migrateUnit1CoilInvoices};
