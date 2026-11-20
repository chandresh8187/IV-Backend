async function migrateUnit1MaterialTransfers(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_material_party_transfers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    target_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    source_snapshot LONGTEXT NOT NULL, target_party VARCHAR(160) NOT NULL,
    quantity INT UNSIGNED NOT NULL, actor_user_id BIGINT UNSIGNED NOT NULL,
    request_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_material_party_transfer_allocations (
    transfer_id BIGINT UNSIGNED NOT NULL, bundle_id BIGINT UNSIGNED NOT NULL,
    from_owner VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    to_owner VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    PRIMARY KEY(transfer_id,bundle_id,from_owner), KEY idx_material_transfer_bundle(bundle_id),
    CONSTRAINT fk_material_transfer_header FOREIGN KEY(transfer_id) REFERENCES unit1_material_party_transfers(id),
    CONSTRAINT fk_material_transfer_bundle FOREIGN KEY(bundle_id) REFERENCES unit1_production_bundles(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [[column]]=await db.query("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='unit1_dispatch_note_allocations' AND COLUMN_NAME='stock_owner'");
  if(!Number(column.n)) await db.query("ALTER TABLE unit1_dispatch_note_allocations ADD COLUMN stock_owner VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'origin', DROP PRIMARY KEY, ADD PRIMARY KEY(line_id,bundle_id,stock_owner)");
}
module.exports={migrateUnit1MaterialTransfers};
