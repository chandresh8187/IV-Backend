const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv-flow").config({ silent: true });

const { validateMigrationSql } = require("./migrationSafety");

const MIGRATIONS_DIRECTORY = path.join(__dirname, "..", "migrations", "versioned");
const MIGRATION_LOCK = "iv_api_schema_migrations";

function getDatabaseConfig() {
  const required = ["DB_HOST", "DB_USER", "DB_NAME"];
  const missing = required.filter((key) => !String(process.env[key] || "").trim());
  if (missing.length) {
    throw new Error(`Missing database environment variables: ${missing.join(", ")}`);
  }

  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    timezone: "+05:30",
  };
}

function loadMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => {
      const filename = entry.name;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIRECTORY, filename), "utf8");
      const checksum = crypto.createHash("sha256").update(sql).digest("hex");
      return { filename, sql, checksum };
    })
    .sort((left, right) => left.filename.localeCompare(right.filename));
}

async function ensureMigrationTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      execution_ms INT UNSIGNED NOT NULL DEFAULT 0,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
}

async function getAppliedMigrations(connection) {
  const [rows] = await connection.query(
    "SELECT filename, checksum, execution_ms, applied_at FROM schema_migrations ORDER BY filename",
  );
  return new Map(rows.map((row) => [row.filename, row]));
}

function verifyMigrationHistory(files, applied) {
  const filesByName = new Map(files.map((file) => [file.filename, file]));

  for (const [filename, record] of applied) {
    const file = filesByName.get(filename);
    if (!file) {
      throw new Error(`Applied migration file is missing: ${filename}`);
    }
    if (file.checksum !== record.checksum) {
      throw new Error(`Applied migration was modified: ${filename}`);
    }
  }
}

async function acquireLock(connection) {
  const [[row]] = await connection.query("SELECT GET_LOCK(?, 30) AS acquired", [MIGRATION_LOCK]);
  if (Number(row?.acquired) !== 1) {
    throw new Error("Could not acquire the database migration lock");
  }
}

async function releaseLock(connection) {
  try {
    await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]);
  } catch (error) {
    console.error("Could not release migration lock:", error.message);
  }
}

function showStatus(files, applied) {
  if (!files.length) {
    console.log("No versioned migration files found. Database is ready for future migrations.");
    return;
  }

  for (const file of files) {
    console.log(`${applied.has(file.filename) ? "APPLIED" : "PENDING"}  ${file.filename}`);
  }
}

async function run() {
  const command = process.argv[2] || "up";
  const dryRun = process.argv.includes("--dry-run");
  if (!new Set(["up", "status"]).has(command)) {
    throw new Error("Usage: node scripts/migrate.js [up|status] [--dry-run]");
  }

  const connection = await mysql.createConnection(getDatabaseConfig());
  let lockAcquired = false;

  try {
    await acquireLock(connection);
    lockAcquired = true;
    await ensureMigrationTable(connection);

    const files = loadMigrationFiles();
    const applied = await getAppliedMigrations(connection);
    verifyMigrationHistory(files, applied);

    if (command === "status") {
      showStatus(files, applied);
      return;
    }

    const pending = files.filter((file) => !applied.has(file.filename));
    const validated = pending.map((file) => ({
      ...file,
      statement: validateMigrationSql(file.sql),
    }));

    if (!validated.length) {
      console.log("Database is up to date. No pending migrations.");
      return;
    }

    if (dryRun) {
      console.log(`Validated ${validated.length} pending migration(s):`);
      validated.forEach((file) => console.log(`PENDING  ${file.filename}`));
      return;
    }

    for (const file of validated) {
      const startedAt = Date.now();
      console.log(`Applying ${file.filename}...`);
      await connection.query(file.statement);
      const executionMs = Date.now() - startedAt;
      await connection.query(
        "INSERT INTO schema_migrations (filename, checksum, execution_ms) VALUES (?, ?, ?)",
        [file.filename, file.checksum, executionMs],
      );
      console.log(`Applied ${file.filename} (${executionMs} ms)`);
    }

    console.log(`Successfully applied ${validated.length} migration(s).`);
  } finally {
    if (lockAcquired) await releaseLock(connection);
    await connection.end();
  }
}

run().catch((error) => {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
});
