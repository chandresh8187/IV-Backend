async function migrateJobCoils(db){
 await db.query(`CREATE TABLE IF NOT EXISTS unit1_job_card_coils (
 job_card_id BIGINT UNSIGNED NOT NULL,coil_id BIGINT UNSIGNED NOT NULL,coil_number INT UNSIGNED NOT NULL,
 PRIMARY KEY(job_card_id,coil_id,coil_number),KEY idx_unit1_selected_coil(coil_id,coil_number),
 CONSTRAINT fk_unit1_selected_job FOREIGN KEY(job_card_id) REFERENCES unit1_job_cards(id) ON DELETE CASCADE,
 CONSTRAINT fk_unit1_selected_coil FOREIGN KEY(coil_id) REFERENCES coils(id)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
 await db.query(`CREATE TABLE IF NOT EXISTS unit1_job_coil_revisions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,job_card_id BIGINT UNSIGNED NOT NULL,actor_user_id BIGINT UNSIGNED NOT NULL,
 before_data LONGTEXT NOT NULL,after_data LONGTEXT NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),KEY idx_unit1_job_coil_audit(job_card_id,created_at)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
 // Only seed jobs that have never had a coil-list audit, so intentionally removed selections do not reappear at restart.
 await db.query(`INSERT IGNORE INTO unit1_job_card_coils (job_card_id,coil_id,coil_number)
 SELECT DISTINCT r.job_card_id,r.coil_id,r.coil_number FROM unit1_production_runs r JOIN unit1_job_cards j ON j.id=r.job_card_id
 WHERE NOT EXISTS(SELECT 1 FROM unit1_job_coil_revisions a WHERE a.job_card_id=r.job_card_id)`);
}
module.exports={migrateJobCoils};
