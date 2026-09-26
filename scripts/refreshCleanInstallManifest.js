const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const migrationDirectory = path.join(root, "migrations", "versioned");
const schemaPath = path.join(root, "database", "u436685010_iv_app_clean_install.sql");
const marker = "-- Mark the final schema as current so the API migration runner does not try\n-- to repeat ALTER statements already represented above.\n";

const files = fs.readdirSync(migrationDirectory)
  .filter(name => name.endsWith(".sql"))
  .sort();

const rows = files.map(name => {
  const sql = fs.readFileSync(path.join(migrationDirectory, name), "utf8").replace(/\r\n?/g, "\n");
  const checksum = crypto.createHash("sha256").update(sql).digest("hex");
  return `('${name}','${checksum}',0)`;
});

const manifest = `${marker}INSERT IGNORE INTO \`schema_migrations\` (\`filename\`,\`checksum\`,\`execution_ms\`) VALUES\n${rows.join(",\n")};\n`;
const schema = fs.readFileSync(schemaPath, "utf8").replace(/\r\n?/g, "\n");
const markerIndex = schema.indexOf(marker);
if (markerIndex < 0) throw new Error("Clean-install migration marker not found");
fs.writeFileSync(schemaPath, schema.slice(0, markerIndex) + manifest, "utf8");
const output = fs.readFileSync(schemaPath, "utf8");
const tableNames = [...output.matchAll(/CREATE TABLE IF NOT EXISTS `([^`]+)`/g)].map(match => match[1]);
const requiredTables = [
  "users", "shifts", "production_entries", "production_planning",
  "production_planning_items", "labour_weight_entries", "chat_participants",
  "chat_participant_devices", "chat_participant_reads", "zinc_stock",
  "expense_settings", "chemical_checks", "schema_migrations",
];
const missing = requiredTables.filter(name => !tableNames.includes(name));
if (missing.length) throw new Error(`Clean-install schema is missing tables: ${missing.join(", ")}`);
if (new Set(tableNames).size !== tableNames.length) throw new Error("Clean-install schema contains duplicate CREATE TABLE statements");
console.log(`Validated ${tableNames.length} tables and ${rows.length} migration records in ${path.basename(schemaPath)}`);
