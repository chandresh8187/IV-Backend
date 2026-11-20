const fs = require("fs"),
  path = require("path");
async function migrateUnit1Planning(db) {
  for (const statement of fs
    .readFileSync(
      path.join(__dirname, "../database/unit1_production_planning.sql"),
      "utf8"
    )
    .split(";")
    .filter((s) => s.trim()))
    await db.query(statement);
  const service = require("../services/unit1Planning");
  await service.transaction(db, async (c) => {
    const [rows] = await c.query(
      "SELECT j.id,j.created_by actor,j.archived_at archivedAt FROM unit1_job_cards j LEFT JOIN unit1_production_plan_lines l ON l.job_card_id=j.id WHERE l.job_card_id IS NULL ORDER BY j.id"
    );
    for (const row of rows)
      await service.linkLegacyJob(c, row.id, row.actor, row.archivedAt);
  });
}
module.exports = { migrateUnit1Planning };
