-- Initialize only empty queue positions; never overwrite saved priorities.
UPDATE production_planning SET queue_position = -CAST(id AS SIGNED) WHERE queue_position IS NULL;
