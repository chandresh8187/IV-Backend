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
  `thickness_mm` decimal(10,3) NOT NULL,
  `width_mm` decimal(10,3) NOT NULL,
  `estimated_kg` decimal(12,3) NOT NULL,
  `gross_kg` decimal(12,3) NOT NULL,
  `tare_kg` decimal(12,3) NOT NULL,
  `actual_net_kg` decimal(12,3) NOT NULL,
  `rate_per_kg` decimal(10,2) DEFAULT NULL,
  `quality_status` enum('pending','passed','hold') NOT NULL DEFAULT 'pending',
  `quality_note` text DEFAULT NULL,
  `status` enum('in_stock','allocated','consumed','closed') NOT NULL DEFAULT 'in_stock',
  `received_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
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
  `coil_width_mm` decimal(10,2) NOT NULL,
  `coil_thickness_mm` decimal(8,3) NOT NULL,
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
  `profile` enum('l_flange','r_flange','web','lip') NOT NULL,
  `punch_size` varchar(100) DEFAULT NULL,
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
  PRIMARY KEY (`id`),
  KEY `idx_unit1_hole_checks_run` (`run_id`,`checked_at`),
  CONSTRAINT `fk_unit1_hole_check_run` FOREIGN KEY (`run_id`) REFERENCES `unit1_production_runs` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_production_bundles` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `run_id` bigint(20) unsigned NOT NULL,
  `bundle_no` int(10) unsigned NOT NULL,
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
