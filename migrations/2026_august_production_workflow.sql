-- August 2026 production workflow upgrade.
-- Run once after the existing 2026 migrations. MySQL 8.0+ is recommended.

ALTER TABLE production_planning
  ADD COLUMN target_zinc_percentage DECIMAL(6,2) NULL AFTER planned_qty,
  ADD COLUMN deleted_at DATETIME NULL AFTER status,
  ADD INDEX idx_planning_visible (deleted_at, status);

ALTER TABLE production_entries
  ADD COLUMN client_request_id VARCHAR(64) NULL AFTER planning_id,
  ADD UNIQUE INDEX uq_production_client_request (client_request_id);

ALTER TABLE coating_certificates
  ADD COLUMN needed_coating DECIMAL(8,2) NULL AFTER reference_standard,
  ADD COLUMN coating_readings_json JSON NULL AFTER needed_coating;

CREATE TABLE IF NOT EXISTS production_edit_grants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  production_entry_id INT NOT NULL,
  user_id INT NOT NULL,
  granted_by INT NOT NULL,
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at DATETIME NULL,
  revoked_at DATETIME NULL,
  INDEX idx_edit_grant_user_active (user_id, used_at, revoked_at),
  INDEX idx_edit_grant_entry (production_entry_id),
  CONSTRAINT fk_edit_grant_entry FOREIGN KEY (production_entry_id)
    REFERENCES production_entries(id) ON DELETE CASCADE,
  CONSTRAINT fk_edit_grant_user FOREIGN KEY (user_id)
    REFERENCES users(id),
  CONSTRAINT fk_edit_grant_granter FOREIGN KEY (granted_by)
    REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_production_preferences (
  user_id INT PRIMARY KEY,
  default_planning_id INT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_production_pref_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_production_pref_planning FOREIGN KEY (default_planning_id)
    REFERENCES production_planning(id) ON DELETE SET NULL
);

-- Existing canceled rows disappear from all active planning lists.
UPDATE production_planning
SET deleted_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
WHERE status = 'canceled' AND deleted_at IS NULL;
