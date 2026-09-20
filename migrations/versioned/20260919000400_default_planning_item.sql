ALTER TABLE user_production_preferences
  ADD COLUMN default_planning_item_id BIGINT UNSIGNED NULL,
  ADD CONSTRAINT fk_preference_planning_item FOREIGN KEY (default_planning_item_id) REFERENCES production_planning_items(id) ON DELETE SET NULL;
