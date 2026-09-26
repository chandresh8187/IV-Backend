ALTER TABLE chemical_checks
  DROP CONSTRAINT IF EXISTS chk_acid_ph,
  ADD CONSTRAINT chk_acid_ph CHECK (acid_ph BETWEEN -14 AND 14);
