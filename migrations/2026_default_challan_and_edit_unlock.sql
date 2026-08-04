-- Required by:
--   PUT  /api/productions/preferences/default-challan
--   POST /api/productions/:id/edit-grant
-- Safe to run more than once.

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
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_production_pref_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_production_pref_planning FOREIGN KEY (default_planning_id)
    REFERENCES production_planning(id) ON DELETE SET NULL
);
