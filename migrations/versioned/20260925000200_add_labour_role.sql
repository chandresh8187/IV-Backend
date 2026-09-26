ALTER TABLE users
  MODIFY COLUMN role ENUM('superadmin','plant_manager','admin','supervisor','labour') NOT NULL;
