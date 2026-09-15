ALTER TABLE production_entries
  ADD COLUMN item_id BIGINT UNSIGNED NULL AFTER planning_item_id,
  ADD INDEX idx_production_entries_item_id (item_id),
  ADD CONSTRAINT fk_production_entries_item
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL;
