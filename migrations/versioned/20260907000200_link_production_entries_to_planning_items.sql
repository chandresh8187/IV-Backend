ALTER TABLE production_entries
  ADD COLUMN planning_item_id BIGINT UNSIGNED NULL AFTER planning_id,
  ADD INDEX idx_production_entries_planning_item_id (planning_item_id),
  ADD CONSTRAINT fk_production_entries_planning_item
    FOREIGN KEY (planning_item_id) REFERENCES production_planning_items(id) ON DELETE SET NULL;
