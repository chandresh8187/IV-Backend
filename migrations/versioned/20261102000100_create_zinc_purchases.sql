CREATE TABLE IF NOT EXISTS zinc_purchases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  movement_id BIGINT UNSIGNED NOT NULL,
  transaction_date DATE NOT NULL,
  transaction_time TIME NULL,
  amount_kg DECIMAL(14,3) NOT NULL,
  zinc_rate_per_kg DECIMAL(12,2) NOT NULL,
  batch_number VARCHAR(100) NULL,
  invoice_number VARCHAR(100) NULL,
  note VARCHAR(255) NOT NULL DEFAULT '',
  actor_user_id INT NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL,
  UNIQUE KEY uq_zinc_purchase_movement (movement_id),
  KEY idx_zinc_purchase_date (transaction_date, id),
  CONSTRAINT fk_zinc_purchase_movement FOREIGN KEY (movement_id) REFERENCES zinc_stock_movements(id) ON DELETE RESTRICT
);
