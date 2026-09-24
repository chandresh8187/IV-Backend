ALTER TABLE chat_messages
  ADD COLUMN participant_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD KEY idx_chat_message_participant (participant_id),
  ADD CONSTRAINT fk_chat_message_participant FOREIGN KEY (participant_id) REFERENCES chat_participants(id) ON DELETE SET NULL;
