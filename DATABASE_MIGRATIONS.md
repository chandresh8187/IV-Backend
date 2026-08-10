# Safe production database migrations

The live database must not be replaced with a local SQL export. Deploy only incremental migration files together with the backend code.

## Normal workflow

1. Back up the live database before every deployment.
2. Create a migration locally:

   ```bash
   npm run migration:create -- add_new_feature_field
   ```

3. Put one additive SQL statement in the generated file under `migrations/versioned/`.
4. Validate it locally without applying it:

   ```bash
   npm run migrate:dry-run
   ```

5. Apply and test it against the local database:

   ```bash
   npm run migrate
   ```

6. Upload the backend, including the new migration file, to the live server.
7. On the live server, before restarting the app, run:

   ```bash
   npm run migrate:status
   npm run migrate:dry-run
   npm run migrate
   ```

8. Restart the backend only after the migration succeeds.

The runner creates a `schema_migrations` table, records the filename and SHA-256 checksum, and applies each migration once. An advisory lock prevents two deployments from migrating simultaneously. A changed or missing applied migration causes deployment to stop.

## Safe examples

```sql
ALTER TABLE production_planning
  ADD COLUMN new_feature_value VARCHAR(100) NULL;
```

```sql
CREATE TABLE IF NOT EXISTS feature_settings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  setting_value VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
```

Adding a required column to a populated table should normally be done across separate deployments: first add it as nullable, deploy code that can handle both states, backfill through a reviewed maintenance process if needed, and only later consider making it required.

## Important limitations

MySQL schema changes can cause an implicit commit, so a failed multi-change migration cannot always be rolled back. For that reason every file is restricted to one SQL statement. Use multiple numbered migration files when a feature needs multiple schema changes.

The legacy SQL files directly inside `migrations/` are not read by the runner. They are retained only as historical documentation because rerunning them against an existing live database is unsafe.
