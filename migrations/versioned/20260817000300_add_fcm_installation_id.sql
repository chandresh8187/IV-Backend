ALTER TABLE user_fcm_tokens
ADD COLUMN installation_id VARCHAR(100) NULL AFTER user_id;
