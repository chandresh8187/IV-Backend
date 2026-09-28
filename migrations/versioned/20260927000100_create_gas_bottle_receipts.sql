CREATE TABLE IF NOT EXISTS gas_bottle_receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  bottle_count INT UNSIGNED NOT NULL,
  kg_per_bottle DECIMAL(10,3) NOT NULL DEFAULT 425.000,
  price_per_bottle DECIMAL(12,2) NOT NULL,
  supplier VARCHAR(150) NULL,
  invoice_no VARCHAR(100) NULL,
  received_at DATETIME NOT NULL,
  note VARCHAR(255) NULL,
  actor_user_id INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_gas_receipts_date (received_at),
  CONSTRAINT fk_gas_receipt_user FOREIGN KEY (actor_user_id) REFERENCES users(id)
) ENGINE=InnoDB;
