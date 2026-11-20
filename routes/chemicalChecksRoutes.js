const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const access = require('../middleware/roleMiddleware');
const { createChemicalCheck, updateChemicalCheck, getChemicalChecks, downloadChemicalChecksPdf } = require('../controllers/chemicalChecksController');

router.use(auth);
router.get('/', access([], 'chemical_checks.view'), getChemicalChecks);
router.post('/', access([], 'chemical_checks.manage'), createChemicalCheck);
router.put('/:id', access([], 'chemical_checks.edit'), updateChemicalCheck);
router.get('/pdf', access([], 'chemical_checks.report'), downloadChemicalChecksPdf);

module.exports = router;
