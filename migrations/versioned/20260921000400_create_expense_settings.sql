CREATE TABLE IF NOT EXISTS expense_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  rate_per_ton DECIMAL(14,2) NOT NULL DEFAULT 0,
  staff_salary DECIMAL(14,2) NOT NULL DEFAULT 0,
  hardware_expense DECIMAL(14,2) NOT NULL DEFAULT 0,
  maintenance_expense DECIMAL(14,2) NOT NULL DEFAULT 0,
  zinc_spray_expense DECIMAL(14,2) NOT NULL DEFAULT 0,
  electricity_per_day DECIMAL(14,2) NOT NULL DEFAULT 0,
  gas_bottle_rate DECIMAL(14,2) NOT NULL DEFAULT 0,
  chemicals_per_day DECIMAL(14,2) NOT NULL DEFAULT 0,
  ms_wire_per_day DECIMAL(14,2) NOT NULL DEFAULT 0,
  rent_expense DECIMAL(14,2) NOT NULL DEFAULT 0,
  acid_expense DECIMAL(14,2) NOT NULL DEFAULT 0,
  crane_expense DECIMAL(14,2) NOT NULL DEFAULT 0,
  other_expense DECIMAL(14,2) NOT NULL DEFAULT 0,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expense_settings_user FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB;
