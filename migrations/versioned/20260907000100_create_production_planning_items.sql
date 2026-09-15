CREATE TABLE IF NOT EXISTS production_planning_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  planning_id INT NOT NULL,
  item_id BIGINT UNSIGNED NULL,
  material_description VARCHAR(255) NOT NULL,
  planned_qty INT UNSIGNED NOT NULL,
  completed_qty INT UNSIGNED NOT NULL DEFAULT 0,
  target_zinc_percentage DECIMAL(6,2) NULL,
  sequence_no INT UNSIGNED NOT NULL,
  status ENUM('pending', 'completed') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_planning_item_sequence (planning_id, sequence_no),
  KEY idx_planning_items_active (planning_id, status, sequence_no),
  KEY idx_planning_items_item (item_id),
  CONSTRAINT fk_planning_items_planning
    FOREIGN KEY (planning_id) REFERENCES production_planning(id) ON DELETE CASCADE,
  CONSTRAINT fk_planning_items_item
    FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
