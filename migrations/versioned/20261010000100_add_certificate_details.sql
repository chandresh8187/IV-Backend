ALTER TABLE coating_certificates
  ADD COLUMN client_name VARCHAR(255) NULL,
  ADD COLUMN client_address TEXT NULL,
  ADD COLUMN invoice_no VARCHAR(100) NULL,
  ADD COLUMN material_description TEXT NULL,
  ADD COLUMN minimum_coating DECIMAL(8,2) NULL,
  ADD COLUMN maximum_coating DECIMAL(8,2) NULL;
