ALTER TABLE production_planning_items
  ADD COLUMN challan_no VARCHAR(100) NULL AFTER planning_id,
  ADD COLUMN party_name VARCHAR(255) NULL AFTER challan_no,
  ADD INDEX idx_planning_items_challan (challan_no);
