ALTER TABLE production_shift_context
  ADD COLUMN correction_user_id INT NULL AFTER correction_shift_id,
  ADD KEY idx_production_shift_context_user (correction_user_id),
  ADD CONSTRAINT fk_production_shift_context_user FOREIGN KEY (correction_user_id) REFERENCES users(id) ON DELETE SET NULL;
