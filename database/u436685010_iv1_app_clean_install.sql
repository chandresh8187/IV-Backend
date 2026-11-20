-- Unit 1 app and web: clean-install database
-- Database: u436685010_iv1_app
-- Schema reviewed against Unit 1 routes and migrateUnit1Coils.js on 2026-10-16.
-- MariaDB 10.4+ / MySQL 8.0.16+ syntax. Verified on MariaDB 10.4.32.
-- Import into an EMPTY database.
-- Contains system defaults and the requested bootstrap superadmin; no device tokens or production rows.
-- Create/select the database in your hosting control panel before importing.
-- Optional, only when your database user has CREATE DATABASE permission:
-- CREATE DATABASE IF NOT EXISTS `u436685010_iv1_app` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- This is a fresh-install file, not an upgrade or reset script.

SET NAMES utf8mb4;
SET time_zone = '+05:30';
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
USE `u436685010_iv1_app`;

CREATE TABLE `coils` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `internal_id` varchar(80) NOT NULL,
  `public_code` char(6) DEFAULT NULL,
  `supplier` varchar(160) NOT NULL,
  `vendor_code` varchar(100) DEFAULT NULL,
  `supplier_coil_id` varchar(100) NOT NULL,
  `invoice` varchar(100) DEFAULT NULL,
  `invoice_date` date DEFAULT NULL,
  `tc_number` varchar(100) DEFAULT NULL,
  `grade` varchar(100) NOT NULL,
  `material_type` varchar(20) DEFAULT NULL,
  `coil_qty` int(10) unsigned NOT NULL DEFAULT 1,
  `qr_generated_at` datetime(3) DEFAULT NULL,
  `weight_recorded` tinyint NOT NULL DEFAULT 1,
  `qr_request_key` varchar(100) DEFAULT NULL,
  UNIQUE KEY `uq_coil_qr_request` (`qr_request_key`),
  `thickness_mm` decimal(10,3) NOT NULL,
  `width_mm` decimal(10,3) NOT NULL,
  `estimated_kg` decimal(12,3) DEFAULT NULL,
  `gross_kg` decimal(12,3) DEFAULT NULL,
  `tare_kg` decimal(12,3) DEFAULT NULL,
  `actual_net_kg` decimal(12,3) DEFAULT NULL,
  `rate_per_kg` decimal(10,2) DEFAULT NULL,
  `quality_status` enum('pending','passed','hold') NOT NULL DEFAULT 'pending',
  `quality_note` text DEFAULT NULL,
  `status` enum('in_stock','allocated','consumed','closed') NOT NULL DEFAULT 'in_stock',
  `received_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_coil_public_code` (`public_code`),
  UNIQUE KEY `uq_coils_internal_id` (`internal_id`),
  KEY `idx_coils_supplier` (`supplier`),
  KEY `idx_coils_received_at` (`received_at`),
  CONSTRAINT `chk_coils_weights` CHECK (`gross_kg` > `tare_kg` and `tare_kg` >= 0 and `estimated_kg` > 0),
  CONSTRAINT `chk_coils_dimensions` CHECK (`thickness_mm` > 0 and `width_mm` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_machines` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(30) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_machine_code` (`code`),
  KEY `idx_unit1_machines_active_name` (`is_active`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_material_densities` (
  `material_type` varchar(20) NOT NULL,
  `density_g_cm3` decimal(7,4) NOT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`material_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_material_grades` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `material_type` varchar(20) NOT NULL,
  `grade_value` varchar(100) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_material_grade` (`material_type`,`grade_value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_qr_scan_role_fields` (
  `role` varchar(32) NOT NULL,
  `fields_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`fields_json`)),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_shift_settings` (
  `id` tinyint(3) unsigned NOT NULL,
  `day_start` time NOT NULL,
  `day_end` time NOT NULL,
  `night_start` time NOT NULL,
  `night_end` time NOT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `users` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(120) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('superadmin','production_manager','plant_manager','admin','supervisor','labour') NOT NULL,
  `assigned_shift` enum('Day','Night') DEFAULT NULL,
  `assigned_machine_id` bigint(20) unsigned DEFAULT NULL,
  `status` enum('active','inactive') NOT NULL DEFAULT 'active',
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_users_email` (`email`),
  KEY `idx_unit1_user_assigned_machine` (`assigned_machine_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_fcm_tokens` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint(20) unsigned NOT NULL,
  `installation_id` varchar(100) NOT NULL,
  `fcm_token` varchar(512) NOT NULL,
  `device_type` enum('android','ios') NOT NULL DEFAULT 'android',
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_fcm_installation` (`installation_id`),
  UNIQUE KEY `uq_unit1_fcm_token` (`fcm_token`),
  KEY `idx_unit1_fcm_user` (`user_id`),
  CONSTRAINT `fk_unit1_fcm_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_job_cards` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `job_date` date NOT NULL,
  `customer_name` varchar(150) NOT NULL,
  `project_name_capacity` varchar(180) NOT NULL,
  `production_qty` int(10) unsigned NOT NULL,
  `structure_type` varchar(40) NOT NULL,
  `member_name` varchar(120) NOT NULL,
  `section_size` varchar(100) NOT NULL,
  `shift` enum('day','night') NOT NULL,
  `cut_length_mm` decimal(10,2) NOT NULL,
  `machine_id` bigint(20) unsigned DEFAULT NULL,
  `planned_machine_id` bigint(20) unsigned DEFAULT NULL,
  `material_type` varchar(20) NOT NULL,
  `coil_width_mm` decimal(10,3) NOT NULL,
  `coil_thickness_mm` decimal(8,3) NOT NULL,
  `allowed_coil_sizes` longtext DEFAULT NULL,
  `punch_size` varchar(100) NOT NULL,
  `status` enum('open','completed','cancelled') NOT NULL DEFAULT 'open',
  `archived_at` datetime(3) DEFAULT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_unit1_job_machine_status` (`machine_id`,`status`),
  KEY `idx_unit1_job_planned_machine` (`planned_machine_id`),
  CONSTRAINT `fk_unit1_job_machine` FOREIGN KEY (`machine_id`) REFERENCES `unit1_machines` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `user_permission_overrides` (
  `user_id` bigint(20) unsigned NOT NULL,
  `permission_key` varchar(120) NOT NULL,
  `allowed` tinyint(1) NOT NULL,
  PRIMARY KEY (`user_id`,`permission_key`),
  CONSTRAINT `fk_unit1_permission_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_job_card_holes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `job_card_id` bigint(20) unsigned NOT NULL,
  `sequence_no` int(10) unsigned NOT NULL,
  `profile` enum('l_flange','r_flange','web','lip','beam','w_panel_1','w_panel_2','w_panel_3','w_panel_4','w_panel_5','w_panel_6','w_panel_7','w_panel_8','w_panel_9','l_lip','r_lip') NOT NULL,
  `punch_size` varchar(100) DEFAULT NULL,
  `punch_name` enum('A','B','C','D','E') CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `target_mm` decimal(10,2) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_job_hole_sequence` (`job_card_id`,`sequence_no`),
  CONSTRAINT `fk_unit1_job_hole_job` FOREIGN KEY (`job_card_id`) REFERENCES `unit1_job_cards` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_production_runs` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `machine_id` bigint(20) unsigned NOT NULL,
  `coil_id` bigint(20) unsigned NOT NULL,
  `coil_number` int(10) unsigned NOT NULL,
  `product_type` varchar(40) NOT NULL,
  `status` enum('setup','running','paused','completed','returned') NOT NULL DEFAULT 'setup',
  `produced_pieces` int(10) unsigned NOT NULL DEFAULT 0,
  `run_seconds` int(10) unsigned NOT NULL DEFAULT 0,
  `started_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `last_resumed_at` datetime(3) DEFAULT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `job_card_id` bigint(20) unsigned DEFAULT NULL,
  `hole_checked_at` datetime(3) DEFAULT NULL,
  `hole_checked_by` bigint(20) unsigned DEFAULT NULL,
  `active_coil_number` int(10) unsigned GENERATED ALWAYS AS (case when `status` in ('setup','running','paused') then `coil_number` else NULL end) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_active_coil` (`coil_id`,`active_coil_number`),
  KEY `idx_unit1_run_machine_status` (`machine_id`,`status`),
  KEY `idx_unit1_run_status_started` (`status`,`started_at`),
  KEY `idx_unit1_run_job` (`job_card_id`),
  KEY `idx_unit1_coil_history` (`coil_id`,`coil_number`),
  CONSTRAINT `fk_unit1_run_coil` FOREIGN KEY (`coil_id`) REFERENCES `coils` (`id`),
  CONSTRAINT `fk_unit1_run_job` FOREIGN KEY (`job_card_id`) REFERENCES `unit1_job_cards` (`id`),
  CONSTRAINT `fk_unit1_run_machine` FOREIGN KEY (`machine_id`) REFERENCES `unit1_machines` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_hole_checks` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `run_id` bigint(20) unsigned NOT NULL,
  `check_type` enum('first_piece','recheck') NOT NULL,
  `checked_by` bigint(20) unsigned NOT NULL,
  `checked_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `report_snapshot` longtext DEFAULT NULL,
  `remarks` varchar(1000) DEFAULT NULL,
  `request_key` varchar(80) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_check_request` (`request_key`),
  KEY `idx_unit1_hole_checks_run` (`run_id`,`checked_at`),
  CONSTRAINT `fk_unit1_hole_check_run` FOREIGN KEY (`run_id`) REFERENCES `unit1_production_runs` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_production_bundles` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `run_id` bigint(20) unsigned NOT NULL,
  `bundle_no` int(10) unsigned NOT NULL,
  `job_snapshot` longtext DEFAULT NULL,
  `pieces` int(10) unsigned NOT NULL,
  `theoretical_used_kg` decimal(14,4) DEFAULT NULL,
  `density_g_cm3` decimal(7,4) DEFAULT NULL,
  `hole_scrap_kg` decimal(14,4) DEFAULT NULL,
  `shift` enum('day','night') DEFAULT NULL,
  `shift_date` date DEFAULT NULL,
  `member_name` varchar(120) NOT NULL,
  `entered_by` bigint(20) unsigned NOT NULL,
  `hole_check_id` bigint(20) unsigned DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_bundle_no` (`run_id`,`bundle_no`),
  CONSTRAINT `fk_unit1_bundle_run` FOREIGN KEY (`run_id`) REFERENCES `unit1_production_runs` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_production_events` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `run_id` bigint(20) unsigned NOT NULL,
  `event_type` enum('started','pieces_added','paused','resumed','completed','coil_inserted','hole_checked','bundle_added','coil_returned') NOT NULL,
  `pieces_delta` int(10) unsigned NOT NULL DEFAULT 0,
  `note` varchar(255) DEFAULT NULL,
  `actor_user_id` bigint(20) unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_unit1_events_run_time` (`run_id`,`created_at`),
  CONSTRAINT `fk_unit1_event_run` FOREIGN KEY (`run_id`) REFERENCES `unit1_production_runs` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_run_hole_checks` (
  `run_id` bigint(20) unsigned NOT NULL,
  `job_card_hole_id` bigint(20) unsigned NOT NULL,
  `measured_mm` decimal(10,2) NOT NULL,
  `checked_by` bigint(20) unsigned NOT NULL,
  `checked_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`run_id`,`job_card_hole_id`),
  KEY `fk_unit1_check_hole` (`job_card_hole_id`),
  CONSTRAINT `fk_unit1_check_hole` FOREIGN KEY (`job_card_hole_id`) REFERENCES `unit1_job_card_holes` (`id`),
  CONSTRAINT `fk_unit1_check_run` FOREIGN KEY (`run_id`) REFERENCES `unit1_production_runs` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_hole_check_measurements` (
  `check_id` bigint(20) unsigned NOT NULL,
  `job_card_hole_id` bigint(20) unsigned NOT NULL,
  `measured_mm` decimal(10,2) NOT NULL,
  PRIMARY KEY (`check_id`,`job_card_hole_id`),
  KEY `fk_unit1_measurement_hole` (`job_card_hole_id`),
  CONSTRAINT `fk_unit1_measurement_check` FOREIGN KEY (`check_id`) REFERENCES `unit1_hole_checks` (`id`),
  CONSTRAINT `fk_unit1_measurement_hole` FOREIGN KEY (`job_card_hole_id`) REFERENCES `unit1_job_card_holes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Required system defaults. GP grades are numeric GSM values validated in application code.
INSERT INTO `unit1_material_densities` (`material_type`, `density_g_cm3`) VALUES
('GL', 7.85),
('GP', 7.85),
('MS', 7.85),
('Posmac', 7.85);

INSERT INTO `unit1_material_grades` (`material_type`, `grade_value`) VALUES
('GL', '550 MPA'),
('MS', 'E250'),
('MS', 'E350'),
('MS', 'Normal'),
('Posmac', '550 MPA');

INSERT INTO `unit1_shift_settings` (`id`, `day_start`, `day_end`, `night_start`, `night_end`) VALUES
(1, '08:00:00', '20:00:00', '20:00:00', '08:00:00');

-- Requested bootstrap account: dev@iv.com / 12345678 (bcrypt hash stored below).
-- Change this bootstrap password after initial setup.
INSERT INTO `users` (`name`, `email`, `password`, `role`, `status`) VALUES
('IV Developer', 'dev@iv.com', '$2b$12$s1gYuzr8mIY0yusK1uQYs.Wy1GhHhnypViS14NIbUFkTtQHMbG.Lq', 'superadmin', 'active');

-- Role permissions and default QR fields are resolved by the backend when no overrides exist.
-- After import, set UNIT1_DB_NAME=u436685010_iv1_app in the backend environment.
-- Sign in using the bootstrap account above.

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
 starting_kg DECIMAL(14,3) DEFAULT NULL,
 material_kg DECIMAL(14,3) NOT NULL,
 scrap_kg DECIMAL(14,3) DEFAULT NULL,
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
 starting_kg DECIMAL(14,3) DEFAULT NULL,
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


CREATE TABLE IF NOT EXISTS unit1_job_card_revisions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 job_card_id BIGINT UNSIGNED NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL,
 before_data LONGTEXT NOT NULL,
 after_data LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_unit1_job_revisions (job_card_id,created_at),
 CONSTRAINT fk_unit1_revision_job FOREIGN KEY (job_card_id) REFERENCES unit1_job_cards(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS unit1_coil_identifiers (
 code INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 batch_id BIGINT UNSIGNED NOT NULL,
 coil_number INT UNSIGNED NULL,
 UNIQUE KEY uq_unit1_physical_coil (batch_id,coil_number)
) ENGINE=InnoDB AUTO_INCREMENT=100000 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS unit1_coil_revisions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 coil_id BIGINT UNSIGNED NOT NULL,actor_user_id BIGINT UNSIGNED NOT NULL,
 before_data LONGTEXT NOT NULL,after_data LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 KEY idx_unit1_coil_revisions(coil_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS unit1_maintenance_lock (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB;
INSERT IGNORE INTO unit1_maintenance_lock (id) VALUES (1);
CREATE TABLE IF NOT EXISTS unit1_maintenance_plans (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 machine_id BIGINT UNSIGNED NOT NULL, title VARCHAR(150) NOT NULL,
 interval_days INT NOT NULL, first_due_date DATE NOT NULL, remind_before_days INT NOT NULL DEFAULT 3,
 priority VARCHAR(15) NOT NULL DEFAULT 'normal', instructions TEXT, is_active TINYINT NOT NULL DEFAULT 1,
 version INT NOT NULL DEFAULT 1, request_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 original_input LONGTEXT NOT NULL, created_by BIGINT UNSIGNED NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 FOREIGN KEY (machine_id) REFERENCES unit1_machines(id), INDEX (machine_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS unit1_maintenance_records (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 machine_id BIGINT UNSIGNED NOT NULL, plan_id BIGINT UNSIGNED DEFAULT NULL,
 service_date DATE NOT NULL, maintenance_type VARCHAR(20) NOT NULL, technician VARCHAR(150) NOT NULL,
 work_done TEXT NOT NULL, parts_used TEXT, cost DECIMAL(14,2) DEFAULT NULL, downtime_minutes INT DEFAULT NULL, notes TEXT,
 version INT NOT NULL DEFAULT 1, request_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 original_input LONGTEXT NOT NULL, created_by BIGINT UNSIGNED NOT NULL,
 voided_at DATETIME(3) DEFAULT NULL, void_reason TEXT,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 FOREIGN KEY (machine_id) REFERENCES unit1_machines(id), FOREIGN KEY (plan_id) REFERENCES unit1_maintenance_plans(id), INDEX (plan_id,voided_at,service_date), INDEX (service_date,machine_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS unit1_maintenance_revisions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, entity_type VARCHAR(15) NOT NULL, entity_id BIGINT UNSIGNED NOT NULL,
 actor_user_id BIGINT UNSIGNED NOT NULL, reason TEXT NOT NULL, before_data LONGTEXT, after_data LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX(entity_type,entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS unit1_maintenance_reminders (
 user_id BIGINT UNSIGNED NOT NULL, reminder_date DATE NOT NULL, state VARCHAR(12) NOT NULL,
 attempts INT NOT NULL DEFAULT 1, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id,reminder_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- Material templates and multi-material production planning.
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

CREATE TABLE IF NOT EXISTS unit1_qr_workflow_revisions (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 entity_type VARCHAR(20) NOT NULL, entity_id BIGINT UNSIGNED NOT NULL,
 before_data LONGTEXT NOT NULL, after_data LONGTEXT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 UNIQUE KEY uq_qr_size_migration(entity_type,entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



CREATE TABLE `unit1_punch_name_revisions` (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,entity_type VARCHAR(20) NOT NULL,entity_id BIGINT UNSIGNED NOT NULL,before_data LONGTEXT NOT NULL,after_data LONGTEXT NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY uq_punch_name_backfill(entity_type,entity_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
