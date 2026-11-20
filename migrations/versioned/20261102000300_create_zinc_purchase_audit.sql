CREATE TABLE IF NOT EXISTS zinc_purchase_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  purchase_id BIGINT UNSIGNED NOT NULL,
  actor_user_id INT NOT NULL,
  request_id VARCHAR(100) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  before_json JSON NOT NULL,
  after_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_zinc_purchase_edit_request (request_id),
  KEY idx_zinc_purchase_audit (purchase_id, id),
  CONSTRAINT fk_zinc_purchase_audit FOREIGN KEY (purchase_id) REFERENCES zinc_purchases(id) ON DELETE RESTRICT
);
