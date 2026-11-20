-- Apply to the existing Unit 1 database. Quantities are whole pieces (nos).
CREATE TABLE IF NOT EXISTS unit1_material_party_codes (
 party_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
 party_code CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_unit1_material_party_code(party_code)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS unit1_material_stock_items (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 stock_key CHAR(64) CHARACTER SET ascii NOT NULL,
 customer_name VARCHAR(150) NOT NULL DEFAULT '',
 member_name VARCHAR(120) NOT NULL,
 section_size VARCHAR(100) NOT NULL,
 length_mm DECIMAL(12,3) NOT NULL,
 material_type VARCHAR(20) NOT NULL,
 grade VARCHAR(100) NOT NULL,
 thickness_mm DECIMAL(10,3) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_unit1_material_stock_identity (stock_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS unit1_material_dispatches (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 item_id BIGINT UNSIGNED NOT NULL,
 quantity BIGINT UNSIGNED NOT NULL,
 destination VARCHAR(12) NOT NULL,
 note VARCHAR(255) DEFAULT NULL,
 request_key VARCHAR(100) CHARACTER SET ascii NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 item_snapshot LONGTEXT NOT NULL,
 weighbridge_weight_kg DECIMAL(14,3) DEFAULT NULL,
 weighed_at DATETIME(3) DEFAULT NULL,
 weighed_by BIGINT UNSIGNED DEFAULT NULL,
 finish_requested TINYINT NOT NULL DEFAULT 0,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_unit1_dispatch_request (request_key),
 KEY idx_unit1_dispatch_date (created_at,id),
 CONSTRAINT fk_unit1_dispatch_item FOREIGN KEY (item_id) REFERENCES unit1_material_stock_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS unit1_material_stock_movements (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 item_id BIGINT UNSIGNED NOT NULL,
 movement_type VARCHAR(24) NOT NULL,
 quantity BIGINT NOT NULL,
 request_key VARCHAR(100) CHARACTER SET ascii DEFAULT NULL,
 source_bundle_id BIGINT UNSIGNED DEFAULT NULL,
 source_run_id BIGINT UNSIGNED DEFAULT NULL,
 source_job_card_id BIGINT UNSIGNED DEFAULT NULL,
 transfer_reference VARCHAR(100) DEFAULT NULL,
 note VARCHAR(255) DEFAULT NULL,
 actor_user_id BIGINT UNSIGNED DEFAULT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_unit1_material_stock_bundle (source_bundle_id),
 UNIQUE KEY uq_unit1_material_stock_request (request_key),
 KEY idx_unit1_material_stock_history (item_id,created_at,id),
 CONSTRAINT fk_unit1_material_stock_item FOREIGN KEY (item_id) REFERENCES unit1_material_stock_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS unit1_material_dispatch_allocations (
 dispatch_id BIGINT UNSIGNED NOT NULL,
 source_movement_id BIGINT UNSIGNED NOT NULL,
 quantity BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(dispatch_id,source_movement_id),
 KEY idx_unit1_dispatch_source(source_movement_id),
 CONSTRAINT fk_unit1_dispatch_allocation FOREIGN KEY (dispatch_id) REFERENCES unit1_material_dispatches(id),
 CONSTRAINT fk_unit1_dispatch_movement FOREIGN KEY (source_movement_id) REFERENCES unit1_material_stock_movements(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS unit1_material_stock_revisions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 movement_id BIGINT UNSIGNED NOT NULL,
 before_item_id BIGINT UNSIGNED NOT NULL,
 after_item_id BIGINT UNSIGNED NOT NULL,
 reason VARCHAR(100) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS unit1_material_stock_migrations (
 version VARCHAR(64) CHARACTER SET ascii NOT NULL PRIMARY KEY,
 completed_at DATETIME(3) DEFAULT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS unit1_coil_weight_lock (id TINYINT NOT NULL PRIMARY KEY) ENGINE=InnoDB;
INSERT IGNORE INTO unit1_coil_weight_lock (id) VALUES (1);
CREATE TABLE IF NOT EXISTS unit1_coil_weight_settlements (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 closing_dispatch_id BIGINT UNSIGNED NOT NULL,
 starting_kg DECIMAL(14,3) NOT NULL,
 material_kg DECIMAL(14,3) NOT NULL,
 scrap_kg DECIMAL(14,3) NOT NULL,
 source_snapshot LONGTEXT NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_unit1_weight_closing_dispatch (closing_dispatch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS unit1_coil_weight_members (
 settlement_id BIGINT UNSIGNED NOT NULL,
 coil_id BIGINT UNSIGNED NOT NULL,
 coil_number INT NOT NULL,
 starting_kg DECIMAL(14,3) NOT NULL,
 PRIMARY KEY(coil_id,coil_number),
 KEY idx_unit1_weight_members(settlement_id),
 CONSTRAINT fk_unit1_weight_member_group FOREIGN KEY(settlement_id) REFERENCES unit1_coil_weight_settlements(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS unit1_coil_weight_dispatches (
 dispatch_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
 settlement_id BIGINT UNSIGNED NOT NULL,
 KEY idx_unit1_weight_dispatch_group(settlement_id),
 CONSTRAINT fk_unit1_weight_dispatch_group FOREIGN KEY(settlement_id) REFERENCES unit1_coil_weight_settlements(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS unit1_dispatch_weight_revisions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 dispatch_id BIGINT UNSIGNED DEFAULT NULL,
 settlement_id BIGINT UNSIGNED DEFAULT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 before_data LONGTEXT NOT NULL,
 after_data LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS unit1_material_packed_bundles (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 source_movement_id BIGINT UNSIGNED NOT NULL,
 quantity BIGINT UNSIGNED NOT NULL,
 item_snapshot LONGTEXT NOT NULL,
 request_key VARCHAR(100) CHARACTER SET ascii NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_unit1_packed_request(request_key),
 KEY idx_unit1_packed_source(source_movement_id),
 CONSTRAINT fk_unit1_packed_source FOREIGN KEY(source_movement_id) REFERENCES unit1_material_stock_movements(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS unit1_material_dispatch_bundle_weights (
 dispatch_id BIGINT UNSIGNED NOT NULL,
 bundle_id BIGINT UNSIGNED NOT NULL,
 source_movement_id BIGINT UNSIGNED NOT NULL,
 quantity BIGINT UNSIGNED NOT NULL,
 weight_kg DECIMAL(14,3) NOT NULL,
 item_snapshot LONGTEXT NOT NULL,
 PRIMARY KEY(dispatch_id,bundle_id),
 KEY idx_unit1_bundle_weight_source(source_movement_id),
 CONSTRAINT fk_unit1_bundle_weight_dispatch FOREIGN KEY(dispatch_id) REFERENCES unit1_material_dispatches(id),
 CONSTRAINT fk_unit1_bundle_weight_bundle FOREIGN KEY(bundle_id) REFERENCES unit1_material_packed_bundles(id)
) ENGINE=InnoDB;
