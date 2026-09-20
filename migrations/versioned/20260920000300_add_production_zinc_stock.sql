ALTER TABLE production_entries
  ADD COLUMN zinc_stock_deducted_kg DECIMAL(14,3) NOT NULL DEFAULT 0;
