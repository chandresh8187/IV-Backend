ALTER TABLE chat_messages
  ADD COLUMN reply_to_message_id BIGINT UNSIGNED NULL AFTER message,
  ADD KEY idx_chat_reply (reply_to_message_id),
  ADD CONSTRAINT fk_chat_reply_message
    FOREIGN KEY (reply_to_message_id) REFERENCES chat_messages(id)
    ON DELETE SET NULL;
