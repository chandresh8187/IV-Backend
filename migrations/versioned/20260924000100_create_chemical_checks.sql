CREATE TABLE IF NOT EXISTS chemical_checks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  inspection_date DATE NOT NULL,
  flux_ph DECIMAL(6,3) NOT NULL,
  flux_density DECIMAL(8,4) NOT NULL,
  acid_ph DECIMAL(6,3) NOT NULL,
  acid_density DECIMAL(8,4) NOT NULL,
  note VARCHAR(255) NULL,
  checked_by_user_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_chemical_checks_date (inspection_date, id),
  KEY idx_chemical_checks_user (checked_by_user_id)
) ENGINE=InnoDB;
