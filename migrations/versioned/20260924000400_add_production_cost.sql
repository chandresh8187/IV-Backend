ALTER TABLE production_entries
  ADD COLUMN production_cost DECIMAL(12,2) NULL AFTER zinc_percentage,
  ADD COLUMN production_cost_zinc_rate DECIMAL(12,2) NULL AFTER production_cost,
  ADD COLUMN production_cost_plant_cost DECIMAL(12,4) NULL AFTER production_cost_zinc_rate,
  ADD COLUMN production_cost_profit DECIMAL(5,2) NULL AFTER production_cost_plant_cost;
