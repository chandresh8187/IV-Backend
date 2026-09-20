ALTER TABLE production_entries
  ADD COLUMN contractor_id INT NULL,
  ADD CONSTRAINT fk_production_contractor FOREIGN KEY (contractor_id) REFERENCES contractors(id);
