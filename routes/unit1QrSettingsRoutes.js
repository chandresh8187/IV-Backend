const router = require('express').Router();
const db = require('../config/unit1Db');
const auth = require('../middleware/unit1AuthMiddleware');
const access = require('../middleware/roleMiddleware');
const { ROLES, FIELDS, DEFAULT_FIELDS, normalizeFields, parseFields } = require('../services/unit1CoilQr');
const { publishUnit1Change } = require('../services/unit1Realtime');

router.use(auth, access([], 'unit1.qr.settings'));

router.get('/', async (_req, res, next) => {
  try {
    const [rows] = await db.query('SELECT role, fields_json AS fields FROM unit1_qr_scan_role_fields');
    const saved = new Map(rows.map(row => [row.role, parseFields(row.fields)]));
    res.json({ data: { roles: ROLES, fields: FIELDS, selections: Object.fromEntries(ROLES.map(role => [role, saved.get(role) || DEFAULT_FIELDS])) } });
  } catch (error) { next(error); }
});

router.put('/:role', async (req, res, next) => {
  const role = String(req.params.role || '').toLowerCase();
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  const fields = normalizeFields(req.body?.fields);
  if (!fields) return res.status(400).json({ error: 'Choose valid QR scan fields.' });
  try {
    await db.execute(
      'INSERT INTO unit1_qr_scan_role_fields (role, fields_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE fields_json = VALUES(fields_json)',
      [role, JSON.stringify(fields)],
    );
    publishUnit1Change(req, 'qr-settings', { role, action: 'updated' });
    res.json({ data: { role, fields } });
  } catch (error) { next(error); }
});

module.exports = router;
