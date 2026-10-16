const router = require('express').Router();
const db = require('../config/unit1Db');
const auth = require('../middleware/unit1AuthMiddleware');
const access = require('../middleware/roleMiddleware');
const { MATERIALS, normalizeGrade } = require('../services/unit1MaterialGrades');
const { publishUnit1Change } = require('../services/unit1Realtime');
const { MATERIAL_TYPES } = require('../services/unit1MaterialWeight');

router.use(auth);

router.get('/', access([], 'unit1.coils.view'), async (_req, res, next) => {
  try {
    const [[rows], [densities]] = await Promise.all([
      db.query('SELECT id, material_type AS materialType, grade_value AS value FROM unit1_material_grades ORDER BY id'),
      db.query('SELECT material_type AS materialType, density_g_cm3 AS densityGcm3 FROM unit1_material_densities'),
    ]);
    res.json({
      data: MATERIALS.map(material => ({
        ...material,
        densityGcm3: Number(densities.find(item => item.materialType === material.key)?.densityGcm3 ?? 7.85),
        grades: rows.filter(row => row.materialType === material.key).map(row => ({ id: row.id, value: row.value })),
      })),
    });
  } catch (error) { next(error); }
});

router.put('/:materialType/density', access([], 'unit1.materials.manage'), async (req, res, next) => {
  const materialType = req.params.materialType;
  const densityGcm3 = Number(req.body?.densityGcm3);
  if (!MATERIAL_TYPES.includes(materialType) || !Number.isFinite(densityGcm3) || densityGcm3 < 6 || densityGcm3 > 9) {
    return res.status(400).json({ error: 'Choose a material and enter a density from 6 to 9 g/cm³.' });
  }
  try {
    await db.execute('UPDATE unit1_material_densities SET density_g_cm3=? WHERE material_type=?', [densityGcm3, materialType]);
    publishUnit1Change(req, 'materials', { materialType, action: 'density_updated' });
    res.json({ data: { materialType, densityGcm3 } });
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
    publishUnit1Change(req, 'materials', { materialType, action: 'created' });
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
    publishUnit1Change(req, 'materials', { materialType, action: 'updated' });
    res.json({ data: { id: Number(req.params.id), materialType, value: result.value } });
  } catch (error) { next(error); }
});

router.delete('/:id', access([], 'unit1.materials.manage'), async (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid grade ID.' });
  try {
    const [deleted] = await db.execute('DELETE FROM unit1_material_grades WHERE id = ?', [req.params.id]);
    if (!deleted.affectedRows) return res.status(404).json({ error: 'Grade not found.' });
    publishUnit1Change(req, 'materials', { action: 'deleted' });
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
