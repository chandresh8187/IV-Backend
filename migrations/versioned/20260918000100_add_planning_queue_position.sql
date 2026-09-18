-- Preserve the existing visible newest-first order as the initial queue.
-- New plans have NULL positions and append after this initialized queue.
ALTER TABLE production_planning ADD COLUMN queue_position BIGINT NULL;
