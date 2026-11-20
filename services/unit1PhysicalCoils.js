async function createIdentifierTable(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS unit1_coil_identifiers (
    code INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    batch_id BIGINT UNSIGNED NOT NULL,
    coil_number INT UNSIGNED NULL,
    UNIQUE KEY uq_unit1_physical_coil (batch_id,coil_number)
  ) ENGINE=InnoDB AUTO_INCREMENT=100000 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function reserveBatchCode(db, code, batchId) {
  if (!/^[1-9]\d{5}$/.test(String(code))) return;
  const [existing] = await db.execute('SELECT batch_id AS batchId,coil_number AS coilNumber FROM unit1_coil_identifiers WHERE code=?', [code]);
  if (existing.length) {
    if (Number(existing[0].batchId) !== Number(batchId) || existing[0].coilNumber !== null) throw Object.assign(new Error('Coil identifier already reserved.'), { code:'ER_DUP_ENTRY' });
    return;
  }
  await db.execute('INSERT INTO unit1_coil_identifiers (code,batch_id,coil_number) VALUES (?,?,NULL)', [code,batchId]);
}

async function ensurePhysicalCoils(db, batchId, quantity) {
  const [rows] = await db.execute('SELECT coil_number AS coilNumber FROM unit1_coil_identifiers WHERE batch_id=? AND coil_number BETWEEN 1 AND ?', [batchId,quantity]);
  const existing = new Set(rows.map(row => Number(row.coilNumber)));
  const missing = Array.from({length:Number(quantity)}, (_,index) => index + 1).filter(number => !existing.has(number));
  for (let offset = 0; offset < missing.length; offset += 500) {
    const chunk = missing.slice(offset,offset+500);
    await db.execute(`INSERT INTO unit1_coil_identifiers (batch_id,coil_number) VALUES ${chunk.map(() => '(?,?)').join(',')} ON DUPLICATE KEY UPDATE code=code`, chunk.flatMap(number => [batchId,number]));
    const [[allocated]] = await db.execute('SELECT MAX(code) AS lastCode FROM unit1_coil_identifiers WHERE batch_id=?', [batchId]);
    if (Number(allocated?.lastCode) > 999999) throw Object.assign(new Error('The six-digit coil ID range is exhausted. Contact your administrator.'), {status:409});
  }
}

async function migratePhysicalCoils(db) {
  const [batches] = await db.query('SELECT id,internal_id AS internalId,public_code AS publicCode,coil_qty AS coilQty FROM coils ORDER BY id');
  for (const batch of batches) {
    await reserveBatchCode(db,batch.publicCode,batch.id);
    await reserveBatchCode(db,batch.internalId,batch.id);
  }
  for (const batch of batches) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await ensurePhysicalCoils(connection,batch.id,batch.coilQty);
      await connection.commit();
    } catch (error) { await connection.rollback(); throw error; }
    finally { connection.release(); }
  }
  await db.query(`UPDATE unit1_hole_checks hc JOIN unit1_production_runs r ON r.id=hc.run_id
    JOIN unit1_coil_identifiers ci ON ci.batch_id=r.coil_id AND ci.coil_number=r.coil_number
    SET hc.report_snapshot=JSON_SET(hc.report_snapshot,
      '$.inwardReference',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(hc.report_snapshot,'$.inwardReference')),JSON_UNQUOTE(JSON_EXTRACT(hc.report_snapshot,'$.coilInternalId'))),
      '$.coilInternalId',CAST(ci.code AS CHAR))
    WHERE r.stock_qr_id IS NULL AND hc.report_snapshot IS NOT NULL AND (JSON_UNQUOTE(JSON_EXTRACT(hc.report_snapshot,'$.coilInternalId')) IS NULL OR JSON_UNQUOTE(JSON_EXTRACT(hc.report_snapshot,'$.coilInternalId'))<>CAST(ci.code AS CHAR))`);
}

// QR columns use ascii_bin while legacy numeric identifiers inherit the connection
// collation when cast. Normalize BOTH operands before COALESCE, not its result.
const coilCodeFallbackSql = (qrExpression, legacyExpression) =>
  `COALESCE(CONVERT(${qrExpression} USING utf8mb4) COLLATE utf8mb4_general_ci,CONVERT(${legacyExpression} USING utf8mb4) COLLATE utf8mb4_general_ci)`;
const physicalCoilCodeSql = (coilAlias = 'c', runAlias = 'r') => coilCodeFallbackSql(
  `(SELECT sq.code FROM unit1_stock_qrs sq WHERE sq.id=${runAlias}.stock_qr_id)`,
  `(SELECT ci.code FROM unit1_coil_identifiers ci WHERE ci.batch_id=${coilAlias}.id AND ci.coil_number=${runAlias}.coil_number)`,
);

module.exports = { createIdentifierTable, reserveBatchCode, ensurePhysicalCoils, migratePhysicalCoils, physicalCoilCodeSql, coilCodeFallbackSql };
