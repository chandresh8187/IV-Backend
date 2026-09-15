ALTER TABLE production_planning
  ADD COLUMN financial_year_id BIGINT UNSIGNED NULL AFTER id,
  ADD INDEX idx_production_planning_financial_year_id (financial_year_id),
  ADD CONSTRAINT fk_production_planning_financial_year
    FOREIGN KEY (financial_year_id) REFERENCES financial_years(id) ON DELETE SET NULL;
