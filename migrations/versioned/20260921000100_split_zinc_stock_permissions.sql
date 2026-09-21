INSERT IGNORE INTO user_permission_overrides (user_id, permission_key, allowed)
SELECT existing.user_id, zinc_permissions.permission_key, existing.allowed
FROM user_permission_overrides existing
CROSS JOIN (
  SELECT 'zinc_stock.receive' AS permission_key
  UNION ALL SELECT 'zinc_stock.transfer'
  UNION ALL SELECT 'zinc_stock.adjust'
) zinc_permissions
WHERE existing.permission_key = 'zinc_stock.manage';
