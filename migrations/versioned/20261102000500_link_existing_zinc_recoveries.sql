INSERT INTO zinc_recovery_purchase_links (byproduct_id, purchase_id)
SELECT b.id, (SELECT p.id FROM zinc_purchases p WHERE p.created_at <= b.created_at AND p.zinc_rate_per_kg = b.zinc_rate_snapshot ORDER BY p.transaction_date DESC, p.transaction_time DESC, p.id DESC LIMIT 1)
FROM zinc_byproduct_transactions b
LEFT JOIN zinc_recovery_purchase_links l ON l.byproduct_id = b.id
WHERE l.byproduct_id IS NULL AND EXISTS (SELECT 1 FROM zinc_purchases p WHERE p.created_at <= b.created_at AND p.zinc_rate_per_kg = b.zinc_rate_snapshot);
