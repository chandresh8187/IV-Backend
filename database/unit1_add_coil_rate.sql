-- Run in the existing Unit 1 database before deploying the updated backend.
-- Existing coil rates remain NULL (not recorded); no stock/history is changed.
-- Safe to run again on MySQL or MariaDB.
SET @coil_rate_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coils' AND COLUMN_NAME = 'rate_per_kg'),
  'SELECT ''Coil rate column already exists'' AS message',
  'ALTER TABLE coils ADD COLUMN rate_per_kg DECIMAL(10,2) NULL AFTER actual_net_kg'
);
PREPARE coil_rate_statement FROM @coil_rate_ddl;
EXECUTE coil_rate_statement;
DEALLOCATE PREPARE coil_rate_statement;
