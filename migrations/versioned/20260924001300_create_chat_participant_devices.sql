CREATE TABLE IF NOT EXISTS chat_participant_devices (
  installation_id VARCHAR(100) NOT NULL,
  participant_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (installation_id),
  KEY idx_chat_device_participant (participant_id),
  CONSTRAINT fk_chat_device_participant FOREIGN KEY (participant_id) REFERENCES chat_participants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
