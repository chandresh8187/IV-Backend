CREATE TABLE IF NOT EXISTS labour_weight_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  labour_user_id INT NOT NULL,
  ms_weight DECIMAL(12,3) NOT NULL,
  dipping_qty INT UNSIGNED NOT NULL,
  status ENUM('pending','used') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_labour_weight_queue (status, id),
  KEY idx_labour_weight_user (labour_user_id),
  CONSTRAINT fk_labour_weight_user FOREIGN KEY (labour_user_id) REFERENCES users(id)
) ENGINE=InnoDB;
