const fs = require("node:fs");
const path = require("node:path");
async function migrateUnit1Maintenance(db) {
  for (const file of [
    "unit1_maintenance.sql",
    "unit1_maintenance_sessions.sql",
  ]) {
    const sql = fs
      .readFileSync(path.join(__dirname, "../database/" + file + ""), "utf8")
      .replace(/^\uFEFF/, "");
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await db.query(statement);
  }
}
module.exports = { migrateUnit1Maintenance };
