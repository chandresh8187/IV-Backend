-- Keep one shared selection without modifying any existing year or production.
CREATE TABLE IF NOT EXISTS current_financial_year (
  id TINYINT UNSIGNED NOT NULL,
  financial_year_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_current_financial_year
    FOREIGN KEY (financial_year_id) REFERENCES financial_years(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
