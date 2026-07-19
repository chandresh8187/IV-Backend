-- Run only the statements that are not already applied.

ALTER TABLE users
MODIFY COLUMN role ENUM('superadmin','plant_manager','admin','supervisor') NOT NULL;

-- Automatic shifts are system-created, so started_by/ended_by must allow NULL.
ALTER TABLE shifts
MODIFY COLUMN started_by INT(11) NULL,
MODIFY COLUMN ended_by INT(11) NULL;

-- Current plant status must contain exactly one row.
INSERT INTO plant_status (id, status)
VALUES (1, 'running')
ON DUPLICATE KEY UPDATE id = id;
