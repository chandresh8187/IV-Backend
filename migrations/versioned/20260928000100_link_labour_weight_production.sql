ALTER TABLE labour_weight_entries
  ADD COLUMN production_entry_id BIGINT NULL,
  ADD UNIQUE KEY uq_labour_weight_production (production_entry_id);
