CREATE TABLE IF NOT EXISTS financial_years (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  financial_year VARCHAR(7) NOT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_financial_years_value (financial_year),
  KEY idx_financial_years_created_by (created_by),
  CONSTRAINT fk_financial_years_created_by
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
