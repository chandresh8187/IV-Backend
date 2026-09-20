ALTER TABLE user_production_preferences
  ADD COLUMN default_contractor_id INT NULL,
  ADD CONSTRAINT fk_preference_contractor FOREIGN KEY (default_contractor_id) REFERENCES contractors(id) ON DELETE SET NULL;
