ALTER TABLE zinc_stock_movements
  ADD COLUMN zinc_rate_per_kg DECIMAL(12,2) NULL AFTER amount_kg;
