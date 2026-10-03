const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const access = require('../middleware/roleMiddleware');
const controller = require('../controllers/labourWeightController');
const viewAccess = access([], 'labour_weights.view');
const productionAccess = access([], 'production.save');
const supervisorOr = guard => (req, res, next) =>
  String(req.user?.role || '').trim().toLowerCase() === 'supervisor'
    ? next()
    : guard(req, res, next);
router.get('/mode', auth, controller.getMode);
router.put('/mode', auth, controller.setMode);
router.get('/', auth, supervisorOr(viewAccess), controller.list);
router.get('/pending', auth, supervisorOr(productionAccess), controller.listPending);
router.get('/archive', auth, controller.listArchive);
router.post('/', auth, access([], 'labour_weights.create'), controller.create);
router.post('/:id/timers/:process/toggle', auth, access([], 'labour_weights.timer'), controller.toggleTimer);
router.put('/:id', auth, access([], 'labour_weights.edit'), controller.update);
router.delete('/:id', auth, access([], 'labour_weights.delete'), controller.remove);
router.post('/:id/consume', auth, access([], 'production.save'), controller.consume);
module.exports = router;
