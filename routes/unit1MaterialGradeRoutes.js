const router = require('express').Router();
const db = require('../config/unit1Db');
const auth = require('../middleware/authMiddleware');
const access = require('../middleware/roleMiddleware');
const { MATERIALS, normalizeGrade } = require('../services/unit1MaterialGrades');

router.use(auth);

router.get('/', access([], 'unit1.coils.view'), async (_req, res, next) => {
  try {
    const [rows] = await db.query('SELECT id, material_type AS materialType, grade_value AS value FROM unit1_material_grades ORDER BY id');
    res.json({
      data: MATERIALS.map(material => ({
        ...material,
        grades: rows.filter(row => row.materialType === material.key).map(row => ({ id: row.id, value: row.value })),
      })),
    });
  } catch (error) { next(error); }
});

router.post('/', access([], 'unit1.materials.manage'), async (req, res, next) => {
  const materialType = String(req.body?.materialType || '').trim();
  const result = normalizeGrade(materialType, req.body?.grade);
  if (result.error) return res.status(400).json({ error: result.error });
  try {
    const [insert] = await db.execute(
      'INSERT INTO unit1_material_grades (material_type, grade_value) VALUES (?, ?)',
      [materialType, result.value],
    );
    res.status(201).json({ data: { id: insert.insertId, materialType, value: result.value } });
  } catch (error) { next(error); }
});

router.put('/:id', access([], 'unit1.materials.manage'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid grade ID.' });
  const materialType = String(req.body?.materialType || '').trim();
  const result = normalizeGrade(materialType, req.body?.grade);
  if (result.error) return res.status(400).json({ error: result.error });
  try {
    const [updated] = await db.execute(
      'UPDATE unit1_material_grades SET material_type = ?, grade_value = ? WHERE id = ?',
      [materialType, result.value, req.params.id],
    );
    if (!updated.affectedRows) return res.status(404).json({ error: 'Grade not found.' });
    res.json({ data: { id: Number(req.params.id), materialType, value: result.value } });
  } catch (error) { next(error); }
});

router.delete('/:id', access([], 'unit1.materials.manage'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid grade ID.' });
  try {
    const [deleted] = await db.execute('DELETE FROM unit1_material_grades WHERE id = ?', [req.params.id]);
    if (!deleted.affectedRows) return res.status(404).json({ error: 'Grade not found.' });
    res.json({ success: true });
  } catch (error) { next(error); }
});

router.use((error, _req, res, next) => {
  if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This grade already exists for the material.' });
  if (['ECONNREFUSED', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE', 'PROTOCOL_CONNECTION_LOST'].includes(error.code)) {
    return res.status(503).json({ error: 'Unit 1 grade database unavailable or schema needs migration.' });
  }
  next(error);
});

module.exports = router;
