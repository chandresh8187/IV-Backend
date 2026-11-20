INSERT INTO zinc_purchases (movement_id, transaction_date, transaction_time, amount_kg, zinc_rate_per_kg, batch_number, invoice_number, note, actor_user_id, created_at)
SELECT m.id, COALESCE(m.transaction_date, DATE(m.created_at)), m.transaction_time, m.amount_kg, COALESCE(m.zinc_rate_per_kg, 0), m.batch_number, m.invoice_number, m.note, m.actor_user_id, m.created_at
FROM zinc_stock_movements m LEFT JOIN zinc_purchases p ON p.movement_id = m.id
WHERE m.movement_type = 'receive' AND p.id IS NULL;
