const router = require('express').Router();
const db = require('../config/unit1Db');
const auth = require('../middleware/unit1AuthMiddleware');
const access = require('../middleware/roleMiddleware');
const { validateInward, validateMultiBatchInward } = require('../services/unit1CoilValidation');
const { DEFAULT_FIELDS, FIELDS, parseFields, coilWeightKg } = require('../services/unit1CoilQr');
const { publishUnit1Change } = require('../services/unit1Realtime');
const { roundKg } = require('../services/unit1MaterialWeight');
const { numberedCoilUsage } = require('../services/unit1CoilUsage');

const columns = `id, internal_id AS internalId, supplier, supplier_coil_id AS supplierCoilId,
  invoice, invoice_date AS invoiceDate, tc_number AS tcNumber,
  vendor_code AS vendorCode, grade, material_type AS materialType, coil_qty AS coilQty, qr_generated_at AS qrGeneratedAt,
  thickness_mm AS thicknessMm, width_mm AS widthMm,
  estimated_kg AS estimatedKg, gross_kg AS grossKg, tare_kg AS tareKg,
  actual_net_kg AS actualNetKg, actual_net_kg AS totalWeightKg, quality_status AS qualityStatus,
  quality_note AS qualityNote, status, received_at AS receivedAt,
  (SELECT COALESCE(SUM(b.theoretical_used_kg),0) FROM unit1_production_runs used_run JOIN unit1_production_bundles b ON b.run_id=used_run.id WHERE used_run.coil_id=coils.id) AS theoreticalUsedKg,
  (SELECT CASE WHEN COUNT(*)<>COUNT(b.hole_scrap_kg) THEN NULL ELSE COALESCE(SUM(b.hole_scrap_kg),0) END FROM unit1_production_runs scrap_run JOIN unit1_production_bundles b ON b.run_id=scrap_run.id WHERE scrap_run.coil_id=coils.id) AS holeScrapKg,
  (SELECT COUNT(*) FROM unit1_production_runs used_run WHERE used_run.coil_id = coils.id) AS usedQty,
  (CASE WHEN status IN ('consumed','closed') THEN 0 ELSE coil_qty - (SELECT COUNT(*) FROM unit1_production_runs used_run WHERE used_run.coil_id = coils.id) END) AS availableQty`;

function withWeight(coil) {
  const used = Number(coil.theoreticalUsedKg || 0);
  return { ...coil, theoreticalUsedKg: roundKg(used), theoreticalRemainingKg: roundKg(Number(coil.totalWeightKg || 0) - used), holeScrapKg: coil.holeScrapKg === null ? null : roundKg(coil.holeScrapKg) };
}

router.use(auth);

router.get('/', access([], 'unit1.coils.view'), async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim().slice(0, 100);
    const params = query ? Array(4).fill(`%${query}%`) : [];
    const where = query ? 'WHERE internal_id LIKE ? OR supplier LIKE ? OR supplier_coil_id LIKE ? OR grade LIKE ?' : '';
    const [rows] = await db.execute(`SELECT ${columns} FROM coils ${where} ORDER BY received_at DESC, id DESC`, params);
    res.json({ data: rows.map(withWeight) });
  } catch (error) { next(error); }
});

router.get('/scan/:internalId/:coilNumber', access([], 'unit1.coils.scan'), async (req, res, next) => {
  const internalId = String(req.params.internalId || '');
  const coilNumber = Number(req.params.coilNumber);
  if (!internalId || internalId.length > 80 || !/^\d+$/.test(req.params.coilNumber) || !Number.isSafeInteger(coilNumber)) return res.status(400).json({ error: 'Invalid coil QR code.' });
  try {
    const [rows] = await db.execute(`SELECT ${columns} FROM coils WHERE internal_id = ? LIMIT 1`, [internalId]);
    const coil = rows[0];
    if (!coil || !coil.qrGeneratedAt || coilNumber < 1 || coilNumber > Number(coil.coilQty || 1)) return res.status(404).json({ error: 'Generated coil QR code not found.' });
    const [settings] = await db.execute('SELECT fields_json AS fields FROM unit1_qr_scan_role_fields WHERE role = ?', [req.user.role]);
    const selected = settings.length ? parseFields(settings[0].fields) : DEFAULT_FIELDS;
    const values = { ...coil, perCoilWeightKg: coilWeightKg(coil.totalWeightKg, coil.coilQty, coilNumber) };
    res.json({ data: {
      coilId: coil.id,
      reference: coil.internalId,
      coilNumber,
      coilQty: coil.coilQty,
      role: req.user.role,
      fields: FIELDS.filter(field => selected.includes(field.key)).map(field => ({ ...field, value: values[field.key] ?? null })),
    } });
  } catch (error) { next(error); }
});

