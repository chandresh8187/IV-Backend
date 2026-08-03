-- Control panel, plant status, notifications, and native update support.
-- Run once before deploying this backend. CREATE TABLE statements are idempotent.

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value JSON NOT NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_app_settings_updated_by (updated_by)
);

CREATE TABLE IF NOT EXISTS app_update_releases (
  platform VARCHAR(30) PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  latest_version_code INT NOT NULL DEFAULT 0,
  latest_version_name VARCHAR(50) NOT NULL DEFAULT '',
  minimum_version_code INT NOT NULL DEFAULT 0,
  mandatory TINYINT(1) NOT NULL DEFAULT 0,
  apk_url TEXT NULL,
  sha256 CHAR(64) NULL,
  release_notes TEXT NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(191) NULL,
  metadata JSON NULL,
  ip_address VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_created_at (created_at),
  INDEX idx_audit_actor (actor_user_id)
);

CREATE TABLE IF NOT EXISTS plant_status (
  id TINYINT UNSIGNED PRIMARY KEY,
  status ENUM('running', 'maintenance', 'stopped') NOT NULL DEFAULT 'running',
  title VARCHAR(200) NULL,
  message VARCHAR(1000) NULL,
  started_at DATETIME NULL,
  expected_restart_at DATETIME NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plant_status_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  status ENUM('maintenance', 'stopped') NOT NULL,
  title VARCHAR(200) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  started_at DATETIME NOT NULL,
  expected_restart_at DATETIME NULL,
  ended_at DATETIME NULL,
  started_by INT NULL,
  ended_by INT NULL,
  INDEX idx_plant_history_started (started_at),
  INDEX idx_plant_history_open (ended_at, status)
);

CREATE TABLE IF NOT EXISTS user_fcm_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  fcm_token VARCHAR(512) NOT NULL,
  device_type VARCHAR(30) NOT NULL DEFAULT 'android',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fcm_token (fcm_token),
  INDEX idx_fcm_user (user_id)
);

CREATE TABLE IF NOT EXISTS notification_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(100) NOT NULL,
  reference_key VARCHAR(191) NOT NULL,
  title VARCHAR(255) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notification_reference (type, reference_key)
);

CREATE TABLE IF NOT EXISTS shift_settings (
  id TINYINT UNSIGNED PRIMARY KEY,
  current_shift ENUM('day', 'night') NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO plant_status (id, status)
VALUES (1, 'running')
ON DUPLICATE KEY UPDATE id = id;

INSERT INTO shift_settings (id, current_shift)
VALUES (1, NULL)
ON DUPLICATE KEY UPDATE id = id;
