CREATE TABLE IF NOT EXISTS zinc_stock_movements (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(100) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  movement_type VARCHAR(20) NOT NULL,
  amount_kg DECIMAL(14,3) NOT NULL DEFAULT 0,
  plant_after_kg DECIMAL(14,3) NOT NULL,
  kettle_after_kg DECIMAL(14,3) NOT NULL,
  note VARCHAR(255) NOT NULL DEFAULT '',
  actor_user_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_zinc_stock_request (request_id),
  KEY idx_zinc_stock_created (created_at, id)
) ENGINE=InnoDB;
