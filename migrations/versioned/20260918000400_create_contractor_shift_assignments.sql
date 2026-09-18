CREATE TABLE IF NOT EXISTS contractor_shift_assignments (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  shift_name ENUM('day', 'night') NOT NULL,
  effective_from DATE NOT NULL,
  contractor_id INT NULL,
  updated_by INT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_contractor_shift_date (shift_name, effective_from),
  CONSTRAINT fk_shift_assignment_contractor FOREIGN KEY (contractor_id) REFERENCES contractors(id)
) ENGINE=InnoDB;
