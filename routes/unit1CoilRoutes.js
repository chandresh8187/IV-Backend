const router = require('express').Router();
const db = require('../config/unit1Db');
const auth = require('../middleware/authMiddleware');
const access = require('../middleware/roleMiddleware');
const { validateInward } = require('../services/unit1CoilValidation');

const columns = `id, internal_id AS internalId, supplier, supplier_coil_id AS supplierCoilId,
  invoice, invoice_date AS invoiceDate, tc_number AS tcNumber,
  vendor_code AS vendorCode, grade, material_type AS materialType, coil_qty AS coilQty,
  thickness_mm AS thicknessMm, width_mm AS widthMm,
  estimated_kg AS estimatedKg, gross_kg AS grossKg, tare_kg AS tareKg,
  actual_net_kg AS actualNetKg, actual_net_kg AS totalWeightKg, quality_status AS qualityStatus,
  quality_note AS qualityNote, status, received_at AS receivedAt`;

router.use(auth);

router.get('/', access([], 'unit1.coils.view'), async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim().slice(0, 100);
    const params = query ? Array(4).fill(`%${query}%`) : [];
    const where = query ? 'WHERE internal_id LIKE ? OR supplier LIKE ? OR supplier_coil_id LIKE ? OR grade LIKE ?' : '';
    const [rows] = await db.execute(`SELECT ${columns} FROM coils ${where} ORDER BY received_at DESC, id DESC`, params);
    res.json({ data: rows });
  } catch (error) { next(error); }
});

router.get('/:id', access([], 'unit1.coils.view'), async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid coil ID.' });
    const [rows] = await db.execute(`SELECT ${columns} FROM coils WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Coil not found.' });
    res.json({ data: rows[0] });
  } catch (error) { next(error); }
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
    res.status(201).json({ data: rows[0] });
  } catch (error) { next(error); }
});

router.use((error, _req, res, next) => {
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Internal coil ID already exists.' });
  if (['ECONNREFUSED', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'PROTOCOL_CONNECTION_LOST'].includes(error.code)) {
    return res.status(503).json({ error: 'Unit 1 database unavailable or schema needs migration.' });
  }
  next(error);
});

module.exports = router;
