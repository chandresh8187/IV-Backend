const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const access = require('../middleware/roleMiddleware');
const { currentHistoryYear } = require('../services/financialYearService');
const controller = require('../controllers/contractorController');
router.use(auth);
router.get('/', access([], 'contractors.view'), controller.listContractors);
router.get('/directory', access([], 'contractors.view'), controller.listContractorDirectory);
router.get('/report', access([], 'contractors.view'), currentHistoryYear, controller.getContractorReport);
router.get('/production', access([], 'contractors.view'), currentHistoryYear,
  require('../controllers/contractProductionController').getContractProduction);
router.post('/', access([], 'contractors.manage'), controller.createContractor);
router.put('/assignments', access([], 'contractors.manage'), controller.saveAssignment);
router.put('/rotations', access([], 'contractors.manage'), controller.saveRotation);
router.put('/:id', access([], 'contractors.manage'), controller.updateContractor);
router.delete('/:id', access([], 'contractors.manage'), controller.deleteContractor);
module.exports = router;
