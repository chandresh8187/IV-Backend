ALTER TABLE user_fcm_tokens
ADD UNIQUE KEY uq_fcm_installation (installation_id);
