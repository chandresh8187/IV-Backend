CREATE TABLE IF NOT EXISTS gas_bottles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  receipt_id BIGINT UNSIGNED NOT NULL,
  bottle_code VARCHAR(50) NOT NULL,
  status ENUM('filled','ready','running','finished','empty') NOT NULL DEFAULT 'filled',
  position_no TINYINT UNSIGNED NULL,
  initial_gas_kg DECIMAL(10,3) NOT NULL DEFAULT 425.000,
  remaining_gas_kg DECIMAL(10,3) NOT NULL DEFAULT 425.000,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_gas_bottle_code (bottle_code),
  UNIQUE KEY uq_gas_position (position_no),
  KEY idx_gas_bottle_status (status),
  CONSTRAINT fk_gas_bottle_receipt FOREIGN KEY (receipt_id) REFERENCES gas_bottle_receipts(id)
) ENGINE=InnoDB;
