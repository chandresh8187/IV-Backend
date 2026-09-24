CREATE TABLE IF NOT EXISTS chat_participants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  installation_id VARCHAR(100) NOT NULL,
  display_name VARCHAR(60) NOT NULL,
  mobile_number VARCHAR(20) NOT NULL,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chat_participant_installation (installation_id),
  KEY idx_chat_participant_user (user_id),
  CONSTRAINT fk_chat_participant_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
