INSERT IGNORE INTO user_fcm_tokens (user_id, fcm_token, device_type)
SELECT id, TRIM(fcm_token), 'android'
FROM users
WHERE fcm_token IS NOT NULL
  AND TRIM(fcm_token) <> '';
