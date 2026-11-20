CREATE TABLE IF NOT EXISTS unit1_material_templates (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(180) NOT NULL, specification LONGTEXT NOT NULL,
 version INT UNSIGNED NOT NULL DEFAULT 1, source_job_card_id BIGINT UNSIGNED NULL,
 created_by BIGINT UNSIGNED NULL, archived_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_template_legacy_source(source_job_card_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS unit1_production_plans (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 party_name VARCHAR(150) NOT NULL, project_name VARCHAR(180) NOT NULL DEFAULT '',
 plan_date DATE NOT NULL, shift ENUM('day','night') NOT NULL,
 version INT UNSIGNED NOT NULL DEFAULT 1, request_key VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
 original_input LONGTEXT NOT NULL, created_by BIGINT UNSIGNED NULL, archived_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_plan_request(request_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS unit1_production_plan_lines (
 job_card_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, plan_id BIGINT UNSIGNED NOT NULL,
 template_id BIGINT UNSIGNED NOT NULL, template_version INT UNSIGNED NOT NULL,
 original_input LONGTEXT NOT NULL,
 FOREIGN KEY(job_card_id) REFERENCES unit1_job_cards(id),
 FOREIGN KEY(plan_id) REFERENCES unit1_production_plans(id),
 FOREIGN KEY(template_id) REFERENCES unit1_material_templates(id),
 KEY idx_plan_lines(plan_id), KEY idx_template_lines(template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS unit1_planning_revisions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 entity_type VARCHAR(20) NOT NULL, entity_id BIGINT UNSIGNED NOT NULL,
 actor_user_id BIGINT UNSIGNED NULL, before_data LONGTEXT NULL, after_data LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), KEY idx_planning_audit(entity_type,entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS unit1_planning_lock(id TINYINT UNSIGNED NOT NULL PRIMARY KEY) ENGINE=InnoDB;
INSERT IGNORE INTO unit1_planning_lock(id) VALUES(1);
