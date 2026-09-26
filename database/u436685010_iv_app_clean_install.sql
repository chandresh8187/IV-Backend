-- IV Square Structure production management database
-- Clean-install schema for MariaDB 10.5+ / MySQL 8.0+
-- Generated from the backend queries and every versioned migration on 2026-09-26.
--
-- IMPORTANT: Import this file into an EMPTY database named
-- u436685010_iv_app. It contains only required system defaults and one
-- bcrypt-protected bootstrap superadmin; it contains no plant production data.

SET NAMES utf8mb4;
SET time_zone = '+05:30';
SET SQL_MODE = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

USE `u436685010_iv_app`;

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(190) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `role` ENUM('superadmin','plant_manager','admin','supervisor','labour') NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_by` INT NULL,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `assigned_shift` ENUM('day','night','both') NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_role_status` (`role`,`status`),
  KEY `idx_users_created_by` (`created_by`),
  CONSTRAINT `fk_users_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_permission_overrides` (
  `user_id` INT NOT NULL,
  `permission_key` VARCHAR(100) NOT NULL,
  `allowed` TINYINT(1) NOT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`,`permission_key`),
  CONSTRAINT `fk_permission_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `labour_weight_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `labour_user_id` INT NOT NULL,
  `ms_weight` DECIMAL(12,3) NOT NULL,
  `dipping_qty` INT UNSIGNED NOT NULL,
  `status` ENUM('pending','used') NOT NULL DEFAULT 'pending',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_labour_weight_queue` (`status`,`id`),
  KEY `idx_labour_weight_user` (`labour_user_id`),
  CONSTRAINT `fk_labour_weight_user` FOREIGN KEY (`labour_user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `app_settings` (
  `setting_key` VARCHAR(100) NOT NULL,
  `setting_value` JSON NOT NULL,
  `updated_by` INT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`),
  KEY `idx_app_settings_updated_by` (`updated_by`),
  CONSTRAINT `fk_app_settings_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `app_update_releases` (
  `platform` VARCHAR(30) NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `latest_version_code` INT NOT NULL DEFAULT 0,
  `latest_version_name` VARCHAR(50) NOT NULL DEFAULT '',
  `minimum_version_code` INT NOT NULL DEFAULT 0,
  `mandatory` TINYINT(1) NOT NULL DEFAULT 0,
  `apk_url` TEXT NULL,
  `sha256` CHAR(64) NULL,
  `release_notes` TEXT NULL,
  `updated_by` INT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`platform`),
  KEY `idx_app_release_user` (`updated_by`),
  CONSTRAINT `fk_app_release_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_user_id` INT NULL,
  `action` VARCHAR(100) NOT NULL,
  `entity_type` VARCHAR(100) NOT NULL,
  `entity_id` VARCHAR(191) NULL,
  `metadata` JSON NULL,
  `ip_address` VARCHAR(64) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_created_at` (`created_at`),
  KEY `idx_audit_actor` (`actor_user_id`),
  CONSTRAINT `fk_audit_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_fcm_tokens` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `sender_name` VARCHAR(80) NULL,
  `installation_id` VARCHAR(100) NULL,
  `fcm_token` VARCHAR(512) NOT NULL,
  `device_type` VARCHAR(30) NOT NULL DEFAULT 'android',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fcm_token` (`fcm_token`),
  UNIQUE KEY `uq_fcm_installation` (`installation_id`),
  KEY `idx_fcm_user` (`user_id`),
  CONSTRAINT `fk_fcm_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notification_logs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `type` VARCHAR(100) NOT NULL,
  `reference_key` VARCHAR(191) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `body` TEXT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notification_reference` (`type`,`reference_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `plant_status` (
  `id` TINYINT UNSIGNED NOT NULL,
  `status` ENUM('running','maintenance','stopped') NOT NULL DEFAULT 'running',
  `title` VARCHAR(200) NULL,
  `message` VARCHAR(1000) NULL,
  `started_at` DATETIME NULL,
  `expected_restart_at` DATETIME NULL,
  `updated_by` INT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_plant_status_user` (`updated_by`),
  CONSTRAINT `fk_plant_status_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `plant_status_history` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `status` ENUM('running','maintenance','stopped') NOT NULL,
  `title` VARCHAR(200) NULL,
  `message` VARCHAR(1000) NULL,
  `started_at` DATETIME NOT NULL,
  `expected_restart_at` DATETIME NULL,
  `ended_at` DATETIME NULL,
  `started_by` INT NULL,
  `ended_by` INT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_plant_history_started` (`started_at`),
  KEY `idx_plant_history_open` (`ended_at`,`status`),
  CONSTRAINT `fk_plant_history_started_by` FOREIGN KEY (`started_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_plant_history_ended_by` FOREIGN KEY (`ended_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `shift_settings` (
  `id` TINYINT UNSIGNED NOT NULL,
  `current_shift` ENUM('day','night') NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `shifts` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `shift_name` ENUM('day','night') NOT NULL,
  `shift_date` DATE NOT NULL,
  `start_time` DATETIME NULL,
  `end_time` DATETIME NULL,
  `started_by` INT NULL,
  `ended_by` INT NULL,
  `status` ENUM('active','closed') NOT NULL DEFAULT 'active',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_shift_date_name` (`shift_date`,`shift_name`),
  KEY `idx_shifts_status` (`status`,`id`),
  CONSTRAINT `fk_shift_started_by` FOREIGN KEY (`started_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_shift_ended_by` FOREIGN KEY (`ended_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `item_name` VARCHAR(150) NOT NULL,
  `created_by` INT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_items_name` (`item_name`),
  KEY `idx_items_created_by` (`created_by`),
  CONSTRAINT `fk_items_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `financial_years` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `financial_year` VARCHAR(7) NOT NULL,
  `created_by` INT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_financial_years_value` (`financial_year`),
  KEY `idx_financial_years_created_by` (`created_by`),
  CONSTRAINT `fk_financial_years_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `current_financial_year` (
  `id` TINYINT UNSIGNED NOT NULL,
  `financial_year_id` BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_current_financial_year` FOREIGN KEY (`financial_year_id`) REFERENCES `financial_years` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `production_planning` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `financial_year_id` BIGINT UNSIGNED NULL,
  `challan_no` VARCHAR(100) NULL,
  `party_name` VARCHAR(255) NOT NULL,
  `material_description` TEXT NULL,
  `planned_qty` INT NOT NULL DEFAULT 0,
  `target_zinc_percentage` DECIMAL(6,2) NULL,
  `third_party_name` VARCHAR(255) NULL,
  `status` ENUM('pending','completed','canceled') NOT NULL DEFAULT 'pending',
  `deleted_at` DATETIME NULL,
  `challan_type` VARCHAR(20) NOT NULL DEFAULT 'regular',
  `created_by` INT NULL,
  `updated_by` INT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completed_qty` INT NOT NULL DEFAULT 0,
  `queue_position` BIGINT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_planning_visible` (`deleted_at`,`status`),
  KEY `idx_planning_queue` (`queue_position`,`id`),
  KEY `idx_planning_challan` (`challan_no`),
  KEY `idx_planning_financial_year` (`financial_year_id`),
  CONSTRAINT `fk_planning_financial_year` FOREIGN KEY (`financial_year_id`) REFERENCES `financial_years` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_planning_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_planning_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `production_planning_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `planning_id` INT NOT NULL,
  `challan_no` VARCHAR(100) NULL,
  `party_name` VARCHAR(255) NULL,
  `item_id` BIGINT UNSIGNED NULL,
  `material_detail` VARCHAR(255) NULL,
  `material_description` VARCHAR(255) NOT NULL,
  `planned_qty` INT UNSIGNED NOT NULL,
  `completed_qty` INT UNSIGNED NOT NULL DEFAULT 0,
  `target_zinc_percentage` DECIMAL(6,2) NULL,
  `sequence_no` INT UNSIGNED NOT NULL,
  `status` ENUM('pending','completed') NOT NULL DEFAULT 'pending',
  `planning_source` ENUM('in_house','other_party') NOT NULL DEFAULT 'in_house',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_planning_item_sequence` (`planning_id`,`sequence_no`),
  KEY `idx_planning_items_active` (`planning_id`,`status`,`sequence_no`),
  KEY `idx_planning_items_item` (`item_id`),
  KEY `idx_planning_items_challan` (`challan_no`),
  CONSTRAINT `fk_planning_items_planning` FOREIGN KEY (`planning_id`) REFERENCES `production_planning` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_planning_items_item` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `contractors` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(120) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contractor_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `contractor_shift_assignments` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `shift_name` ENUM('day','night') NOT NULL,
  `effective_from` DATE NOT NULL,
  `contractor_id` INT NULL,
  `updated_by` INT NOT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contractor_shift_date` (`shift_name`,`effective_from`),
  KEY `idx_assignment_contractor` (`contractor_id`),
  KEY `idx_assignment_user` (`updated_by`),
  CONSTRAINT `fk_assignment_contractor` FOREIGN KEY (`contractor_id`) REFERENCES `contractors` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_assignment_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `contractor_rotations` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `effective_from` DATE NOT NULL,
  `day_contractor_id` INT NULL,
  `night_contractor_id` INT NULL,
  `rotate_monthly` TINYINT(1) NOT NULL DEFAULT 1,
  `revision` INT NOT NULL DEFAULT 1,
  `updated_by` INT NOT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_contractor_rotation_date` (`effective_from`),
  KEY `idx_rotation_day` (`day_contractor_id`),
  KEY `idx_rotation_night` (`night_contractor_id`),
  KEY `idx_rotation_user` (`updated_by`),
  CONSTRAINT `fk_rotation_day` FOREIGN KEY (`day_contractor_id`) REFERENCES `contractors` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_rotation_night` FOREIGN KEY (`night_contractor_id`) REFERENCES `contractors` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_rotation_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chat_participants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `installation_id` VARCHAR(100) NOT NULL,
  `display_name` VARCHAR(60) NOT NULL,
  `mobile_number` VARCHAR(20) NOT NULL,
  `last_seen_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_chat_participant_installation` (`installation_id`),
  KEY `idx_chat_participant_user` (`user_id`),
  KEY `idx_chat_participant_mobile` (`mobile_number`),
  CONSTRAINT `fk_chat_participant_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chat_participant_devices` (
  `installation_id` VARCHAR(100) NOT NULL,
  `participant_id` BIGINT UNSIGNED NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`installation_id`),
  KEY `idx_chat_device_participant` (`participant_id`),
  CONSTRAINT `fk_chat_device_participant` FOREIGN KEY (`participant_id`) REFERENCES `chat_participants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chat_messages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `sender_name` VARCHAR(80) NULL,
  `participant_id` BIGINT UNSIGNED NULL,
  `message` VARCHAR(1000) NOT NULL,
  `reply_to_message_id` BIGINT UNSIGNED NULL,
  `edited_at` TIMESTAMP NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_chat_created` (`created_at`,`id`),
  KEY `idx_chat_user` (`user_id`),
  KEY `idx_chat_message_participant` (`participant_id`),
  KEY `idx_chat_reply` (`reply_to_message_id`),
  CONSTRAINT `fk_chat_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_chat_message_participant` FOREIGN KEY (`participant_id`) REFERENCES `chat_participants` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_chat_reply_message` FOREIGN KEY (`reply_to_message_id`) REFERENCES `chat_messages` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chat_participant_reads` (
  `participant_id` BIGINT UNSIGNED NOT NULL,
  `last_read_message_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`participant_id`),
  KEY `idx_chat_participant_last_read` (`last_read_message_id`),
  CONSTRAINT `fk_chat_participant_read` FOREIGN KEY (`participant_id`) REFERENCES `chat_participants` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chat_read_receipts` (
  `user_id` INT NOT NULL,
  `last_read_message_id` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_chat_read_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `production_entries` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `shift_id` INT NOT NULL,
  `shift_date` DATE NOT NULL,
  `shift_name` ENUM('day','night') NOT NULL,
  `planning_id` INT NULL,
  `planning_item_id` BIGINT UNSIGNED NULL,
  `item_id` BIGINT UNSIGNED NULL,
  `client_request_id` VARCHAR(64) NULL,
  `sr_no` INT NOT NULL,
  `challan_no` VARCHAR(100) NULL,
  `party_name` VARCHAR(150) NULL,
  `material` VARCHAR(255) NULL,
  `production_time` VARCHAR(20) NULL,
  `dipping_qty` INT NULL,
  `kettle_temperature` DECIMAL(10,2) NULL,
  `ms_weight` DECIMAL(10,2) NULL,
  `gi_weight` DECIMAL(10,2) NULL,
  `zinc_percentage` DECIMAL(10,2) NULL,
  `production_cost` DECIMAL(12,2) NULL,
  `production_cost_zinc_rate` DECIMAL(12,2) NULL,
  `production_cost_plant_cost` DECIMAL(12,4) NULL,
  `production_cost_profit` DECIMAL(5,2) NULL,
  `production_weight` DECIMAL(12,3) NOT NULL DEFAULT 0,
  `c1` DECIMAL(10,2) NULL,
  `c2` DECIMAL(10,2) NULL,
  `c3` DECIMAL(10,2) NULL,
  `c4` DECIMAL(10,2) NULL,
  `c5` DECIMAL(10,2) NULL,
  `avg_coating` DECIMAL(10,2) NULL,
  `remarks` TEXT NULL,
  `created_by` INT NULL,
  `updated_by` INT NULL,
  `row_type` ENUM('entry','summary') NOT NULL DEFAULT 'entry',
  `material_group_no` INT NULL,
  `total_dip_qty` INT NOT NULL DEFAULT 0,
  `total_ms_production_kg` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `total_gi_production_kg` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `zinc_consumption_kg` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `zinc_consumption_percentage` DECIMAL(10,2) NOT NULL DEFAULT 0,
  `challan_type` VARCHAR(20) NOT NULL DEFAULT 'regular',
  `dip_info` TEXT NULL,
  `approx_weight` DECIMAL(14,3) NULL,
  `zinc_consumption` DECIMAL(10,2) NULL,
  `contractor_id` INT NULL,
  `zinc_stock_deducted_kg` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_production_shift_sr` (`shift_id`,`sr_no`),
  UNIQUE KEY `uq_production_client_request` (`client_request_id`),
  KEY `idx_production_date_shift` (`shift_date`,`shift_name`),
  KEY `idx_production_planning` (`planning_id`),
  KEY `idx_production_planning_item` (`planning_item_id`),
  KEY `idx_production_item` (`item_id`),
  KEY `idx_production_contractor` (`contractor_id`),
  KEY `idx_production_created_by` (`created_by`),
  CONSTRAINT `fk_production_shift` FOREIGN KEY (`shift_id`) REFERENCES `shifts` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_production_planning` FOREIGN KEY (`planning_id`) REFERENCES `production_planning` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_production_planning_item` FOREIGN KEY (`planning_item_id`) REFERENCES `production_planning_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_production_item` FOREIGN KEY (`item_id`) REFERENCES `items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_production_contractor` FOREIGN KEY (`contractor_id`) REFERENCES `contractors` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_production_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_production_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `production_edit_grants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `production_entry_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `granted_by` INT NOT NULL,
  `granted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `used_at` DATETIME NULL,
  `revoked_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_edit_grant_user_active` (`user_id`,`used_at`,`revoked_at`),
  KEY `idx_edit_grant_entry` (`production_entry_id`),
  CONSTRAINT `fk_edit_grant_entry` FOREIGN KEY (`production_entry_id`) REFERENCES `production_entries` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_edit_grant_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_edit_grant_granter` FOREIGN KEY (`granted_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_production_preferences` (
  `user_id` INT NOT NULL,
  `default_planning_id` INT NULL,
  `default_planning_item_id` BIGINT UNSIGNED NULL,
  `default_contractor_id` INT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  KEY `idx_pref_planning` (`default_planning_id`),
  KEY `idx_pref_planning_item` (`default_planning_item_id`),
  KEY `idx_pref_contractor` (`default_contractor_id`),
  CONSTRAINT `fk_pref_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pref_planning` FOREIGN KEY (`default_planning_id`) REFERENCES `production_planning` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pref_planning_item` FOREIGN KEY (`default_planning_item_id`) REFERENCES `production_planning_items` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_pref_contractor` FOREIGN KEY (`default_contractor_id`) REFERENCES `contractors` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `production_shift_context` (
  `id` TINYINT UNSIGNED NOT NULL,
  `correction_shift_id` INT NULL,
  `correction_user_id` INT NULL,
  `revision` BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `opened_by` INT NULL,
  `opened_at` DATETIME NULL,
  `resumed_by` INT NULL,
  `resumed_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_context_correction_shift` (`correction_shift_id`),
  KEY `idx_production_shift_context_user` (`correction_user_id`),
  CONSTRAINT `fk_context_correction_shift` FOREIGN KEY (`correction_shift_id`) REFERENCES `shifts` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_production_shift_context_user` FOREIGN KEY (`correction_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_context_opened_by` FOREIGN KEY (`opened_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_context_resumed_by` FOREIGN KEY (`resumed_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coating_certificates` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `tc_no` VARCHAR(50) NOT NULL,
  `planning_id` INT NOT NULL,
  `challan_no` VARCHAR(100) NOT NULL,
  `party_name` VARCHAR(255) NOT NULL,
  `third_party_name` VARCHAR(255) NULL,
  `structure` VARCHAR(255) NULL,
  `quantity` VARCHAR(100) NULL,
  `inspection_date` DATE NOT NULL,
  `reference_standard` VARCHAR(255) NOT NULL,
  `needed_coating` DECIMAL(8,2) NULL,
  `coating_readings_json` JSON NULL,
  `visual_check_result` VARCHAR(255) NULL,
  `visual_check_observation` VARCHAR(255) NULL,
  `adhesion_test_result` VARCHAR(255) NULL,
  `adhesion_test_observation` VARCHAR(255) NULL,
  `knife_test_result` VARCHAR(255) NULL,
  `knife_test_observation` VARCHAR(255) NULL,
  `mass_test_result` VARCHAR(255) NULL,
  `mass_test_observation` VARCHAR(255) NULL,
  `preece_test_result` VARCHAR(255) NULL,
  `preece_test_observation` VARCHAR(255) NULL,
  `remarks` TEXT NULL,
  `created_by` INT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_certificate_tc_no` (`tc_no`),
  KEY `idx_certificate_planning` (`planning_id`),
  KEY `idx_certificate_challan` (`challan_no`),
  CONSTRAINT `fk_certificate_planning` FOREIGN KEY (`planning_id`) REFERENCES `production_planning` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_certificate_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `zinc_stock` (
  `id` TINYINT UNSIGNED NOT NULL,
  `initialized` TINYINT(1) NOT NULL DEFAULT 0,
  `plant_kg` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `kettle_kg` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `kg_per_mm` DECIMAL(10,3) NULL,
  `current_zinc_rate` DECIMAL(12,2) NULL,
  `revision` INT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_zinc_plant_nonnegative` CHECK (`plant_kg` >= 0),
  CONSTRAINT `chk_zinc_kettle_nonnegative` CHECK (`kettle_kg` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `zinc_stock_movements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `request_id` VARCHAR(100) NOT NULL,
  `request_hash` CHAR(64) NOT NULL,
  `movement_type` VARCHAR(30) NOT NULL,
  `amount_kg` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `zinc_rate_per_kg` DECIMAL(12,2) NULL,
  `plant_after_kg` DECIMAL(14,3) NOT NULL,
  `kettle_after_kg` DECIMAL(14,3) NOT NULL,
  `note` VARCHAR(255) NOT NULL DEFAULT '',
  `actor_user_id` INT NOT NULL,
  `production_entry_id` BIGINT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_zinc_stock_request` (`request_id`),
  KEY `idx_zinc_stock_created` (`created_at`,`id`),
  KEY `idx_zinc_movement_actor` (`actor_user_id`),
  KEY `idx_zinc_movement_production` (`production_entry_id`),
  CONSTRAINT `fk_zinc_movement_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `zinc_byproduct_transactions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `transaction_date` DATE NOT NULL,
  `ash_weight_kg` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `ash_rate` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `ash_base_amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `ash_gst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `dross_weight_kg` DECIMAL(14,3) NOT NULL DEFAULT 0,
  `dross_rate` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `dross_base_amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `dross_gst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `total_with_gst` DECIMAL(14,2) NOT NULL,
  `zinc_rate_snapshot` DECIMAL(12,2) NOT NULL,
  `recovered_zinc_kg` DECIMAL(14,3) NOT NULL,
  `note` VARCHAR(255) NOT NULL DEFAULT '',
  `actor_user_id` INT NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_zinc_byproduct_date` (`transaction_date`,`id`),
  KEY `idx_zinc_byproduct_actor` (`actor_user_id`),
  CONSTRAINT `fk_zinc_byproduct_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `expense_settings` (
  `id` TINYINT UNSIGNED NOT NULL,
  `rate_per_ton` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `staff_salary` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `hardware_expense` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `maintenance_expense` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `zinc_spray_expense` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `electricity_per_day` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `gas_bottle_rate` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `chemicals_per_day` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `ms_wire_per_day` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `rent_expense` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `acid_expense` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `crane_expense` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `other_expense` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `updated_by` INT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_expense_settings_user` (`updated_by`),
  CONSTRAINT `fk_expense_settings_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `expense_settings_history` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rate_per_ton` DECIMAL(14,2) NOT NULL,
  `staff_salary` DECIMAL(14,2) NOT NULL,
  `hardware_expense` DECIMAL(14,2) NOT NULL,
  `maintenance_expense` DECIMAL(14,2) NOT NULL,
  `zinc_spray_expense` DECIMAL(14,2) NOT NULL,
  `electricity_per_day` DECIMAL(14,2) NOT NULL,
  `gas_bottle_rate` DECIMAL(14,2) NOT NULL,
  `chemicals_per_day` DECIMAL(14,2) NOT NULL,
  `ms_wire_per_day` DECIMAL(14,2) NOT NULL,
  `rent_expense` DECIMAL(14,2) NOT NULL,
  `acid_expense` DECIMAL(14,2) NOT NULL,
  `crane_expense` DECIMAL(14,2) NOT NULL,
  `other_expense` DECIMAL(14,2) NOT NULL,
  `actor_user_id` INT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_expense_history_created` (`created_at`,`id`),
  KEY `idx_expense_history_actor` (`actor_user_id`),
  CONSTRAINT `fk_expense_history_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chemical_checks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `inspection_date` DATE NOT NULL,
  `flux_ph` DECIMAL(6,3) NOT NULL,
  `flux_density` DECIMAL(8,4) NOT NULL,
  `flux_temperature_c` DECIMAL(6,2) NULL,
  `acid_ph` DECIMAL(6,3) NOT NULL,
  `acid_density` DECIMAL(8,4) NOT NULL,
  `note` VARCHAR(255) NULL,
  `checked_by_user_id` INT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_chemical_checks_date` (`inspection_date`,`id`),
  KEY `idx_chemical_checks_user` (`checked_by_user_id`),
  CONSTRAINT `fk_chemical_checks_user` FOREIGN KEY (`checked_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `chk_flux_ph` CHECK (`flux_ph` BETWEEN 0 AND 14),
  CONSTRAINT `chk_acid_ph` CHECK (`acid_ph` BETWEEN -14 AND 14),
  CONSTRAINT `chk_flux_density` CHECK (`flux_density` > 0),
  CONSTRAINT `chk_acid_density` CHECK (`acid_density` > 0),
  CONSTRAINT `chk_flux_temperature` CHECK (`flux_temperature_c` IS NULL OR `flux_temperature_c` BETWEEN -50 AND 200)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `filename` VARCHAR(255) NOT NULL,
  `checksum` CHAR(64) NOT NULL,
  `execution_ms` INT UNSIGNED NOT NULL DEFAULT 0,
  `applied_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO `plant_status` (`id`,`status`) VALUES (1,'running');
INSERT IGNORE INTO `shift_settings` (`id`,`current_shift`) VALUES (1,NULL);
INSERT IGNORE INTO `production_shift_context` (`id`) VALUES (1);
INSERT IGNORE INTO `zinc_stock` (`id`,`kg_per_mm`) VALUES (1,35.700);
INSERT IGNORE INTO `expense_settings` (`id`) VALUES (1);

-- Required clean-install data. The password column contains bcrypt only;
-- change the temporary superadmin password immediately after first login.
INSERT IGNORE INTO `users`
  (`id`,`name`,`email`,`password`,`role`,`is_active`,`created_by`,`status`,`assigned_shift`)
VALUES
  (1,'IV Superadmin','superadmin@ivsquarestructure.com','$2b$12$fuGBGnrn2ny71Kckxt60Vuv6IC0d6aKnwSjMQAnDR.uEOR774DLha','superadmin',1,NULL,'active',NULL);

INSERT IGNORE INTO `financial_years`
  (`id`,`financial_year`,`created_by`)
VALUES
  (1,'2026-27',1);

INSERT IGNORE INTO `current_financial_year`
  (`id`,`financial_year_id`)
VALUES
  (1,1);

INSERT IGNORE INTO `items`
  (`id`,`item_name`,`created_by`)
VALUES
  (1,'General Material',1);

INSERT IGNORE INTO `contractors`
  (`id`,`name`)
VALUES
  (1,'Bhagat');

INSERT IGNORE INTO `app_settings`
  (`setting_key`,`setting_value`,`updated_by`)
VALUES
  ('zinc_alert_threshold',JSON_OBJECT('enabled',TRUE,'percentage',7.5),1),
  ('shift_schedule',JSON_OBJECT('automatic',TRUE,'day_start','08:00','night_start','20:00'),1),
  ('maintenance_mode',JSON_OBJECT('enabled',FALSE,'message',''),1);

INSERT IGNORE INTO `app_update_releases`
  (`platform`,`enabled`,`latest_version_code`,`latest_version_name`,`minimum_version_code`,`mandatory`,`updated_by`)
VALUES
  ('android',0,0,'',0,0,1);

-- Mark the final schema as current so the API migration runner does not try
-- to repeat ALTER statements already represented above.
INSERT IGNORE INTO `schema_migrations` (`filename`,`checksum`,`execution_ms`) VALUES
('20260815000100_create_user_permission_overrides.sql','180514966681cdb9288d72dadc9b7e16d8ebba8a69926985297e7c072f58b7e5',0),
('20260815000200_repair_user_permission_overrides.sql','180514966681cdb9288d72dadc9b7e16d8ebba8a69926985297e7c072f58b7e5',0),
('20260816000100_create_user_fcm_tokens.sql','8572719d856a3f5974b01129cbcdabf119ad6c47221b841c74fe410a92ac6455',0),
('20260816000200_create_notification_logs.sql','40f5951ade0183a6d3fc1194881e82090744a972158b7e28d0d8f91fec87b120',0),
('20260817000100_backfill_legacy_fcm_tokens.sql','b1ea4858102156b5a0caf700786bfa0d4c8da69891293e6f822dc99f8e250c36',0),
('20260817000200_remove_legacy_user_fcm_token.sql','55188bc750cc026d2798e9b669105f1b75670889a206ac48c3495f5413b512ed',0),
('20260817000300_add_fcm_installation_id.sql','890499fd8fc2ab00e2b45b9c6f397093fed6c57ac927f303fcd00db34685e22c',0),
('20260817000400_add_unique_fcm_installation_id.sql','a75bf4634ff6e716824da3d4491bbd22aee1f233340da1fbd6f2fb0b1a57cdeb',0),
('20260817000500_repair_fcm_token_auto_increment.sql','c16c6737bb1498b7ed57e69483c27f6d1bd0af62fc01a04b6139a10dec6bc912',0),
('20260906000100_create_items_table.sql','3d7b38efc71493eaf48254b8b4e9b8ec6a9c8dd0ce44ab56f2967000bd813e33',0),
('20260906000200_create_financial_years_table.sql','9ac953d769188c71562f401bfe8dce103088237152b8144b168488c8986a60d0',0),
('20260907000100_create_production_planning_items.sql','7bd1b4d62d324b54a50433a2783b1083e671a41f56ddb2640f84676dc14de34e',0),
('20260907000200_link_production_entries_to_planning_items.sql','575b09a54053cbc43b9136ed7f30e0f234399669f83bed6a08f52ca9107a5b30',0),
('20260907000300_backfill_production_planning_items.sql','d40f0e1f18fc8d2c012d50887b79d495de84d898e54eea6288f9faba08c2a1cb',0),
('20260907000400_add_challan_and_party_to_planning_items.sql','70c9637ae6b2c48a0412496abe655c37e449b44f129a284a46868eaa907584d2',0),
('20260911000100_add_financial_year_to_production_planning.sql','ed2635cabda35dfa21e4a6f05a76ee40d935c91adcd918ac011f8fc24d248dd8',0),
('20260911000200_add_material_detail_to_planning_items.sql','006c57fe416e8b68c2414b5eba9d37df1125732bce81ab8601ca1f13bfceb978',0),
('20260911000300_add_item_to_production_entries.sql','4b91f8b53f4addf1d8c1fa0cd0b2a4a173578fb6ae3e7624325f0a862e7a6c91',0),
('20260912000100_create_production_shift_context.sql','5916ace51699ba95b50ae80889071de1fbfbc00a58acbd6bb37f9306606a8861',0),
('20260912000200_seed_production_shift_context.sql','a2fbb40c187b3cde83980bf8577f6a7685b4da8d43a5f6aff3d28f96a27f86fc',0),
('20260913000100_create_current_financial_year.sql','af616bd55ccb64e71420074f35cf4ba561974bd97a29707fe93f3db436116dd0',0),
('20260918000100_add_planning_queue_position.sql','693d19aaae39da187ac73702c93ee1d19ace2ed68854d758f440daae570ed89e',0),
('20260918000200_initialize_planning_queue_position.sql','0e80cd277afe77010fba43b1cd0136714a800fd1ce5e550818cc45fc61bb45e8',0),
('20260918000300_create_contractors.sql','b5fad894ffd3dfd463c7b56e7c2c4543f880b5658aa9017c2523291a21969b0d',0),
('20260918000400_create_contractor_shift_assignments.sql','f9981d1a1d2526ab4b8bd4a8163585531946730fc7f6d2a41be9fb223ddcd273',0),
('20260919000100_add_planning_source.sql','268bf45b3e1a8de37c4ac45e053e6befc31d285e2d669aac5b500f0f3afb5d65',0),
('20260919000200_create_contractor_rotations.sql','8ee16099d403c75a649fa5921f3d20f9a918605b4b8719a1102b9300f8eb6929',0),
('20260919000300_link_production_contractor.sql','6c4b354d45462c652b48567fa91f375cb9ce35bbb1804ddfa3ee81265036d522',0),
('20260919000400_default_planning_item.sql','340f4f9c7b3e278659f2fb6d13158659e05856b895feee56d239379bfb6c026e',0),
('20260919000500_default_contractor.sql','d85f70cf184c6d96f40f3f2b01bc9d908aba4aa74f7fcd02cca6d62c53f1b731',0),
('20260920000100_create_zinc_stock.sql','34897619050f0b24f6e6b1e451b1721c16fefd18bebfd392085fc9d9d655fe07',0),
('20260920000200_create_zinc_stock_movements.sql','57390e0c4f87ed9007a08baccc799e90bd08d17beb84841b2befa260138991ca',0),
('20260920000300_add_production_zinc_stock.sql','37d0d45a4ef037613cfedb78cac65f68789e64b84b802294425d1c483cf079d9',0),
('20260920000400_link_zinc_movement_production.sql','8458e10bdf69c73c10ea82e329e33c4d842ec8b30e882a82ff46f27120c21936',0),
('20260921000100_split_zinc_stock_permissions.sql','4fc747bd655437c62c54063d23948ef782aedd87e20bd8edd8e02607a2ee960e',0),
('20260921000200_add_current_zinc_rate.sql','752a7363ea3b31c263552f6e4c89947198780c78f43154d439c35b668c7f27a5',0),
('20260921000300_create_zinc_byproduct_transactions.sql','089277519b8d15d10f5a610a230160dabab463c0e95df0bbd074ac7de044465a',0),
('20260921000400_create_expense_settings.sql','470187a77b4269c2d335ca945530b022bf9819212d33b12c4d35dff2b282f9f7',0),
('20260921000500_create_expense_settings_history.sql','2a6b28a3476216fd448838552d338ca7d4a7320ec950b23a3fc4395be3397022',0),
('20260924000100_create_chemical_checks.sql','28c69b2cefa73afb921e4fc3d53f1c0479e70eb22bb5badf6e85f10ae7abd37b',0),
('20260924000200_add_flux_temperature_to_chemical_checks.sql','93c50ca5f8ea34017442d2d442dd3d54b62023f9b83bf8b86380281fdbf33ae0',0),
('20260924000300_add_zinc_receipt_rate.sql','8f50a90e2a070c906d6d6c089aec78bd1483fa5f6d8c3ee73196c7025fbe38df',0),
('20260924000400_add_production_cost.sql','e1981ddab764b3f44122a2bf0d8c308084f1f26a1c9b1447d0d8ab5304ec3f08',0),
('20260924000500_create_chat_messages.sql','2f4324b3e1ebe5ce35db29342993e26cae7685a0adbb1900da5e472fafe5284c',0),
('20260924000600_create_chat_read_receipts.sql','fbc7170158b740cbaebb89ff0e269b640bc3147ebb816888ddb8274be3d8843f',0),
('20260924000700_add_chat_message_replies.sql','84bc07961479309f6cd9b5ff515e0813d1c24ecd394e4132918c542b83e12f26',0),
('20260924000800_add_chat_sender_name.sql','92eb2e986c374a8cd55d22add442166be74db7fe81ad92397dde28f1480de7f7',0),
('20260924000900_create_chat_participants.sql','aa2277488e61bf5812f1be20ea871695434f3b5ec108991817fe2e1563b59843',0),
('20260924001000_link_chat_message_participant.sql','73d318cb9fb93fdb03687d4137002ef40beeeec77100b96e8207603805da2349',0),
('20260924001100_create_chat_participant_reads.sql','9376da81ef9b016bdf5d28e9f7a1852eee91b8dd31cd30d552862413016b014d',0),
('20260924001200_unique_chat_participant_mobile.sql','cb1e1568595feda4a1aac309edd6448e4f5614f6a87de59c82e9eb22c7b675c1',0),
('20260924001300_create_chat_participant_devices.sql','444bb23ab32ef0de55e6ae2f7a1d9f996008e20f166d656287b17e6ded237487',0),
('20260925000100_allow_negative_acid_ph.sql','12bd4ac9049f0772437e42102c5c3ad702e414a4bee9949317e48d3924b3984d',0),
('20260925000200_add_labour_role.sql','a519aa9b67ff94f433b6ace438ce36c610244f5085cc45b97198687967fa23d7',0),
('20260925000300_create_labour_weight_entries.sql','c403a422b4bce2bbcb174cc64419cba8fc5e7283a95c1da1d416c1d753219e9a',0),
('20260925000400_target_shift_correction_user.sql','d83c6dd45e6d75e740e4327ce9db0f8847a789b059c9bef3ce5fe8de53522924',0);
