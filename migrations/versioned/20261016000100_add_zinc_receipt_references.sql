ALTER TABLE zinc_stock_movements
  ADD COLUMN batch_number VARCHAR(100) NULL,
  ADD COLUMN invoice_number VARCHAR(100) NULL;
