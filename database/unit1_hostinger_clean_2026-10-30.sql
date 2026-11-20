-- UNIT 1 - Clean Hostinger install - 30 October 2026 (India)
-- Select your EMPTY Unit 1 database in phpMyAdmin, then import this file.
-- Target live database: u436685010_iv1_app (create/select it in Hostinger first).
-- No CREATE DATABASE or DROP statements; import into an empty database.
-- Includes current schema, machine master list, grades, densities and required settings.
-- Only account: dev@iv.com / active Superadmin. Its existing local password is unchanged.
-- Password is stored as a bcrypt hash; this file does not contain a plaintext password.
-- No coils, planning, production, inspections, rejected stock, dispatch, maintenance or work-task entries.
-- Use the matching current backend/app/web versions after import.
SET NAMES utf8mb4;
SET time_zone = '+05:30';
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';
SET FOREIGN_KEY_CHECKS = 0;
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
  `weight_recorded` tinyint(4) NOT NULL DEFAULT 1,
  `qr_request_key` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_coils_internal_id` (`internal_id`),
  UNIQUE KEY `uq_unit1_coil_public_code` (`public_code`),
  UNIQUE KEY `uq_coil_qr_request` (`qr_request_key`),
  KEY `idx_coils_supplier` (`supplier`),
  KEY `idx_coils_received_at` (`received_at`),
  CONSTRAINT `chk_coils_weights` CHECK (`gross_kg` > `tare_kg` and `tare_kg` >= 0 and `estimated_kg` > 0),
  CONSTRAINT `chk_coils_dimensions` CHECK (`thickness_mm` > 0 and `width_mm` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_coil_identifiers` (
  `code` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `batch_id` bigint(20) unsigned NOT NULL,
  `coil_number` int(10) unsigned DEFAULT NULL,
  PRIMARY KEY (`code`),
  UNIQUE KEY `uq_unit1_physical_coil` (`batch_id`,`coil_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_coil_revisions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `coil_id` bigint(20) unsigned NOT NULL,
  `actor_user_id` bigint(20) unsigned NOT NULL,
  `before_data` longtext NOT NULL,
  `after_data` longtext NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_unit1_coil_revisions` (`coil_id`,`created_at`),
  CONSTRAINT `fk_unit1_revision_coil` FOREIGN KEY (`coil_id`) REFERENCES `coils` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_coil_weight_dispatches` (
  `dispatch_id` bigint(20) unsigned NOT NULL,
  `settlement_id` bigint(20) unsigned NOT NULL,
  PRIMARY KEY (`dispatch_id`),
  KEY `idx_unit1_weight_dispatch_group` (`settlement_id`),
  CONSTRAINT `fk_unit1_weight_dispatch_group` FOREIGN KEY (`settlement_id`) REFERENCES `unit1_coil_weight_settlements` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_coil_weight_lock` (
  `id` tinyint(4) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `unit1_coil_weight_lock` (`id`) VALUES (1);

CREATE TABLE `unit1_coil_weight_members` (
  `settlement_id` bigint(20) unsigned NOT NULL,
  `coil_id` bigint(20) unsigned NOT NULL,
  `coil_number` int(11) NOT NULL,
  `starting_kg` decimal(14,3) DEFAULT NULL,
  PRIMARY KEY (`coil_id`,`coil_number`),
  KEY `idx_unit1_weight_members` (`settlement_id`),
  CONSTRAINT `fk_unit1_weight_member_group` FOREIGN KEY (`settlement_id`) REFERENCES `unit1_coil_weight_settlements` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_coil_weight_settlements` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `closing_dispatch_id` bigint(20) unsigned NOT NULL,
  `starting_kg` decimal(14,3) DEFAULT NULL,
  `material_kg` decimal(14,3) NOT NULL,
  `scrap_kg` decimal(14,3) DEFAULT NULL,
  `source_snapshot` longtext NOT NULL,
  `actor_user_id` bigint(20) unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_weight_closing_dispatch` (`closing_dispatch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_dispatch_weight_revisions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `dispatch_id` bigint(20) unsigned DEFAULT NULL,
  `settlement_id` bigint(20) unsigned DEFAULT NULL,
  `actor_user_id` bigint(20) unsigned NOT NULL,
  `before_data` longtext NOT NULL,
  `after_data` longtext NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`)
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

CREATE TABLE `unit1_hole_check_measurements` (
  `check_id` bigint(20) unsigned NOT NULL,
  `job_card_hole_id` bigint(20) unsigned NOT NULL,
  `measured_mm` decimal(10,2) NOT NULL,
  PRIMARY KEY (`check_id`,`job_card_hole_id`),
  KEY `fk_unit1_measurement_hole` (`job_card_hole_id`),
  CONSTRAINT `fk_unit1_measurement_check` FOREIGN KEY (`check_id`) REFERENCES `unit1_hole_checks` (`id`),
  CONSTRAINT `fk_unit1_measurement_hole` FOREIGN KEY (`job_card_hole_id`) REFERENCES `unit1_job_card_holes` (`id`)
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
  `punch_size` varchar(100) NOT NULL,
  `status` enum('open','completed','cancelled') NOT NULL DEFAULT 'open',
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  `archived_at` datetime(3) DEFAULT NULL,
  `allowed_coil_sizes` longtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_unit1_job_machine_status` (`machine_id`,`status`),
  KEY `idx_unit1_job_planned_machine` (`planned_machine_id`),
  CONSTRAINT `fk_unit1_job_machine` FOREIGN KEY (`machine_id`) REFERENCES `unit1_machines` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_job_card_coils` (
  `job_card_id` bigint(20) unsigned NOT NULL,
  `coil_id` bigint(20) unsigned NOT NULL,
  `coil_number` int(10) unsigned NOT NULL,
  PRIMARY KEY (`job_card_id`,`coil_id`,`coil_number`),
  KEY `idx_unit1_selected_coil` (`coil_id`,`coil_number`),
  CONSTRAINT `fk_unit1_selected_coil` FOREIGN KEY (`coil_id`) REFERENCES `coils` (`id`),
  CONSTRAINT `fk_unit1_selected_job` FOREIGN KEY (`job_card_id`) REFERENCES `unit1_job_cards` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_job_card_holes` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `job_card_id` bigint(20) unsigned NOT NULL,
  `sequence_no` int(10) unsigned NOT NULL,
  `profile` enum('l_flange','r_flange','web','lip','beam') NOT NULL,
  `punch_size` varchar(100) DEFAULT NULL,
  `punch_name` enum('A','B','C','D','E') CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `target_mm` decimal(10,2) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_job_hole_sequence` (`job_card_id`,`sequence_no`),
  CONSTRAINT `fk_unit1_job_hole_job` FOREIGN KEY (`job_card_id`) REFERENCES `unit1_job_cards` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_job_card_revisions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `job_card_id` bigint(20) unsigned NOT NULL,
  `actor_user_id` bigint(20) unsigned NOT NULL,
  `before_data` longtext NOT NULL,
  `after_data` longtext NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_unit1_job_revisions` (`job_card_id`,`created_at`),
  CONSTRAINT `fk_unit1_revision_job` FOREIGN KEY (`job_card_id`) REFERENCES `unit1_job_cards` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_job_coil_revisions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `job_card_id` bigint(20) unsigned NOT NULL,
  `actor_user_id` bigint(20) unsigned NOT NULL,
  `before_data` longtext NOT NULL,
  `after_data` longtext NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_unit1_job_coil_audit` (`job_card_id`,`created_at`)
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

INSERT INTO `unit1_machines` (`id`,`code`,`name`,`description`,`is_active`,`created_at`,`updated_at`) VALUES ('1','M1','M1 Machine','W BEAM',1,'2026-10-12 14:22:56.537','2026-10-15 17:30:56.826');

INSERT INTO `unit1_machines` (`id`,`code`,`name`,`description`,`is_active`,`created_at`,`updated_at`) VALUES ('2','M2','M2 Machine','HAT PURLIN',1,'2026-10-15 17:30:50.271','2026-10-15 17:30:50.271');

INSERT INTO `unit1_machines` (`id`,`code`,`name`,`description`,`is_active`,`created_at`,`updated_at`) VALUES ('3','M3','M3 Machine','SOLAR MOUNTING STRUCTURE',1,'2026-10-15 17:31:22.504','2026-10-15 17:31:22.504');

INSERT INTO `unit1_machines` (`id`,`code`,`name`,`description`,`is_active`,`created_at`,`updated_at`) VALUES ('4','M4','M4 Machine','SOLAR MOUNTING STRUCTURE',1,'2026-10-15 17:32:14.151','2026-10-15 17:32:14.151');

INSERT INTO `unit1_machines` (`id`,`code`,`name`,`description`,`is_active`,`created_at`,`updated_at`) VALUES ('5','M5','M5 Machine','SOLAR MOUNTING STRUCTURE',1,'2026-10-15 17:32:37.521','2026-10-15 17:32:37.521');

INSERT INTO `unit1_machines` (`id`,`code`,`name`,`description`,`is_active`,`created_at`,`updated_at`) VALUES ('6','M6','M6 Machine','C CHANNLE POST',1,'2026-10-15 17:32:58.561','2026-10-15 17:32:58.561');

CREATE TABLE `unit1_maintenance_lock` (
  `id` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `unit1_maintenance_lock` (`id`) VALUES (1);

CREATE TABLE `unit1_maintenance_plans` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `machine_id` bigint(20) unsigned NOT NULL,
  `title` varchar(150) NOT NULL,
  `interval_days` int(11) NOT NULL,
  `first_due_date` date NOT NULL,
  `remind_before_days` int(11) NOT NULL DEFAULT 3,
  `priority` varchar(15) NOT NULL DEFAULT 'normal',
  `instructions` text DEFAULT NULL,
  `is_active` tinyint(4) NOT NULL DEFAULT 1,
  `version` int(11) NOT NULL DEFAULT 1,
  `request_key` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `original_input` longtext NOT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `request_key` (`request_key`),
  KEY `machine_id` (`machine_id`),
  CONSTRAINT `unit1_maintenance_plans_ibfk_1` FOREIGN KEY (`machine_id`) REFERENCES `unit1_machines` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_maintenance_records` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `machine_id` bigint(20) unsigned NOT NULL,
  `plan_id` bigint(20) unsigned DEFAULT NULL,
  `service_date` date NOT NULL,
  `maintenance_type` varchar(20) NOT NULL,
  `technician` varchar(150) NOT NULL,
  `work_done` text NOT NULL,
  `parts_used` text DEFAULT NULL,
  `cost` decimal(14,2) DEFAULT NULL,
  `downtime_minutes` int(11) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `version` int(11) NOT NULL DEFAULT 1,
  `request_key` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `original_input` longtext NOT NULL,
  `created_by` bigint(20) unsigned NOT NULL,
  `voided_at` datetime(3) DEFAULT NULL,
  `void_reason` text DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `request_key` (`request_key`),
  KEY `machine_id` (`machine_id`),
  KEY `plan_id` (`plan_id`,`voided_at`,`service_date`),
  KEY `service_date` (`service_date`,`machine_id`),
  CONSTRAINT `unit1_maintenance_records_ibfk_1` FOREIGN KEY (`machine_id`) REFERENCES `unit1_machines` (`id`),
  CONSTRAINT `unit1_maintenance_records_ibfk_2` FOREIGN KEY (`plan_id`) REFERENCES `unit1_maintenance_plans` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_maintenance_reminders` (
  `user_id` bigint(20) unsigned NOT NULL,
  `reminder_date` date NOT NULL,
  `state` varchar(12) NOT NULL,
  `attempts` int(11) NOT NULL DEFAULT 1,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`,`reminder_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_maintenance_revisions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `entity_type` varchar(15) NOT NULL,
  `entity_id` bigint(20) unsigned NOT NULL,
  `actor_user_id` bigint(20) unsigned NOT NULL,
  `reason` text NOT NULL,
  `before_data` longtext DEFAULT NULL,
  `after_data` longtext NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `entity_type` (`entity_type`,`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_maintenance_sessions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `machine_id` bigint(20) unsigned NOT NULL,
  `active_machine_id` bigint(20) unsigned DEFAULT NULL,
  `plan_id` bigint(20) unsigned DEFAULT NULL,
  `record_id` bigint(20) unsigned DEFAULT NULL,
  `started_at` datetime(3) NOT NULL,
  `ended_at` datetime(3) DEFAULT NULL,
  `duration_seconds` bigint(20) unsigned DEFAULT NULL,
  `started_by` bigint(20) unsigned NOT NULL,
  `completed_by` bigint(20) unsigned DEFAULT NULL,
  `request_key` varchar(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `original_input` longtext NOT NULL,
  `completed_input` longtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_maintenance_request` (`request_key`),
  UNIQUE KEY `uq_unit1_maintenance_active` (`active_machine_id`),
  UNIQUE KEY `uq_unit1_maintenance_record` (`record_id`),
  KEY `plan_id` (`plan_id`),
  KEY `machine_id` (`machine_id`,`started_at`),
  CONSTRAINT `unit1_maintenance_sessions_ibfk_1` FOREIGN KEY (`machine_id`) REFERENCES `unit1_machines` (`id`),
  CONSTRAINT `unit1_maintenance_sessions_ibfk_2` FOREIGN KEY (`active_machine_id`) REFERENCES `unit1_machines` (`id`),
  CONSTRAINT `unit1_maintenance_sessions_ibfk_3` FOREIGN KEY (`plan_id`) REFERENCES `unit1_maintenance_plans` (`id`),
  CONSTRAINT `unit1_maintenance_sessions_ibfk_4` FOREIGN KEY (`record_id`) REFERENCES `unit1_maintenance_records` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_material_densities` (
  `material_type` varchar(20) NOT NULL,
  `density_g_cm3` decimal(7,4) NOT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`material_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `unit1_material_densities` (`material_type`,`density_g_cm3`,`updated_at`) VALUES ('GL','7.8500','2026-10-15 10:27:22.151');

INSERT INTO `unit1_material_densities` (`material_type`,`density_g_cm3`,`updated_at`) VALUES ('GP','7.8500','2026-10-15 10:27:22.151');

INSERT INTO `unit1_material_densities` (`material_type`,`density_g_cm3`,`updated_at`) VALUES ('MS','7.8600','2026-10-29 17:20:31.638');

INSERT INTO `unit1_material_densities` (`material_type`,`density_g_cm3`,`updated_at`) VALUES ('Posmac','7.8500','2026-10-15 10:27:22.152');

CREATE TABLE `unit1_material_dispatches` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `item_id` bigint(20) unsigned NOT NULL,
  `quantity` bigint(20) unsigned NOT NULL,
  `destination` varchar(12) NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `request_key` varchar(100) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `actor_user_id` bigint(20) unsigned NOT NULL,
  `item_snapshot` longtext NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `weighbridge_weight_kg` decimal(14,3) DEFAULT NULL,
  `weighed_at` datetime(3) DEFAULT NULL,
  `weighed_by` bigint(20) unsigned DEFAULT NULL,
  `finish_requested` tinyint(4) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_dispatch_request` (`request_key`),
  KEY `idx_unit1_dispatch_date` (`created_at`,`id`),
  KEY `fk_unit1_dispatch_item` (`item_id`),
  CONSTRAINT `fk_unit1_dispatch_item` FOREIGN KEY (`item_id`) REFERENCES `unit1_material_stock_items` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_material_dispatch_allocations` (
  `dispatch_id` bigint(20) unsigned NOT NULL,
  `source_movement_id` bigint(20) unsigned NOT NULL,
  `quantity` bigint(20) unsigned NOT NULL,
  PRIMARY KEY (`dispatch_id`,`source_movement_id`),
  KEY `idx_unit1_dispatch_source` (`source_movement_id`),
  CONSTRAINT `fk_unit1_dispatch_allocation` FOREIGN KEY (`dispatch_id`) REFERENCES `unit1_material_dispatches` (`id`),
  CONSTRAINT `fk_unit1_dispatch_movement` FOREIGN KEY (`source_movement_id`) REFERENCES `unit1_material_stock_movements` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_material_dispatch_bundle_weights` (
  `dispatch_id` bigint(20) unsigned NOT NULL,
  `bundle_id` bigint(20) unsigned NOT NULL,
  `source_movement_id` bigint(20) unsigned NOT NULL,
  `quantity` bigint(20) unsigned NOT NULL,
  `weight_kg` decimal(14,3) NOT NULL,
  `item_snapshot` longtext NOT NULL,
  PRIMARY KEY (`dispatch_id`,`bundle_id`),
  KEY `idx_unit1_bundle_weight_source` (`source_movement_id`),
  KEY `fk_unit1_bundle_weight_bundle` (`bundle_id`),
  CONSTRAINT `fk_unit1_bundle_weight_bundle` FOREIGN KEY (`bundle_id`) REFERENCES `unit1_material_packed_bundles` (`id`),
  CONSTRAINT `fk_unit1_bundle_weight_dispatch` FOREIGN KEY (`dispatch_id`) REFERENCES `unit1_material_dispatches` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_material_grades` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `material_type` varchar(20) NOT NULL,
  `grade_value` varchar(100) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_material_grade` (`material_type`,`grade_value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `unit1_material_grades` (`id`,`material_type`,`grade_value`,`created_at`) VALUES ('1','MS','Normal','2026-10-08 16:24:44.143');

INSERT INTO `unit1_material_grades` (`id`,`material_type`,`grade_value`,`created_at`) VALUES ('2','MS','E250','2026-10-08 16:24:44.143');

INSERT INTO `unit1_material_grades` (`id`,`material_type`,`grade_value`,`created_at`) VALUES ('3','MS','E350','2026-10-08 16:24:44.143');

INSERT INTO `unit1_material_grades` (`id`,`material_type`,`grade_value`,`created_at`) VALUES ('4','GL','550 MPA','2026-10-08 16:24:44.143');

INSERT INTO `unit1_material_grades` (`id`,`material_type`,`grade_value`,`created_at`) VALUES ('5','Posmac','550 MPA','2026-10-08 16:24:44.143');

CREATE TABLE `unit1_material_packed_bundles` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `source_movement_id` bigint(20) unsigned NOT NULL,
  `quantity` bigint(20) unsigned NOT NULL,
  `item_snapshot` longtext NOT NULL,
  `request_key` varchar(100) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `actor_user_id` bigint(20) unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_packed_request` (`request_key`),
  KEY `idx_unit1_packed_source` (`source_movement_id`),
  CONSTRAINT `fk_unit1_packed_source` FOREIGN KEY (`source_movement_id`) REFERENCES `unit1_material_stock_movements` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_material_party_codes` (
  `party_key` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `party_code` char(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`party_key`),
  UNIQUE KEY `uq_unit1_material_party_code` (`party_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_material_stock_items` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `stock_key` char(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `customer_name` varchar(150) NOT NULL DEFAULT '',
  `member_name` varchar(120) NOT NULL,
  `section_size` varchar(100) NOT NULL,
  `length_mm` decimal(12,3) NOT NULL,
  `material_type` varchar(20) NOT NULL,
  `grade` varchar(100) NOT NULL,
  `thickness_mm` decimal(10,3) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_material_stock_identity` (`stock_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_material_stock_migrations` (
  `version` varchar(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  `completed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `unit1_material_stock_migrations` (`version`,`completed_at`) VALUES ('customer-dispatch-v1','2026-10-26 15:31:45.596');

CREATE TABLE `unit1_material_stock_movements` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `item_id` bigint(20) unsigned NOT NULL,
  `movement_type` varchar(24) NOT NULL,
  `quantity` bigint(20) NOT NULL,
  `request_key` varchar(100) CHARACTER SET ascii COLLATE ascii_general_ci DEFAULT NULL,
  `source_bundle_id` bigint(20) unsigned DEFAULT NULL,
  `source_run_id` bigint(20) unsigned DEFAULT NULL,
  `source_job_card_id` bigint(20) unsigned DEFAULT NULL,
  `transfer_reference` varchar(100) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `actor_user_id` bigint(20) unsigned DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_material_stock_bundle` (`source_bundle_id`),
  UNIQUE KEY `uq_unit1_material_stock_request` (`request_key`),
  KEY `idx_unit1_material_stock_history` (`item_id`,`created_at`,`id`),
  CONSTRAINT `fk_unit1_material_stock_item` FOREIGN KEY (`item_id`) REFERENCES `unit1_material_stock_items` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_material_stock_revisions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `movement_id` bigint(20) unsigned NOT NULL,
  `before_item_id` bigint(20) unsigned NOT NULL,
  `after_item_id` bigint(20) unsigned NOT NULL,
  `reason` varchar(100) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_material_templates` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(180) NOT NULL,
  `specification` longtext NOT NULL,
  `version` int(10) unsigned NOT NULL DEFAULT 1,
  `source_job_card_id` bigint(20) unsigned DEFAULT NULL,
  `created_by` bigint(20) unsigned DEFAULT NULL,
  `archived_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_template_legacy_source` (`source_job_card_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_planning_lock` (
  `id` tinyint(3) unsigned NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `unit1_planning_lock` (`id`) VALUES (1);

CREATE TABLE `unit1_planning_revisions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `entity_type` varchar(20) NOT NULL,
  `entity_id` bigint(20) unsigned NOT NULL,
  `actor_user_id` bigint(20) unsigned DEFAULT NULL,
  `before_data` longtext DEFAULT NULL,
  `after_data` longtext NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_planning_audit` (`entity_type`,`entity_id`)
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
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `hole_check_id` bigint(20) unsigned DEFAULT NULL,
  `job_snapshot` longtext DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_unit1_bundle_no` (`run_id`,`bundle_no`),
  KEY `idx_unit1_bundle_check` (`hole_check_id`),
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

CREATE TABLE `unit1_production_plans` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `party_name` varchar(150) NOT NULL,
  `project_name` varchar(180) NOT NULL DEFAULT '',
  `plan_date` date NOT NULL,
  `shift` enum('day','night') NOT NULL,
  `version` int(10) unsigned NOT NULL DEFAULT 1,
  `request_key` varchar(100) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `original_input` longtext NOT NULL,
  `created_by` bigint(20) unsigned DEFAULT NULL,
  `archived_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_plan_request` (`request_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_production_plan_lines` (
  `job_card_id` bigint(20) unsigned NOT NULL,
  `plan_id` bigint(20) unsigned NOT NULL,
  `template_id` bigint(20) unsigned NOT NULL,
  `template_version` int(10) unsigned NOT NULL,
  `original_input` longtext NOT NULL,
  PRIMARY KEY (`job_card_id`),
  KEY `idx_plan_lines` (`plan_id`),
  KEY `idx_template_lines` (`template_id`),
  CONSTRAINT `unit1_production_plan_lines_ibfk_1` FOREIGN KEY (`job_card_id`) REFERENCES `unit1_job_cards` (`id`),
  CONSTRAINT `unit1_production_plan_lines_ibfk_2` FOREIGN KEY (`plan_id`) REFERENCES `unit1_production_plans` (`id`),
  CONSTRAINT `unit1_production_plan_lines_ibfk_3` FOREIGN KEY (`template_id`) REFERENCES `unit1_material_templates` (`id`)
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

CREATE TABLE `unit1_qr_scan_role_fields` (
  `role` varchar(32) NOT NULL,
  `fields_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`fields_json`)),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_qr_workflow_revisions` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `entity_type` varchar(20) NOT NULL,
  `entity_id` bigint(20) unsigned NOT NULL,
  `before_data` longtext NOT NULL,
  `after_data` longtext NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_qr_size_migration` (`entity_type`,`entity_id`)
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

CREATE TABLE `unit1_shift_settings` (
  `id` tinyint(3) unsigned NOT NULL,
  `day_start` time NOT NULL,
  `day_end` time NOT NULL,
  `night_start` time NOT NULL,
  `night_end` time NOT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `unit1_shift_settings` (`id`,`day_start`,`day_end`,`night_start`,`night_end`,`updated_at`) VALUES (1,'08:00:00','20:00:00','20:00:00','08:00:00','2026-10-12 09:52:04.938');

CREATE TABLE `unit1_work_tasks` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(160) NOT NULL,
  `description` text NOT NULL,
  `assignee_id` bigint(20) unsigned NOT NULL,
  `assigned_by` bigint(20) unsigned NOT NULL,
  `machine_id` bigint(20) unsigned DEFAULT NULL,
  `job_card_id` bigint(20) unsigned DEFAULT NULL,
  `priority` enum('normal','high','urgent') NOT NULL DEFAULT 'normal',
  `due_date` date DEFAULT NULL,
  `status` enum('assigned','in_progress','blocked','submitted','completed','cancelled') NOT NULL DEFAULT 'assigned',
  `version` int(10) unsigned NOT NULL DEFAULT 1,
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  `updated_at` datetime(3) NOT NULL DEFAULT current_timestamp(3) ON UPDATE current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_unit1_tasks_assignee` (`assignee_id`,`status`,`due_date`,`id`),
  KEY `idx_unit1_tasks_status` (`status`,`due_date`,`id`),
  KEY `idx_unit1_tasks_job` (`job_card_id`),
  KEY `idx_unit1_tasks_machine` (`machine_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unit1_work_task_events` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `task_id` bigint(20) unsigned NOT NULL,
  `actor_id` bigint(20) unsigned NOT NULL,
  `action` varchar(30) NOT NULL,
  `note` text NOT NULL,
  `before_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`before_snapshot`)),
  `after_snapshot` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`after_snapshot`)),
  `created_at` datetime(3) NOT NULL DEFAULT current_timestamp(3),
  PRIMARY KEY (`id`),
  KEY `idx_unit1_task_events` (`task_id`,`id`),
  CONSTRAINT `fk_unit1_task_event_task` FOREIGN KEY (`task_id`) REFERENCES `unit1_work_tasks` (`id`)
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

INSERT INTO `users` (`id`,`name`,`email`,`password`,`role`,`assigned_shift`,`assigned_machine_id`,`status`,`created_at`,`updated_at`) VALUES ('1','developer','dev@iv.com','$2b$12$HqFXkXubVxqezW0Di/F.Yu3zpruNUnN0B544F3j0ArlBcZrp89MqW','superadmin',NULL,NULL,'active','2026-10-09 15:40:29.408','2026-10-09 15:40:29.408');

CREATE TABLE `user_permission_overrides` (
  `user_id` bigint(20) unsigned NOT NULL,
  `permission_key` varchar(120) NOT NULL,
  `allowed` tinyint(1) NOT NULL,
  PRIMARY KEY (`user_id`,`permission_key`),
  CONSTRAINT `fk_unit1_permission_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE `unit1_punch_name_revisions` (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,entity_type VARCHAR(20) NOT NULL,entity_id BIGINT UNSIGNED NOT NULL,before_data LONGTEXT NOT NULL,after_data LONGTEXT NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY uq_punch_name_backfill(entity_type,entity_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