router.get('/:id/usage', access([], 'unit1.coils.view'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid coil ID.' });
  try {
    const [rows] = await db.execute(`SELECT ${columns} FROM coils WHERE id=?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Coil batch not found.' });
    const batch = withWeight(rows[0]);
    const pageSize = 50;
    const totalPages = Math.max(1, Math.ceil(Number(batch.coilQty) / pageSize));
    const page = Math.min(totalPages, Math.max(1, Number.parseInt(req.query.page, 10) || 1));
    const startNumber = (page - 1) * pageSize + 1;
    const count = Math.min(pageSize, Number(batch.coilQty) - startNumber + 1);
    const [runs] = await db.execute(`SELECT r.id AS runId,r.coil_number AS coilNumber,r.status,
      r.produced_pieces AS producedPieces,r.job_card_id AS jobCardId,
      j.member_name AS memberName,m.code AS machineCode,m.name AS machineName,
      (SELECT COALESCE(SUM(b.theoretical_used_kg),0) FROM unit1_production_bundles b WHERE b.run_id=r.id) AS theoreticalUsedKg,
      (SELECT CASE WHEN COUNT(*)<>COUNT(b.hole_scrap_kg) THEN NULL ELSE COALESCE(SUM(b.hole_scrap_kg),0) END FROM unit1_production_bundles b WHERE b.run_id=r.id) AS holeScrapKg
      FROM unit1_production_runs r LEFT JOIN unit1_job_cards j ON j.id=r.job_card_id
      LEFT JOIN unit1_machines m ON m.id=r.machine_id
      WHERE r.coil_id=? AND r.coil_number BETWEEN ? AND ? ORDER BY r.coil_number`, [batch.id, startNumber, startNumber + count - 1]);
    res.json({ data: { batch, coils: numberedCoilUsage(batch, runs, { startNumber, count }), page, pageSize, totalPages } });
  } catch (error) { next(error); }
});

router.get('/:id', access([], 'unit1.coils.view'), async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid coil ID.' });
    const [rows] = await db.execute(`SELECT ${columns} FROM coils WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Coil not found.' });
    res.json({ data: withWeight(rows[0]) });
  } catch (error) { next(error); }
});

router.post('/:id/generate-qr', access([], 'unit1.coils.view'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid coil ID.' });
  try {
    const [updated] = await db.execute('UPDATE coils SET qr_generated_at = COALESCE(qr_generated_at, UTC_TIMESTAMP(3)) WHERE id = ?', [req.params.id]);
    if (!updated.affectedRows) return res.status(404).json({ error: 'Coil not found.' });
    const [rows] = await db.execute(`SELECT ${columns} FROM coils WHERE id = ?`, [req.params.id]);
    publishUnit1Change(req, 'coils', { coilId: Number(req.params.id), action: 'qr_generated' });
    res.json({ data: rows[0] });
  } catch (error) { next(error); }
});

router.post('/bulk', access([], 'unit1.coils.create'), async (req, res, next) => {
  const result = validateMultiBatchInward(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const ids = [];
    for (const [index, coil] of result.value.entries()) {
      if (coil.materialType !== 'GP') {
        const [allowed] = await connection.execute('SELECT grade_value FROM unit1_material_grades WHERE material_type=? AND grade_value=? LIMIT 1', [coil.materialType, coil.grade]);
        if (!allowed.length) { const error = new Error(`Line ${index + 1}: Grade is not available for the selected material.`); error.status = 400; throw error; }
      }
      const [insert] = await connection.execute(
        `INSERT INTO coils (internal_id, supplier, supplier_coil_id, invoice, invoice_date, tc_number, vendor_code, grade, material_type, coil_qty,
         thickness_mm, width_mm, estimated_kg, gross_kg, tare_kg, actual_net_kg,
         quality_status, quality_note, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [coil.internalId, coil.supplier, coil.supplierCoilId, coil.invoice, coil.invoiceDate, coil.tcNumber, coil.vendorCode, coil.grade, coil.materialType, coil.coilQty,
          coil.thicknessMm, coil.widthMm, coil.estimatedKg, coil.grossKg, coil.tareKg,
          coil.actualNetKg, coil.qualityStatus, coil.qualityNote, coil.receivedAt],
      );
      ids.push(insert.insertId);
    }
    const [rows] = await connection.query(`SELECT ${columns} FROM coils WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, ids);
    await connection.commit();
    publishUnit1Change(req, 'coils', { coilIds: ids, action: 'received' });
    res.status(201).json({ data: rows.map(withWeight) });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

router.post('/', access([], 'unit1.coils.create'), async (req, res, next) => {
  const result = validateInward(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const coil = result.value;
  try {
    if (coil.materialType && coil.materialType !== 'GP') {
      const [allowed] = await db.execute(
        'SELECT grade_value FROM unit1_material_grades WHERE material_type = ? AND grade_value = ? LIMIT 1',
        [coil.materialType, coil.grade],
      );
      if (!allowed.length) return res.status(400).json({ error: 'Grade is not available for the selected material.' });
      coil.grade = allowed[0].grade_value;
    }
    const [insert] = await db.execute(
      `INSERT INTO coils (internal_id, supplier, supplier_coil_id, invoice, invoice_date, tc_number, vendor_code, grade, material_type, coil_qty,
       thickness_mm, width_mm, estimated_kg, gross_kg, tare_kg, actual_net_kg,
       quality_status, quality_note, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [coil.internalId, coil.supplier, coil.supplierCoilId, coil.invoice, coil.invoiceDate, coil.tcNumber, coil.vendorCode, coil.grade, coil.materialType, coil.coilQty,
        coil.thicknessMm, coil.widthMm, coil.estimatedKg, coil.grossKg, coil.tareKg,
        coil.actualNetKg, coil.qualityStatus, coil.qualityNote, coil.receivedAt],
    );
    const [rows] = await db.execute(`SELECT ${columns} FROM coils WHERE id = ?`, [insert.insertId]);
    publishUnit1Change(req, 'coils', { coilId: insert.insertId, action: 'received' });
    res.status(201).json({ data: rows[0] });
  } catch (error) { next(error); }
});

router.put('/:id', access([], 'unit1.coils.edit'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid coil ID.' });
  const result = validateInward(req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const coil = result.value;
  if (!coil.materialType) return res.status(400).json({ error: 'Only Unit 1 inward batches can be edited here.' });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[existing]] = await connection.execute('SELECT id, material_type AS materialType, grade, width_mm AS widthMm, thickness_mm AS thicknessMm, coil_qty AS coilQty, actual_net_kg AS totalWeightKg FROM coils WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!existing) { await connection.rollback(); return res.status(404).json({ error: 'Coil inward not found.' }); }
    const [[usage]] = await connection.execute('SELECT COUNT(*) AS usedQty FROM unit1_production_runs WHERE coil_id = ?', [req.params.id]);
    if (usage.usedQty && (existing.materialType !== coil.materialType || existing.grade !== coil.grade || Number(existing.widthMm) !== coil.widthMm || Number(existing.thicknessMm) !== coil.thicknessMm || Number(existing.coilQty) !== coil.coilQty || Number(existing.totalWeightKg) !== coil.actualNetKg)) {
      await connection.rollback();
      return res.status(409).json({ error: 'This coil has production history. Its material, size, quantity and weight cannot be changed.' });
    }
    if (coil.materialType !== 'GP') {
      const [allowed] = await connection.execute('SELECT grade_value FROM unit1_material_grades WHERE material_type = ? AND grade_value = ? LIMIT 1', [coil.materialType, coil.grade]);
      if (!allowed.length) { await connection.rollback(); return res.status(400).json({ error: 'Grade is not available for the selected material.' }); }
    }
    await connection.execute(`UPDATE coils SET invoice = ?, invoice_date = ?, tc_number = ?, vendor_code = ?, supplier = ?, grade = ?, material_type = ?, coil_qty = ?, thickness_mm = ?, width_mm = ?, estimated_kg = ?, gross_kg = ?, actual_net_kg = ? WHERE id = ?`,
      [coil.invoice, coil.invoiceDate, coil.tcNumber, coil.vendorCode, coil.supplier, coil.grade, coil.materialType, coil.coilQty, coil.thicknessMm, coil.widthMm, coil.estimatedKg, coil.grossKg, coil.actualNetKg, req.params.id]);
    const [[updated]] = await connection.execute(`SELECT ${columns} FROM coils WHERE id = ?`, [req.params.id]);
    await connection.commit();
    publishUnit1Change(req, 'coils', { coilId: Number(req.params.id), action: 'updated' });
    res.json({ data: updated });
  } catch (error) { await connection.rollback(); next(error); }
  finally { connection.release(); }
});

router.delete('/:id', access([], 'unit1.coils.delete'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid coil ID.' });
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[coil]] = await connection.execute('SELECT id FROM coils WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!coil) { await connection.rollback(); return res.status(404).json({ error: 'Coil inward not found.' }); }
    const [[usage]] = await connection.execute('SELECT COUNT(*) AS usedQty FROM unit1_production_runs WHERE coil_id = ?', [req.params.id]);
    if (usage.usedQty) { await connection.rollback(); return res.status(409).json({ error: 'This coil has production history and cannot be deleted.' }); }
    await connection.execute('DELETE FROM coils WHERE id = ?', [req.params.id]);
    await connection.commit();
    publishUnit1Change(req, 'coils', { coilId: Number(req.params.id), action: 'deleted' });
    res.json({ data: { id: Number(req.params.id) } });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') return res.status(409).json({ error: 'This coil is linked to other records and cannot be deleted.' });
    next(error);
  } finally { connection.release(); }
});

router.use((error, _req, res, next) => {
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Internal coil ID already exists.' });
  if (['ECONNREFUSED', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'PROTOCOL_CONNECTION_LOST'].includes(error.code)) {
    return res.status(503).json({ error: 'Unit 1 database unavailable or schema needs migration.' });
  }
  next(error);
});

module.exports = router;
