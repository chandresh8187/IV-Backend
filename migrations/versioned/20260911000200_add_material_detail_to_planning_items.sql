ALTER TABLE production_planning_items
  ADD COLUMN material_detail VARCHAR(255) NULL AFTER item_id;
