async function migrateUnit1ProductionCorrections(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_production_bundle_revisions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    bundle_id BIGINT UNSIGNED NOT NULL,
    actor_user_id BIGINT UNSIGNED NOT NULL,
    request_key VARCHAR(80) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    before_data LONGTEXT NOT NULL,
    after_data LONGTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_unit1_bundle_revision_request (request_key),
    KEY idx_unit1_bundle_revisions (bundle_id,id),
    CONSTRAINT fk_unit1_bundle_revision FOREIGN KEY (bundle_id) REFERENCES unit1_production_bundles(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
module.exports={migrateUnit1ProductionCorrections};
