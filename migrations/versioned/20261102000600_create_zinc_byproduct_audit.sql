CREATE TABLE IF NOT EXISTS zinc_byproduct_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  byproduct_id BIGINT NOT NULL,
  actor_user_id BIGINT NOT NULL,
  request_id VARCHAR(120) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  before_json JSON NOT NULL,
  after_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_zinc_byproduct_request (request_id),
  KEY idx_zinc_byproduct_history (byproduct_id)
);
