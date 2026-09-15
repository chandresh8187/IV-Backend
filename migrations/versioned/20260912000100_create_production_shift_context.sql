CREATE TABLE IF NOT EXISTS production_shift_context (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  correction_shift_id INT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  opened_by INT NULL,
  opened_at DATETIME NULL,
  resumed_by INT NULL,
  resumed_at DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
