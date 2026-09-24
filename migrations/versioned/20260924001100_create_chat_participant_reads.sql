CREATE TABLE IF NOT EXISTS chat_participant_reads (
  participant_id BIGINT UNSIGNED NOT NULL,
  last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (participant_id),
  KEY idx_chat_participant_last_read (last_read_message_id),
  CONSTRAINT fk_chat_participant_read FOREIGN KEY (participant_id) REFERENCES chat_participants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
