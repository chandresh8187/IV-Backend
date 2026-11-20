const { createIdentifierTable, reserveBatchCode } = require('./unit1PhysicalCoils');
function coilCode(id) {
  const value = Number(id) + 100000;
  if (!Number.isSafeInteger(Number(id)) || Number(id) < 1 || value > 999999) throw Object.assign(new Error('The six-digit coil ID range is exhausted. Contact your administrator.'), { status: 409 });
  return String(value);
}
async function assignCoilCode(connection, id, legacyId = null) {
  const preferred = legacyId && /^[1-9]\d{5}$/.test(legacyId) ? legacyId : coilCode(id);
  for (let attempt = 0; attempt < 900000; attempt++) {
    const code = String(100000 + (Number(preferred) - 100000 + attempt) % 900000);
    const [used] = await connection.execute('SELECT id FROM coils WHERE (public_code=? OR internal_id=?) AND id<>? LIMIT 1', [code,code,id]);
    if (used.length) continue;
    try {
      await reserveBatchCode(connection,code,id);
      if (legacyId !== null) await connection.execute('UPDATE coils SET public_code=? WHERE id=? AND public_code IS NULL', [code,id]);
      else await connection.execute('UPDATE coils SET supplier_coil_id=IF(supplier_coil_id=internal_id,?,supplier_coil_id),public_code=?,internal_id=? WHERE id=?', [code,code,code,id]);
      return code;
    } catch (error) { if (error.code !== 'ER_DUP_ENTRY') throw error; }
  }
  throw Object.assign(new Error('No six-digit coil IDs are available.'), { status: 409 });
}
async function migrateCoilCodes(db) {
  await createIdentifierTable(db);
  const [columns] = await db.query("SHOW COLUMNS FROM coils LIKE 'public_code'");
  if (!columns.length) await db.query('ALTER TABLE coils ADD COLUMN public_code CHAR(6) NULL AFTER internal_id');
  const [indexes] = await db.query("SHOW INDEX FROM coils WHERE Key_name='uq_unit1_coil_public_code'");
  if (!indexes.length) await db.query('ALTER TABLE coils ADD UNIQUE KEY uq_unit1_coil_public_code (public_code)');
  // Preserve every legacy alias and reserve existing numeric labels too.
  const [coils] = await db.query('SELECT id,internal_id AS internalId FROM coils WHERE public_code IS NULL ORDER BY id');
  for (const coil of coils) await assignCoilCode(db, coil.id, coil.internalId);
}
module.exports = { coilCode, assignCoilCode, migrateCoilCodes };
