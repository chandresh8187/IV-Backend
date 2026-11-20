CREATE TABLE IF NOT EXISTS zinc_recovery_purchase_links (
  byproduct_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  purchase_id BIGINT UNSIGNED NOT NULL,
  KEY idx_zinc_recovery_purchase (purchase_id),
  CONSTRAINT fk_zinc_recovery_purchase FOREIGN KEY (purchase_id) REFERENCES zinc_purchases(id) ON DELETE RESTRICT
);
