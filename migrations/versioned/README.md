# Versioned database migrations

Only future, automatically tracked migrations belong in this directory. The SQL files directly inside `migrations/` are legacy files that may already have been applied manually and are intentionally not rerun.

Create a migration with:

```bash
npm run migration:create -- add_feature_column
```

Each file must contain exactly one additive SQL statement. The runner rejects `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `REPLACE`, table renames, column `CHANGE`/`MODIFY`, disabled foreign-key checks, and bulk data loading.

The only destructive exception is the one-time, exact removal of
`users.fcm_token` after its values are backfilled into `user_fcm_tokens`.
All notification token writes and reads use the multi-device table.

For a populated table, add a nullable column or provide a safe default. Never edit or delete a migration after it has been applied; add another migration instead.
