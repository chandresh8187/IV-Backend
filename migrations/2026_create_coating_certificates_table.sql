-- Run this manually against your MySQL database (no migration runner in this project).

CREATE TABLE IF NOT EXISTS coating_certificates (
  id INT AUTO_INCREMENT PRIMARY KEY,

  tc_no VARCHAR(50) NOT NULL UNIQUE,

  planning_id INT NOT NULL,
  challan_no VARCHAR(100) NOT NULL,
  party_name VARCHAR(255) NOT NULL,
  third_party_name VARCHAR(255) NULL,

  structure VARCHAR(255) NULL,
  quantity VARCHAR(100) NULL,

  inspection_date DATE NOT NULL,
  reference_standard VARCHAR(255) NOT NULL,

  -- Fixed QC checklist, matching the physical certificate format
  visual_check_result VARCHAR(255) NULL,
  visual_check_observation VARCHAR(255) NULL,

  adhesion_test_result VARCHAR(255) NULL,
  adhesion_test_observation VARCHAR(255) NULL,

  knife_test_result VARCHAR(255) NULL,
  knife_test_observation VARCHAR(255) NULL,

  mass_test_result VARCHAR(255) NULL,
  mass_test_observation VARCHAR(255) NULL,

  preece_test_result VARCHAR(255) NULL,
  preece_test_observation VARCHAR(255) NULL,

  remarks TEXT NULL,

  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_certificate_planning
    FOREIGN KEY (planning_id) REFERENCES production_planning(id),
  CONSTRAINT fk_certificate_creator
    FOREIGN KEY (created_by) REFERENCES users(id),

  INDEX idx_certificate_challan (challan_no)
);
