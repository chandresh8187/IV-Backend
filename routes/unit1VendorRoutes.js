const router = require('express').Router();
const db = require('../config/unit1Db');
const auth = require('../middleware/unit1AuthMiddleware');
const access = require('../middleware/roleMiddleware');
const { listVendors, createVendor } = require('../services/unit1Vendors');
const { publishUnit1Change } = require('../services/unit1Realtime');

router.use(auth);
router.get('/', access([], 'unit1.coils.view'), async (_req, res, next) => {
  try {
    res.json({ data: await listVendors(db) });
  } catch (error) {
    next(error);
  }
});
router.post('/', access([], 'unit1.coils.create'), async (req, res, next) => {
  let connection;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction();
    const vendor = await createVendor(connection, req.body, req.user.id);
    await connection.commit();
    publishUnit1Change(req, 'vendors', { action: 'created', id: vendor.id });
    res.status(201).json({ data: vendor });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

module.exports = router;
