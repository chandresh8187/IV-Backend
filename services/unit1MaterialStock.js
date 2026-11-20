const fail = (status, message) => Object.assign(new Error(message), { status });
const MATERIALS = ['MS', 'GL', 'GP', 'Posmac'];
function normalizeOpening(body = {}) {
  const text = (key, max, required = true) => {
    const value = body[key] ?? (required ? null : '');
    if (typeof value !== 'string' || (required && !value.trim()) || value.trim().length > max || /[\x00-\x1f]/.test(value)) throw fail(400, 'Enter valid material details.');
    return value.trim();
  };
  const decimal = (key, max) => {
    const value = String(body[key] ?? '');
    if (!/^\d+(\.\d{1,3})?$/.test(value) || Number(value) <= 0 || Number(value) > max) throw fail(400, 'Length and thickness must be positive numbers with up to three decimals.');
    return Number(value);
  };
  const quantity = Number(body.quantity);
  if (!/^\d+$/.test(String(body.quantity ?? '')) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) throw fail(400, 'Quantity must be a whole number from 1 to 1,000,000 nos.');
  if (!MATERIALS.includes(body.materialType)) throw fail(400, 'Select a valid material.');
  const requestId = text('requestId', 100);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) throw fail(400, 'A valid request ID is required.');
  return { customerName: text('customerName', 150, false), memberName: text('memberName', 120), sectionSize: text('sectionSize', 100), lengthMm: decimal('lengthMm', 100000), materialType: body.materialType, grade: text('grade', 100), thicknessMm: decimal('thicknessMm', 100), quantity, note: text('note', 255, false), requestId };
}
const identity = (member, section, length, material, grade, thickness, customer = "''") => `SHA2(JSON_ARRAY(LOWER(TRIM(COALESCE(${member},''))),REPLACE(REPLACE(REPLACE(LOWER(TRIM(COALESCE(${section},''))),' ',''),'×','x'),'*','x'),CAST(CAST(COALESCE(${length},0) AS DECIMAL(12,3)) AS CHAR),LOWER(TRIM(COALESCE(${material},''))),LOWER(TRIM(COALESCE(${grade},''))),CAST(CAST(COALESCE(${thickness},0) AS DECIMAL(10,3)) AS CHAR),LOWER(TRIM(COALESCE(${customer},'')))),256)`;
const { historicalJobSql } = require('./unit1JobHistory');
const productionIdentity = identity('b.member_name', 'j.section_size', 'j.cut_length_mm', 'c.material_type', 'c.grade', 'c.thickness_mm', 'j.customer_name');
const source = 'FROM unit1_production_bundles b JOIN unit1_production_runs r ON r.id=b.run_id JOIN unit1_job_cards j ON j.id=r.job_card_id JOIN coils c ON c.id=r.coil_id';
async function captureProduction(db, bundleId = null, jobId = null, correctExisting = false, onlyExisting = false) {
  let where = bundleId ? 'WHERE b.id=?' : jobId ? `WHERE r.job_card_id=?${correctExisting ? '' : ' AND NOT EXISTS (SELECT 1 FROM unit1_material_stock_movements seen WHERE seen.source_bundle_id=b.id)'}` : correctExisting ? '' : 'WHERE NOT EXISTS (SELECT 1 FROM unit1_material_stock_movements seen WHERE seen.source_bundle_id=b.id)';
  if(onlyExisting)where+=(where?' AND ':'WHERE ')+"EXISTS (SELECT 1 FROM unit1_material_stock_movements old_stock WHERE old_stock.source_bundle_id=b.id AND old_stock.movement_type='production')";
  const params = bundleId ? [bundleId] : jobId ? [jobId] : [];
  await db.execute(historicalJobSql(`INSERT INTO unit1_material_stock_items (stock_key,member_name,section_size,length_mm,material_type,grade,thickness_mm,customer_name)
    SELECT DISTINCT ${productionIdentity},COALESCE(b.member_name,''),COALESCE(j.section_size,''),COALESCE(j.cut_length_mm,0),COALESCE(c.material_type,''),COALESCE(c.grade,''),COALESCE(c.thickness_mm,0),COALESCE(j.customer_name,'') ${source} ${where}
    ON DUPLICATE KEY UPDATE id=unit1_material_stock_items.id`), params);
  if (correctExisting) {
    await db.execute(historicalJobSql(`INSERT INTO unit1_material_stock_revisions (movement_id,before_item_id,after_item_id,reason)
      SELECT seen.id,seen.item_id,i.id,'production metadata correction' ${source}
      JOIN unit1_material_stock_movements seen ON seen.source_bundle_id=b.id
      JOIN unit1_material_stock_items i ON BINARY i.stock_key=BINARY ${productionIdentity}
      ${where || 'WHERE 1=1'} AND seen.item_id<>i.id`), params);
  }
  await db.execute(historicalJobSql(`INSERT INTO unit1_material_stock_movements (item_id,movement_type,quantity,source_bundle_id,source_run_id,source_job_card_id,actor_user_id,created_at)
    SELECT i.id,'production',b.pieces,b.id,b.run_id,r.job_card_id,b.entered_by,b.created_at ${source} JOIN unit1_material_stock_items i ON BINARY i.stock_key=BINARY ${productionIdentity} ${where}
    ON DUPLICATE KEY UPDATE ${correctExisting ? 'item_id=VALUES(item_id),quantity=VALUES(quantity)' : 'id=unit1_material_stock_movements.id'}`), params);
}
async function recordOpening(connection, input, userId) {
  const v = normalizeOpening(input);
  const key = identity('v.member_name','v.section_size','v.length_mm','v.material_type','v.grade','v.thickness_mm','v.customer_name');
  await connection.execute(`INSERT INTO unit1_material_stock_items (stock_key,member_name,section_size,length_mm,material_type,grade,thickness_mm,customer_name)
    SELECT ${key},v.* FROM (SELECT ? AS member_name,? AS section_size,? AS length_mm,? AS material_type,? AS grade,? AS thickness_mm,? AS customer_name) v WHERE 1
    ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, [v.memberName,v.sectionSize,v.lengthMm,v.materialType,v.grade,v.thicknessMm,v.customerName]);
  const [[item]] = await connection.execute('SELECT LAST_INSERT_ID() AS id');
  // The globally unique request key prevents retrying a timed-out submit from adding stock twice.
  await connection.execute(`INSERT INTO unit1_material_stock_movements (item_id,movement_type,quantity,request_key,note,actor_user_id) VALUES (?,'opening',?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`, [item.id,v.quantity,v.requestId,v.note || null,userId]);
  const [[entry]] = await connection.execute('SELECT id,item_id AS itemId,quantity,note,actor_user_id AS actorUserId FROM unit1_material_stock_movements WHERE request_key=?', [v.requestId]);
  if (Number(entry.itemId) !== Number(item.id) || Number(entry.quantity) !== v.quantity || (entry.note || '') !== v.note || Number(entry.actorUserId) !== Number(userId)) throw fail(409, 'This request was already used for a different stock entry. Refresh and try again.');
  return { id: entry.id, itemId: item.id };
}
module.exports = { normalizeOpening, captureProduction, recordOpening, identity };
