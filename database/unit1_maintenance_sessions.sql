CREATE TABLE IF NOT EXISTS unit1_maintenance_sessions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 machine_id BIGINT UNSIGNED NOT NULL, active_machine_id BIGINT UNSIGNED DEFAULT NULL,
 plan_id BIGINT UNSIGNED DEFAULT NULL, record_id BIGINT UNSIGNED DEFAULT NULL,
 started_at DATETIME(3) NOT NULL, ended_at DATETIME(3) DEFAULT NULL,
 duration_seconds BIGINT UNSIGNED DEFAULT NULL,
 started_by BIGINT UNSIGNED NOT NULL, completed_by BIGINT UNSIGNED DEFAULT NULL,
 request_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 original_input LONGTEXT NOT NULL, completed_input LONGTEXT,
 UNIQUE KEY uq_unit1_maintenance_active (active_machine_id),
 UNIQUE KEY uq_unit1_maintenance_request (request_key),
 UNIQUE KEY uq_unit1_maintenance_record (record_id),
 FOREIGN KEY (machine_id) REFERENCES unit1_machines(id),
 FOREIGN KEY (active_machine_id) REFERENCES unit1_machines(id),
 FOREIGN KEY (plan_id) REFERENCES unit1_maintenance_plans(id),
 FOREIGN KEY (record_id) REFERENCES unit1_maintenance_records(id),
 INDEX (machine_id, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
