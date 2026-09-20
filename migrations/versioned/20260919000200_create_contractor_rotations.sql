CREATE TABLE IF NOT EXISTS contractor_rotations (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  effective_from DATE NOT NULL,
  day_contractor_id INT NULL,
  night_contractor_id INT NULL,
  rotate_monthly TINYINT(1) NOT NULL DEFAULT 1,
  revision INT NOT NULL DEFAULT 1,
  updated_by INT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_contractor_rotation_date (effective_from),
  CONSTRAINT fk_rotation_day FOREIGN KEY (day_contractor_id) REFERENCES contractors(id),
  CONSTRAINT fk_rotation_night FOREIGN KEY (night_contractor_id) REFERENCES contractors(id)
) ENGINE=InnoDB;
