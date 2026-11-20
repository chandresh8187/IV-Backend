const fs = require('node:fs');
const path = require('node:path');
async function migrateUnit1MaterialStock(db) {
  const sql = fs.readFileSync(path.join(__dirname, '../database/unit1_material_stock.sql'), 'utf8');
  for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.query(statement);
  for (const [name, definition] of [
    ['weighbridge_weight_kg','DECIMAL(14,3) DEFAULT NULL'],['weighed_at','DATETIME(3) DEFAULT NULL'],
    ['weighed_by','BIGINT UNSIGNED DEFAULT NULL'],['finish_requested','TINYINT NOT NULL DEFAULT 0'],
  ]) {
    const [[existing]] = await db.query("SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='unit1_material_dispatches' AND COLUMN_NAME=?",[name]);
    if (!Number(existing.count)) {
      try { await db.query(`ALTER TABLE unit1_material_dispatches ADD COLUMN ${name} ${definition}`); }
      catch(error) { if(error.code!=='ER_DUP_FIELDNAME') throw error; }
    }
  }
  const [[column]] = await db.query("SELECT COUNT(*) AS count FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='unit1_material_stock_items' AND COLUMN_NAME='customer_name'");
  if (!Number(column.count)) {
    try { await db.query("ALTER TABLE unit1_material_stock_items ADD COLUMN customer_name VARCHAR(150) NOT NULL DEFAULT '' AFTER stock_key"); }
    catch(error) { if(error.code!=='ER_DUP_FIELDNAME') throw error; }
  }
  // Schema retained for historical production/dispatch references; no stock backfill.
}
module.exports = { migrateUnit1MaterialStock };
