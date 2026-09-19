ALTER TABLE production_planning_items ADD COLUMN planning_source ENUM('in_house', 'other_party') NOT NULL DEFAULT 'in_house';
