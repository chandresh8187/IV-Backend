const fs = require("fs");
const path = require("path");

const migrationName = String(process.argv.slice(2).join("_") || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

if (!migrationName) {
  console.error("Usage: npm run migration:create -- descriptive_name");
  process.exitCode = 1;
} else {
  const now = new Date();
  const timestamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
    String(now.getUTCHours()).padStart(2, "0"),
    String(now.getUTCMinutes()).padStart(2, "0"),
    String(now.getUTCSeconds()).padStart(2, "0"),
  ].join("");
  const filename = `${timestamp}_${migrationName}.sql`;
  const directory = path.join(__dirname, "..", "migrations", "versioned");
  const target = path.join(directory, filename);
  const template = `-- Additive, non-destructive migration.
-- Keep exactly one SQL statement in this file.
-- New columns on populated tables should be nullable or have a safe default.

-- Example:
-- ALTER TABLE example_table ADD COLUMN example_value VARCHAR(100) NULL;
`;

  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(target, template, { encoding: "utf8", flag: "wx" });
  console.log(`Created migrations/versioned/${filename}`);
}
