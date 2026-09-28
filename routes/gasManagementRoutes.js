const router = require('express').Router();
const db = require('../config/db');
const auth = require('../middleware/authMiddleware');
const access = require('../middleware/roleMiddleware');
const c = require('../controllers/gasManagementController');

router.use(auth);
router.get('/', access([], 'gas.view'), c.getDashboard);
router.post('/receipts', access([], 'gas.manage'), c.receiveBottles);
router.post('/change', access([], 'gas.operate'), async (req, res, next) => {
  const nextBottle = Number(req.body.bottle_number);
  if (!Number.isInteger(nextBottle) || nextBottle < 1 || nextBottle > 4) return res.status(400).json({ success: false, message: 'Next bottle number must be between 1 and 4.' });
  try {
    const [rows] = await db.query("SELECT position_no FROM gas_bottle_runs WHERE finished_at IS NULL LIMIT 1");
    if (rows[0] && Number(rows[0].position_no) === nextBottle) return res.status(409).json({ success: false, message: 'The next bottle number cannot be the currently running bottle.' });
    return c.changeBottle(req, res);
  } catch (error) { return next(error); }
});
router.post('/assign', access([], 'gas.manage'), c.assignBottle);
router.post('/positions/:position/fill', access([], 'gas.manage'), c.fillPosition);
router.put('/positions/:position/weight', access([], 'gas.manage'), c.updateFilledWeight);
router.post('/start', access([], 'gas.manage'), c.startBottle);
router.post('/switch', access([], 'gas.operate'), (req, res) => { req.body = { ...req.body, bottle_number: req.body.next_position_no, changed_at: req.body.finished_at }; return c.changeBottle(req, res); });
router.get('/pdf', access([], 'gas.report'), c.downloadPdf);
module.exports = router;
