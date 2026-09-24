ALTER TABLE chat_messages
  ADD COLUMN sender_name VARCHAR(80) NULL AFTER user_id;
