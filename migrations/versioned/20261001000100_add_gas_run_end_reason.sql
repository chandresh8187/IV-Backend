ALTER TABLE gas_bottle_runs ADD COLUMN end_reason ENUM('finished','paused') NOT NULL DEFAULT 'finished';
